import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { FOOTBALL_TIMEZONE, footballApiBase } from '../../shared/apiFootball.ts';
import { MAX_ODDS_PAGES, fetchOddsByDate, mapOddsEntry, pageLimitReached, pickBookmaker } from '../../shared/apiFootballOdds.ts';
import { writeQuotes } from '../../shared/oddsWriter.ts';
import {
  DEFAULT_DAILY_LIMIT,
  acquireLock,
  canSpend,
  chargeQuota,
  loadQuota,
  lockHeld,
  quotaDayKey,
  quotaLevel,
  quotaPercent,
  quotaPolicy,
  readCache,
  releaseLock,
  saveQuota,
  writeCache,
} from '../../shared/footballQuota.ts';
import { DEFAULT_HOUSE_MARGIN_PERCENT } from '../../shared/oddsApi.ts';
import { indexByFixtureId, numberOr, windowDates } from '../../shared/footballSync.ts';

const LOCK_MS = 4 * 60 * 1000;
/** Uma coleta por hora para cada dia: cotações pré-jogo mudam devagar. */
const ODDS_REFRESH_SECONDS = 3600;
/** Chamadas preservadas para placares ao vivo, que têm prioridade sobre odds. */
const RESERVE_CALLS = 10;
const MAX_ODDS_DAYS = 2;

/**
 * Coleta de cotações pré-jogo pela API-Football.
 *
 * - uma chamada por dia (`/odds?date=`), nunca uma por partida;
 * - cache compartilhado: o dia já coletado não é consultado de novo na mesma hora;
 * - orçamento compartilhado com a sincronização de placares, com reserva para
 *   que os resultados ao vivo nunca fiquem sem cota;
 * - em faixa de consumo alta as cotações são suspensas antes dos placares;
 * - a margem da casa é aplicada no momento da gravação, sobre o mercado completo.
 */
export default async function (req) {
  let base44;
  let quotaRecord = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const requested = String(payload?.mode || 'auto');
    const mode = ['today', 'upcoming', 'auto'].includes(requested) ? requested : 'auto';
    const trigger = payload?.trigger === 'manual' ? 'manual' : 'scheduled';
    const force = Boolean(payload?.force);

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || null;
    if (!settings) return Response.json({ skipped: true, reason: 'Configuração do provedor não encontrada' });
    if (!settings.football_enabled) {
      return Response.json({ skipped: true, reason: 'Integração API-Football desabilitada' });
    }

    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    const limit = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
    quotaRecord = await loadQuota(db, day);
    if (lockHeld(quotaRecord, nowMs)) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootballOdds', LOCK_MS);
    let used = numberOr(quotaRecord?.used, 0);

    const level = quotaLevel(used, limit);
    const policy = quotaPolicy(level);
    // Em faixa alta o essencial são os placares: as cotações param antes deles.
    if (level >= 2) {
      await releaseLock(db, quotaRecord);
      return Response.json({
        skipped: true,
        reason: `Cotações suspensas: orçamento da API-Football em ${quotaPercent(used, limit)}% (${level === 3 ? 'contingência' : 'consumo reduzido'})`,
        quota: { used, limit, level },
      });
    }

    const days = mode === 'today' ? 1 : MAX_ODDS_DAYS;
    const due = [];
    for (const date of windowDates(now, days)) {
      const cached = await readCache(db, `odds:date:${date}`);
      if (cached?.fresh && !force) continue;
      due.push(date);
    }
    if (!due.length) {
      await releaseLock(db, quotaRecord);
      return Response.json({ skipped: true, reason: 'Cotações já coletadas dentro da validade do cache' });
    }

    const job = await db.SyncJob.create({
      provider: 'api_football',
      trigger,
      job_type: 'odds',
      status: 'running',
      started_at: nowIso,
      triggered_by: user.email,
    });

    const houseMargin = numberOr(settings.house_margin_percent, DEFAULT_HOUSE_MARGIN_PERCENT);
    const failures = [];
    const calls = [];
    const entries = [];
    const quotaPatch = {};
    let pagesLimited = false;

    for (const date of due) {
      const dateEntries = [];
      const pages = [];
      let exhausted = false;

      for (let page = 1; page <= MAX_ODDS_PAGES; page += 1) {
        if (!canSpend(used, limit, RESERVE_CALLS, 1)) {
          failures.push(`orçamento reservado para placares: ${used}/${limit}`);
          exhausted = true;
          break;
        }
        try {
          const result = await fetchOddsByDate(apiKey, base, date, page);
          const charged = await chargeQuota(db, {
            record: quotaRecord,
            day,
            limit,
            cost: 1,
            purpose: 'odds',
            endpoint: '/odds',
            reserve: policy.reserve,
          });
          quotaRecord = charged.record || quotaRecord;
          used = charged.used;
          if (result.quota?.limit !== null && result.quota?.limit !== undefined) quotaPatch.provider_limit = result.quota.limit;
          if (result.quota?.remaining !== null && result.quota?.remaining !== undefined) {
            quotaPatch.provider_remaining = result.quota.remaining;
          }
          if (result.quota?.used !== null && result.quota?.used !== undefined) quotaPatch.provider_used = result.quota.used;

          const list = Array.isArray(result.data?.response) ? result.data.response : [];
          dateEntries.push(...list);
          pages.push({ page, records: list.length });

          if (result.errors.length) {
            if (pageLimitReached(result.errors)) pagesLimited = true;
            else failures.push(`odds ${date} p${page}: ${result.errors.join(' | ')}`);
            break;
          }
          if (!list.length) break;
          const totalPages = Number(result.data?.paging?.total);
          if (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages) break;
        } catch (error) {
          failures.push(`odds ${date} p${page}: ${String(error?.message || error)}`);
          break;
        }
      }

      entries.push(...dateEntries);
      pages.forEach((row) => calls.push({ date, page: row.page, records: row.records }));

      await writeCache(db, {
        key: `odds:date:${date}`,
        endpoint: '/odds',
        params: `date=${date}`,
        ttlSeconds: ODDS_REFRESH_SECONDS,
        records: dateEntries.length,
        note: exhausted && !pages.length
          ? 'Sem orçamento disponível nesta execução'
          : `${dateEntries.length} partida(s) com cotações em ${pages.length} página(s)${
              pagesLimited ? ' · limite de páginas do plano' : ''
            }`,
      }).catch(() => null);
    }

    // Somente partidas já conhecidas e que ainda não começaram recebem cotação.
    const known = await indexByFixtureId(db, entries.map((entry) => String(entry?.fixture?.id || '')).filter(Boolean));
    const quotesByEvent = new Map();
    entries.forEach((entry) => {
      const fixtureId = String(entry?.fixture?.id || '');
      const eventRow = known.get(fixtureId);
      if (!eventRow || !eventRow.start_time) return;
      if (Date.parse(eventRow.start_time) <= nowMs) return;
      const bookmaker = pickBookmaker(entry.bookmakers || []);
      if (!bookmaker) return;
      const mapped = mapOddsEntry(entry, bookmaker, {
        homeTeam: eventRow.home_team_name,
        awayTeam: eventRow.away_team_name,
      });
      if (!mapped) return;
      quotesByEvent.set(fixtureId, {
        event: eventRow,
        markets: mapped.markets,
        books: new Map([...mapped.markets.keys()].map((key) => [key, new Set([bookmaker.name || ''])])),
      });
    });

    const written = quotesByEvent.size
      ? await writeQuotes(db, { quotesByEvent, houseMargin, now })
      : { markets: 0, odds: 0, events: 0, available: 0, unavailable: 0, published: 0, suspendedMarkets: 0, removedOdds: 0 };

    const summary = [
      'odds api-football',
      `${calls.length} chamada(s)`,
      `${written.events} partida(s)`,
      `${written.odds} cotação(ões)`,
      `${written.published} publicado(s)`,
      `margem ${houseMargin}%`,
      `orçamento ${used}/${limit}`,
    ].join(' · ');

    const savedQuota = await saveQuota(db, quotaRecord, {
      ...(quotaRecord?.id ? {} : { day }),
      used,
      limit,
      level: quotaLevel(used, limit),
      ...quotaPatch,
      last_status_at: nowIso,
      last_status_code: 200,
      last_error: failures.join(' | ').slice(0, 400),
    });
    await releaseLock(db, savedQuota || quotaRecord);

    await db.SyncJob.update(job.id, {
      status: failures.length && !written.odds ? 'error' : failures.length ? 'partial' : 'success',
      finished_at: new Date().toISOString(),
      requests_used: calls.length,
      records_upserted: written.odds,
      error_message: failures.join(' | ').slice(0, 400),
    });

    for (const call of calls) {
      await db.ApiUsageLog.create({
        provider: 'api_football',
        endpoint: `/odds?date=${call.date}&page=${call.page}`,
        status_code: 200,
        records_returned: call.records,
        cache_hit: false,
        credits_used: 1,
        params: `date=${call.date} · page=${call.page}`,
        note: summary.slice(0, 240),
        error_message: failures.length ? failures.join(' | ').slice(0, 240) : '',
      });
    }

    return Response.json({
      ok: true,
      mode,
      days: due,
      calls: calls.length,
      events_with_odds: written.events,
      odds: written.odds,
      markets: written.markets,
      published: written.published,
      quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
      pages_limited: pagesLimited,
      failures,
      summary,
    });
  } catch (error) {
    if (base44 && quotaRecord?.id) {
      await base44.asServiceRole.entities.ApiQuota
        .update(quotaRecord.id, {
          lock_until: null,
          lock_owner: '',
          last_error: String(error?.message || error).slice(0, 400),
        })
        .catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
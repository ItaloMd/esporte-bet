import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { FOOTBALL_TIMEZONE, footballApiBase } from '../../shared/apiFootball.ts';
import { MAX_ODDS_PAGES, mapOddsEntry, pageLimitReached, pickBookmaker } from '../../shared/apiFootballOdds.ts';
import { FOOTBALL_CADENCE, FOOTBALL_LIMITS } from '../../shared/footballConfig.ts';
import { isThrottleError, openFootballClient } from '../../shared/footballClient.ts';
import { writeQuotes } from '../../shared/oddsWriter.ts';
import {
  DEFAULT_DAILY_LIMIT,
  acquireLock,
  canSpend,
  effectiveDailyLimit,
  loadQuota,
  lockHeld,
  quotaDayKey,
  quotaLevel,
  quotaPercent,
  quotaPolicy,
  QUOTA_PROVIDER,
  releaseLock,
  saveQuota,
  writeCache,
} from '../../shared/footballQuota.ts';
import { DEFAULT_HOUSE_MARGIN_PERCENT, localDateString } from '../../shared/oddsApi.ts';
import { indexByFixtureId, numberOr, upcomingDates } from '../../shared/footballSync.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { applyRelevancePatch, loadRelevanceConfig } from '../../shared/relevance.ts';
import { dueOddsItems, markOddsItemsDone, refreshOddsQueue } from '../../shared/footballOddsQueue.ts';

const LOCK_MS = 4 * 60 * 1000;
/** Cadências e tetos centralizados (ver shared/footballConfig.ts). */
const ODDS_REFRESH_SECONDS = FOOTBALL_CADENCE.oddsRefreshSeconds;
const RESERVE_CALLS = FOOTBALL_LIMITS.reservePlacares;
const MAX_ODDS_DAYS = FOOTBALL_CADENCE.oddsWindowDays;
/** Lotes (competição + data) coletados por execução. */
const MAX_ODDS_LOTS = 8;
/** Tempo máximo de coleta por execução, para nunca estourar a função. */
const RUN_BUDGET_MS = 45000;

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
    if (settings.football_paused) {
      return Response.json({ skipped: true, reason: 'Coleta pausada no Monitoramento da API' });
    }

    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    let limit = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
    quotaRecord = await loadQuota(db, day);
    // O orçamento real é o menor entre o interno e o limite do plano contratado.
    limit = effectiveDailyLimit(limit, quotaRecord?.provider_limit);
    if (lockHeld(quotaRecord, nowMs)) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootballOdds', LOCK_MS);
    let used = numberOr(quotaRecord?.used, 0);

    const level = quotaLevel(used, limit);
    const policy = quotaPolicy(level);
    // Somente na contingência as cotações param: a reserva de chamadas abaixo
    // já protege os placares, que continuam mesmo em consumo reduzido.
    if (level === 3) {
      await releaseLock(db, quotaRecord);
      return Response.json({
        skipped: true,
        reason: `Cotações suspensas: orçamento da API-Football em ${quotaPercent(used, limit)}% (contingência)`,
        quota: { used, limit, level },
      });
    }

    // Camada central de requisições: pausa pós-429, limite por minuto e
    // orçamento diário compartilhados com todas as outras rotinas.
    const client = await openFootballClient(db, {
      apiKey,
      base,
      settings,
      day,
      limit,
      reserve: RESERVE_CALLS,
      label: 'cotações api-football',
    });

    // Alvos da coleta: competições com jogos futuros no catálogo, priorizando as
    // brasileiras, em lotes de competição + data. Uma chamada devolve as
    // cotações de todos os jogos daquela competição no dia — muito mais
    // econômico que paginar o dia inteiro (26 páginas só para hoje).
    await refreshOddsQueue(db, { now });
    const { items: queueItems } = await dueOddsItems(db, { now });
    const queuePriority = queueItems[0]?.priority || 'NORMAL';

    const horizonDays = mode === 'today' ? 1 : MAX_ODDS_DAYS;
    const horizonIso = new Date(nowMs + horizonDays * 24 * 60 * 60 * 1000).toISOString();
    const upcoming = await db.Event.filter(
      {
        source: 'provider',
        status: 'scheduled',
        start_time: { $gt: nowIso, $lte: horizonIso },
      },
      { limit: 400, sort: 'start_time' },
    );

    const lotKey = (lot) => `odds:lot:${lot.leagueId}:${lot.season}:${lot.date}`;
    const lots = [];
    const seenLots = new Set();
    (upcoming.items || []).forEach((event) => {
      const leagueId = String(event.league_id || '');
      const season = String(event.season || '');
      if (!leagueId || !season || !event.start_time) return;
      const date = localDateString(new Date(event.start_time), FOOTBALL_TIMEZONE);
      const key = `${leagueId}:${season}:${date}`;
      if (seenLots.has(key)) return;
      seenLots.add(key);
      lots.push({
        leagueId,
        season,
        date,
        brazilian: Boolean(event.is_brazilian),
        name: event.competition_name || '',
      });
    });
    // Competições brasileiras primeiro: são as que a grade destaca.
    lots.sort((a, b) => Number(b.brazilian) - Number(a.brazilian));

    // Uma única consulta ao cache para todos os lotes candidatos: ler lote por
    // lote consumiria a cota de requisições internas sem nenhum ganho.
    const candidateLots = lots.slice(0, 40);
    const cacheRows = await db.ApiCache
      .filter({ provider: QUOTA_PROVIDER, key: { $in: candidateLots.map(lotKey) } }, { limit: 200 })
      .catch(() => ({ items: [] }));
    const freshKeys = new Set(
      (cacheRows.items || [])
        .filter((row) => row.expires_at && Date.parse(row.expires_at) > nowMs)
        .map((row) => row.key),
    );
    const pendingLots = candidateLots
      .filter((lot) => !freshKeys.has(lotKey(lot)))
      .slice(0, MAX_ODDS_LOTS);
    if (!pendingLots.length) {
      await releaseLock(db, quotaRecord);
      return Response.json({
        skipped: true,
        reason: `Todas as ${lots.length} competição(ões) do catálogo já estão com cotação atualizada`,
      });
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
    const runStartedAt = Date.now();
    const failures = [];
    const calls = [];
    const entries = [];
    let pagesLimited = false;
    let rateLimited = false;

    for (const lot of pendingLots) {
      if (rateLimited || Date.now() - runStartedAt > RUN_BUDGET_MS) break;
      if (!canSpend(used, limit, RESERVE_CALLS, 1)) {
        failures.push(`orçamento reservado para placares: ${used}/${limit}`);
        break;
      }
      const label = `${lot.name || lot.leagueId} · ${lot.date}`;
      try {
        const result = await client.call('/odds', {
          league: lot.leagueId,
          season: lot.season,
          date: lot.date,
        }, {
          timeoutMs: 25000,
          purpose: 'odds',
          priority: queuePriority,
        });
        used = client.used;

        const list = Array.isArray(result.data?.response) ? result.data.response : [];
        entries.push(...list);
        calls.push({ date: `${lot.leagueId}/${lot.date}`, page: 1, records: list.length });

        if (result.errors.length) {
          if (pageLimitReached(result.errors)) pagesLimited = true;
          else failures.push(`odds ${label}: ${result.errors.join(' | ')}`);
          break;
        }

        // Só marca o lote como coletado quando a resposta veio limpa: um dia
        // barrado pelo limite precisa ser tentado de novo na próxima execução.
        await writeCache(db, {
          key: lotKey(lot),
          endpoint: '/odds',
          params: `league=${lot.leagueId} · season=${lot.season} · date=${lot.date}`,
          ttlSeconds: ODDS_REFRESH_SECONDS,
          records: list.length,
          note: `${label}: ${list.length} partida(s) com cotação`,
        }).catch(() => null);
      } catch (error) {
        failures.push(`odds ${label}: ${String(error?.message || error)}`);
        // Limite do provedor: o restante dos lotes fica para o próximo ciclo.
        if (isThrottleError(error)) rateLimited = true;
        break;
      }
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

    // Fila atendida: cada item volta com a cadência da sua prioridade
    // (CRITICA 60s · FAVORITA 120s · APOSTA_ABERTA 180s · NORMAL 300s).
    if (queueItems.length) await markOddsItemsDone(db, queueItems, { now }).catch(() => 0);

    // Relevância: partida cotada e publicada sobe no critério de
    // confiabilidade (até 10 pontos) — recálculo puro, sem novas chamadas.
    if (quotesByEvent.size) {
      const relevanceConfig = await loadRelevanceConfig(db);
      const relevanceUpdates = [];
      quotesByEvent.forEach((quote) => {
        const patch = {};
        applyRelevancePatch(patch, quote.event, relevanceConfig, { oddsAvailable: true, published: true });
        if (Object.keys(patch).length) relevanceUpdates.push({ id: quote.event.id, ...patch });
      });
      for (const batch of chunkArray(relevanceUpdates, 200)) {
        if (batch.length) await db.Event.bulkUpdate(batch);
      }
    }

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
        endpoint: `/odds?${call.date}`,
        status_code: 200,
        records_returned: call.records,
        cache_hit: false,
        credits_used: 1,
        params: String(call.date),
        note: summary.slice(0, 240),
        error_message: failures.length ? failures.join(' | ').slice(0, 240) : '',
      });
    }

    return Response.json({
      ok: true,
      mode,
      lots: pendingLots.map((lot) => `${lot.name || lot.leagueId} · ${lot.date}`),
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
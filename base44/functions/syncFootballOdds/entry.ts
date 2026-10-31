import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { FOOTBALL_TIMEZONE, footballApiBase } from '../../shared/apiFootball.ts';
import { mapOddsEntry, pageLimitReached, pickBookmaker } from '../../shared/apiFootballOdds.ts';
import { FOOTBALL_CADENCE, ODDS_CURATION } from '../../shared/footballConfig.ts';
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
import { indexByFixtureId, numberOr } from '../../shared/footballSync.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { applyRelevancePatch, loadRelevanceConfig } from '../../shared/relevance.ts';
import {
  dueOddsItems,
  hoursToKickoff,
  markOddsItemsDone,
  refreshOddsQueue,
} from '../../shared/footballOddsQueue.ts';

const LOCK_MS = 4 * 60 * 1000;
const RESERVE_CALLS = 10;
/** Tempo máximo de coleta por execução, para nunca estourar a função. */
const RUN_BUDGET_MS = 45000;
/** Lotes candidatos consultados no cache por execução. */
const MAX_CANDIDATE_LOTS = 40;

/**
 * Motor de cotações PRÉ-JOGO da API-Football.
 *
 * - a partida entra pelo resultado da curadoria (fila de odds), não pelo dia;
 * - uma chamada por lote `competição + temporada + data`, nunca uma por partida;
 * - o cache do lote vale o intervalo da partida mais próxima dele (30 min a 6 h),
 *   então nada é reconsultado sem necessidade;
 * - orçamento compartilhado com as outras rotinas, com reserva preservada;
 * - a margem da casa é aplicada na gravação; partida iniciada não recebe preço.
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
    /** Ação manual: ignora a validade do cache do lote (mantém todo o resto). */
    const force = Boolean(payload?.force);

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const todayKey = localDateString(now, FOOTBALL_TIMEZONE);
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
    limit = effectiveDailyLimit(limit, quotaRecord?.provider_limit);
    if (lockHeld(quotaRecord, nowMs)) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootballOdds', LOCK_MS);
    let used = numberOr(quotaRecord?.used, 0);

    const level = quotaLevel(used, limit);
    const policy = quotaPolicy(level);
    if (level === 3) {
      await releaseLock(db, quotaRecord);
      return Response.json({
        skipped: true,
        reason: `Cotações suspensas: orçamento da API-Football em ${quotaPercent(used, limit)}% (contingência)`,
        quota: { used, limit, level },
      });
    }

    const client = await openFootballClient(db, {
      apiKey,
      base,
      settings,
      day,
      limit,
      reserve: RESERVE_CALLS,
      label: 'cotações pré-jogo api-football',
    });

    /* ----------------------- alvos: fila de curadoria ----------------------- */
    const queue = await refreshOddsQueue(db, { now });
    const due = await dueOddsItems(db, { now, limit: 200 });
    const queuePriority = due.priority || 'NORMAL';

    const inWindow = (event) => {
      const startMs = Date.parse(event?.start_time || '');
      if (!Number.isFinite(startMs) || startMs <= nowMs) return false;
      if (mode === 'today' && localDateString(new Date(startMs), FOOTBALL_TIMEZONE) !== todayKey) return false;
      return true;
    };

    let targets = (due.events || []).filter(inWindow);

    // Sem item vencido (fila recém-criada ou já atendida): usa a própria
    // curadoria, para que a grade nunca fique sem preço por falta de fila.
    if (!targets.length) {
      const fallback = await db.Event.filter(
        {
          source: 'provider',
          status: 'scheduled',
          start_time: { $gt: nowIso },
          relevance_score: { $gte: ODDS_CURATION.minRelevance },
        },
        { limit: 400, sort: '-relevance_score' },
      );
      targets = (fallback.items || []).filter(inWindow);
    }

    const priorityByEvent = new Map();
    (due.items || []).forEach((item) => {
      if (item.event_id) priorityByEvent.set(item.event_id, item.priority);
    });

    // Lote = competição + temporada + data: uma única chamada devolve o preço de
    // todos os jogos daquela competição no dia.
    const lots = new Map();
    targets.forEach((event) => {
      const leagueId = String(event.league_id || '');
      const season = String(event.season || '');
      if (!leagueId || !season || !event.start_time) return;
      const date = localDateString(new Date(event.start_time), FOOTBALL_TIMEZONE);
      const key = `${leagueId}:${season}:${date}`;
      const hours = hoursToKickoff(event.start_time, nowMs);
      const priority = priorityByEvent.get(event.id) || 'NORMAL';
      const current = lots.get(key);
      if (!current) {
        lots.set(key, {
          key,
          leagueId,
          season,
          date,
          name: event.competition_name || '',
          brazilian: Boolean(event.is_brazilian),
          relevance: Number(event.relevance_score) || 0,
          hours,
          hasBets: priority === 'APOSTA_ABERTA',
          priority,
        });
        return;
      }
      current.relevance = Math.max(current.relevance, Number(event.relevance_score) || 0);
      current.hours = Math.min(current.hours, hours);
      current.hasBets = current.hasBets || priority === 'APOSTA_ABERTA';
    });

    const ordered = [...lots.values()].sort(
      (a, b) =>
        Number(b.hasBets) - Number(a.hasBets) ||
        b.relevance - a.relevance ||
        a.hours - b.hours,
    );

    const cacheRows = await db.ApiCache
      .filter(
        { provider: QUOTA_PROVIDER, key: { $in: ordered.slice(0, MAX_CANDIDATE_LOTS).map((lot) => lotCacheKey(lot)) } },
        { limit: 200 },
      )
      .catch(() => ({ items: [] }));
    const freshKeys = new Set(
      (cacheRows.items || [])
        .filter((row) => row.expires_at && Date.parse(row.expires_at) > nowMs)
        .map((row) => row.key),
    );

    const pendingLots = ordered
      .filter((lot) => force || !freshKeys.has(lotCacheKey(lot)))
      .slice(0, ODDS_CURATION.maxLotsPerRun);

    if (!pendingLots.length) {
      await releaseLock(db, quotaRecord);
      return Response.json({
        skipped: true,
        mode,
        queue,
        due: due.items.length,
        reason: targets.length
          ? `As ${ordered.length} competição(ões) da fila já estão com cotação válida`
          : 'Nenhuma partida curada precisa de cotação agora',
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
    const doneLots = [];
    let pagesLimited = false;
    let rateLimited = false;

    for (const lot of pendingLots) {
      if (rateLimited || Date.now() - runStartedAt > RUN_BUDGET_MS) break;
      if (!canSpend(used, limit, RESERVE_CALLS, 1)) {
        failures.push(`orçamento reservado para as outras rotinas: ${used}/${limit}`);
        break;
      }
      const label = `${lot.name || lot.leagueId} · ${lot.date}`;
      const maxPages = Math.max(1, Number(FOOTBALL_CADENCE.oddsMaxPages) || 1);
      let pagesRead = 0;
      let lotRecords = 0;
      let lotClean = true;
      try {
        for (let page = 1; page <= maxPages; page += 1) {
          if (Date.now() - runStartedAt > RUN_BUDGET_MS) break;
          if (!canSpend(used, limit, RESERVE_CALLS, 1)) break;
          const result = await client.call(
            '/odds',
            {
              league: lot.leagueId,
              season: lot.season,
              date: lot.date,
              ...(page > 1 ? { page } : {}),
            },
            { timeoutMs: 25000, purpose: 'odds', priority: queuePriority },
          );
          used = client.used;
          pagesRead += 1;

          const list = Array.isArray(result.data?.response) ? result.data.response : [];
          entries.push(...list);
          lotRecords += list.length;
          calls.push({ date: `${lot.leagueId}/${lot.date}`, page, records: list.length });

          if (result.errors.length) {
            if (pageLimitReached(result.errors)) pagesLimited = true;
            else failures.push(`odds ${label} (página ${page}): ${result.errors.join(' | ')}`);
            lotClean = false;
            break;
          }

          const totalPages = Number(result.data?.paging?.total) || 0;
          if (!list.length) break;
          if (totalPages && page >= totalPages) break;
          if (!totalPages && list.length < 10) break;
        }

        if (lotClean && pagesRead) {
          doneLots.push(label);
          // A validade do lote segue a partida mais próxima: um jogo em 3 h é
          // reconsultado em 30 min; um jogo em 5 dias, só em 6 h.
          await writeCache(db, {
            key: lotCacheKey(lot),
            endpoint: '/odds',
            params: `league=${lot.leagueId} · season=${lot.season} · date=${lot.date}`,
            ttlSeconds: oddsLotTtlSeconds(lot.hours),
            records: lotRecords,
            note: `${label}: ${lotRecords} partida(s) em ${pagesRead} página(s)`,
          }).catch(() => null);
        }
      } catch (error) {
        failures.push(`odds ${label}: ${String(error?.message || error)}`);
        if (isThrottleError(error)) rateLimited = true;
        break;
      }
    }

    /* ------------------------- gravação dos mercados ------------------------- */
    const known = await indexByFixtureId(
      db,
      entries.map((entry) => String(entry?.fixture?.id || '')).filter(Boolean),
    );
    const quotesByEvent = new Map();
    entries.forEach((entry) => {
      const fixtureId = String(entry?.fixture?.id || '');
      const eventRow = known.get(fixtureId);
      if (!eventRow || !eventRow.start_time) return;
      // Partida iniciada não recebe mais cotação pré-jogo.
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

    // Fila atendida: cada item volta com a cadência da sua prioridade.
    if (due.items.length) await markOddsItemsDone(db, due.items, { now }).catch(() => 0);

    // Relevância: partida cotada e publicada sobe no critério de confiabilidade.
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
      'odds pré-jogo',
      `${calls.length} chamada(s)`,
      `${doneLots.length} lote(s)`,
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
      note: summary.slice(0, 400),
    });

    for (const call of calls) {
      await db.ApiUsageLog.create({
        provider: 'api_football',
        endpoint: `/odds?${call.date}`,
        purpose: 'odds',
        status_code: 200,
        records_returned: call.records,
        cache_hit: false,
        credits_used: 1,
        note: 'ledger',
        params: String(call.date),
        error_message: failures.length ? failures.join(' | ').slice(0, 240) : '',
      });
    }

    return Response.json({
      ok: true,
      mode,
      queue,
      due: due.items.length,
      lots: doneLots,
      calls: calls.length,
      events_with_odds: written.events,
      odds: written.odds,
      markets: written.markets,
      published: written.published,
      quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
      policy,
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

/** Chave de cache do lote: uma por competição + temporada + data. */
function lotCacheKey(lot) {
  return `odds:lot:${lot.leagueId}:${lot.season}:${lot.date}`;
}
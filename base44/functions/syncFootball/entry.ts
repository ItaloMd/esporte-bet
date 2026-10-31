import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  footballApiBase,
  mapFixture,
  parseAccountStatus,
  parseFixtureEvents,
  parseFixtureStatistics,
} from '../../shared/apiFootball.ts';
import { isThrottleError, openFootballClient } from '../../shared/footballClient.ts';
import { FOOTBALL_CADENCE } from '../../shared/footballConfig.ts';
import { upsertMarketCapability } from '../../shared/footballMarkets.ts';
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
  readCache,
  releaseLock,
  saveQuota,
  writeCache,
} from '../../shared/footballQuota.ts';
import { localDateString, slugify } from '../../shared/oddsApi.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { indexByFixtureId, numberOr, upcomingDates } from '../../shared/footballSync.ts';
import { buildBetAudit } from '../../shared/footballAudit.ts';
import { applyRelevancePatch, loadRelevanceConfig } from '../../shared/relevance.ts';
import { isBrazilianMatch } from '../../shared/brazilianCompetitions.ts';

const LOCK_MS = 4 * 60 * 1000;
const CREATE_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;
const CREATE_BEHIND_MS = 60 * 60 * 1000;
const MATCH_TOLERANCE_MS = 36 * 60 * 60 * 1000;
const MAX_CALENDAR_DAYS = 7;
/** Partidas por chamada em lote: limite documentado de /fixtures?ids. */
const IDS_PER_CALL = 20;
/** Após N consultas sem encerramento, a partida vai para revisão manual. */
const MAX_AUDIT_CHECKS = 12;
/** Teto de partidas auditadas por execução, protegendo a cota diária. */
const MAX_AUDIT_EVENTS = 300;
/** Teto de consultas de estatísticas por execução: 1 crédito por partida com apostas. */
const MAX_STATS_PER_RUN = 15;
/** Teto de consultas de eventos (gols) por execução: 1 crédito por partida com apostas. */
const MAX_EVENTS_PER_RUN = 15;

/** O plano tem limite por minuto além da cota diária: nesse caso a execução para. */
function isRateLimit(message) {
  return /too many requests|requests per minute|rate limit/i.test(String(message || ''));
}

/** O plano recusa datas fora do alcance: nada é consultado até a janela se renovar. */
function isPlanBlocked(message) {
  return /free plans do not have access/i.test(String(message || ''));
}

/** Segundos até o fim do dia brasileiro, quando a janela do plano se renova. */
function secondsUntilEndOfDay(now) {
  const dayKey = localDateString(now, FOOTBALL_TIMEZONE);
  // America/Sao_Paulo é UTC-3 durante todo o ano (sem horário de verão).
  const end = Date.parse(`${dayKey}T23:59:59-03:00`);
  return Math.max(60, Math.round((end - now.getTime()) / 1000));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventKey(homeName, awayName) {
  return `${slugify(homeName)}|${slugify(awayName)}`;
}

/** Horário da primeira auditoria: início previsto + offset (padrão 2 horas). */
function firstAuditAt(startMs, settings) {
  const offsetHours = numberOr(settings.football_audit_offset_hours, 2);
  return new Date(startMs + offsetHours * 3600000).toISOString();
}

/** Próxima verificação de uma partida ainda em andamento: 30 min, depois 15 min. */
function nextAuditAt(nowMs, settings, checks) {
  const recheckMinutes = numberOr(settings.football_audit_recheck_minutes, 30);
  const fastMinutes = numberOr(settings.football_audit_fast_minutes, 15);
  return new Date(nowMs + (checks >= 2 ? fastMinutes : recheckMinutes) * 60000).toISOString();
}

/**
 * Partidas com auditoria vencida: nunca consultadas antes do horário agendado.
 * Somente partidas com aposta pendente entram — partida sem aposta não gera
 * consulta de resultado, mesmo publicada com cotação. A seção Ao Vivo é
 * alimentada pelo detector central, que cobre os jogos em andamento em uma
 * única chamada.
 */
async function loadDueEvents(db, nowIso, openEventIds = []) {
  if (!openEventIds.length) return [];
  const due = [];
  for (const ids of chunkArray(openEventIds, 100)) {
    const page = await db.Event.filter(
      {
        id: { $in: ids },
        fixture_id: { $exists: true },
        next_check_at: { $lte: nowIso },
        status: { $in: ['scheduled', 'live'] },
      },
      { limit: 500, sort: 'next_check_at' },
    );
    due.push(...(page.items || []));
    if (due.length >= MAX_AUDIT_EVENTS) break;
  }
  return due.slice(0, MAX_AUDIT_EVENTS);
}

/** Campos comuns gravados em qualquer partida vinda da fonte. */
function fixtureFields(fixture, nowIso) {
  const fields = {
    fixture_id: fixture.fixture_id,
    last_sync_at: nowIso,
    live_updated_at: nowIso,
    status: fixture.status,
    phase: fixture.phase,
    phase_label: fixture.phase_label,
    minute: fixture.minute,
  };
  if (fixture.home_score !== null && fixture.away_score !== null) {
    fields.home_score = fixture.home_score;
    fields.away_score = fixture.away_score;
  }
  if (fixture.ht_home_score !== null && fixture.ht_away_score !== null) {
    fields.ht_home_score = fixture.ht_home_score;
    fields.ht_away_score = fixture.ht_away_score;
  }
  if (fixture.season) fields.season = fixture.season;
  // ID oficial da competição (league.id): base da pontuação de relevância.
  if (fixture.competition_id) fields.league_id = fixture.competition_id;
  // Classificação brasileira pela configuração centralizada: alimenta o Ao Vivo.
  fields.is_brazilian = isBrazilianMatch({
    leagueId: fixture.competition_id,
    country: fixture.country,
    competitionName: fixture.competition_name,
  });
  if (fixture.reg_home_score !== null && fixture.reg_away_score !== null) {
    fields.reg_home_score = fixture.reg_home_score;
    fields.reg_away_score = fixture.reg_away_score;
  }
  if (fixture.extra_time) fields.extra_time = true;
  if (fixture.penalties) fields.penalties = true;
  if (fixture.finished) {
    fields.result_confirmed_at = nowIso;
    fields.result_source = 'api_football';
    fields.tracking = 'finished';
    fields.published = false;
    fields.odds_status = 'unavailable';
  }
  if (fixture.void) {
    fields.tracking = 'finished';
    fields.published = false;
    fields.odds_status = 'unavailable';
  }
  return fields;
}

/** Estado de liquidação: nunca rebaixa uma partida já liquidada. */
function settlementStateFor(fixture, event) {
  if (event?.settlement_state === 'settled') return null;
  if (fixture.review) return 'review';
  if (fixture.live || fixture.finished) return 'waiting';
  return 'none';
}

function buildPatch(fixture, event, nowIso, settings) {
  const fields = fixtureFields(fixture, nowIso);
  const patch = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (event[key] === value) return;
    patch[key] = value;
  });
  // Campos de texto vazios nunca apagam um valor já conhecido.
  if (fixture.venue && !event.venue) patch.venue = fixture.venue;
  if (fixture.home_team_crest && !event.home_team_crest) patch.home_team_crest = fixture.home_team_crest;
  if (fixture.away_team_crest && !event.away_team_crest) patch.away_team_crest = fixture.away_team_crest;
  const settlement = settlementStateFor(fixture, event);
  if (settlement) patch.settlement_state = settlement;
  // Autocorreção: partida em aberto sem auditoria agendada recebe o horário padrão.
  const startMs = Date.parse(fixture.start_time || '');
  if (!event.next_check_at && Number.isFinite(startMs) && (fixture.status === 'scheduled' || fixture.status === 'live')) {
    patch.next_check_at = firstAuditAt(startMs, settings);
  }
  return patch;
}

function buildCreate(fixture, nowIso, competitionId, settings) {
  const start = new Date(fixture.start_time);
  const localDate = localDateString(start, FOOTBALL_TIMEZONE);
  const todayKey = localDateString(new Date(nowIso), FOOTBALL_TIMEZONE);
  return {
    sport_slug: 'futebol',
    competition_id: competitionId || '',
    competition_name: fixture.competition_name,
    country: fixture.country,
    home_team_id: fixture.home_team_id || '',
    home_team_name: fixture.home_team_name,
    home_team_crest: fixture.home_team_crest || '',
    away_team_id: fixture.away_team_id || '',
    away_team_name: fixture.away_team_name,
    away_team_crest: fixture.away_team_crest || '',
    start_time: fixture.start_time,
    local_date: localDate,
    status: fixture.status,
    tracking: localDate === todayKey ? 'today' : 'upcoming',
    odds_status: 'unavailable',
    // Nasce sem publicação: só aparece na grade quando o provedor cota o jogo.
    published: false,
    source: 'provider',
    discovered_at: nowIso,
    last_sync_at: nowIso,
    live_updated_at: nowIso,
    // Auditoria de encerramento: primeira consulta no início + offset (2h).
    next_check_at: firstAuditAt(Date.parse(fixture.start_time), settings),
    audit_checks: 0,
    ...fixtureFields(fixture, nowIso),
    settlement_state: settlementStateFor(fixture, null) || 'none',
  };
}

/** Candidatos na mesma janela de horário, para casar partidas por equipes. */
async function indexByName(db, fixtures) {
  const times = fixtures.map((fixture) => Date.parse(fixture.start_time)).filter(Number.isFinite);
  if (!times.length) return new Map();
  const from = new Date(Math.min(...times) - MATCH_TOLERANCE_MS).toISOString();
  const to = new Date(Math.max(...times) + MATCH_TOLERANCE_MS).toISOString();

  const index = new Map();
  let cursor = null;
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter({ start_time: { $gte: from, $lte: to } }, { limit: 500, ...(cursor ? { cursor } : {}) });
    (page.items || []).forEach((event) => {
      const key = eventKey(event.home_team_name, event.away_team_name);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(event);
    });
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return index;
}

function pickCandidate(candidates, fixture) {
  if (!candidates?.length) return null;
  const target = Date.parse(fixture.start_time);
  const within = candidates.filter((event) => Math.abs(Date.parse(event.start_time) - target) <= MATCH_TOLERANCE_MS);
  if (!within.length) return null;
  within.sort((a, b) => Math.abs(Date.parse(a.start_time) - target) - Math.abs(Date.parse(b.start_time) - target));
  // Prefere a partida que ainda não recebeu um vínculo de fixture.
  return within.find((event) => !event.fixture_id) || within[0];
}

/**
 * Sincronização econômica da API-Football, em dois modos:
 *
 * - `calendar` (importação diária, 00:10): busca as partidas do dia e do dia
 *   seguinte em lote, uma chamada por data, e agenda a auditoria de cada
 *   partida para o início + 2 horas. O botão manual busca as mesmas datas,
 *   preenchendo a grade imediatamente.
 * - `audit` (rotina de 5 minutos): consulta em lote (/fixtures?ids, até 20
 *   partidas por chamada) apenas as partidas cujo horário de auditoria venceu.
 *   Nenhuma consulta é feita durante o jogo antes desse horário. Partida
 *   encerrada (FT, prorrogação ou pênaltis) grava o resultado e nunca mais é
 *   consultada; partida em andamento é reconsultada em 30 minutos e, a partir
 *   da segunda verificação, a cada 15 minutos até encerrar.
 */
export default async function (req) {
  let base44;
  let quotaRecord = null;
  let settings = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const requested = String(payload?.mode || 'audit');
    const mode = ['calendar', 'audit', 'auto', 'relevance'].includes(requested) ? requested : 'audit';

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    settings = settingsPage.items?.[0] || null;
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
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootball', LOCK_MS);
    let used = numberOr(quotaRecord?.used, 0);

    const job = await db.SyncJob.create({
      provider: 'api_football',
      trigger: payload?.trigger === 'manual' ? 'manual' : 'scheduled',
      job_type: mode === 'calendar' ? 'calendar' : 'audit',
      status: 'running',
      started_at: nowIso,
      triggered_by: user.email,
    });

    const failures = [];
    const calls = [];
    const quotaPatch = {};
    const applyQuota = (quota) => {
      if (!quota) return;
      if (quota.limit !== null && quota.limit !== undefined) quotaPatch.provider_limit = quota.limit;
      if (quota.remaining !== null && quota.remaining !== undefined) quotaPatch.provider_remaining = quota.remaining;
      if (quota.used !== null && quota.used !== undefined) quotaPatch.provider_used = quota.used;
    };

    // `/status` não consome a cota diária e revela o limite real da conta, mas
    // passa pela fila global: espaçamento de 200 ms e janela por minuto.
    let account = null;
    let statusError = '';
    try {
      const statusClient = await openFootballClient(db, {
        apiKey,
        base,
        settings,
        day,
        limit,
        reserve: 0,
        label: 'status da conta',
      });
      const statusResult = await statusClient.call('/status', {}, { charge: false, purpose: 'status' });
      account = parseAccountStatus(statusResult.data);
      applyQuota(statusResult.quota);
      if (statusResult.errors.length) statusError = statusResult.errors.join(' | ');
    } catch (error) {
      statusError = String(error?.message || error);
    }

    // A contagem oficial do provedor (/status) é a verdade sobre o consumo: o
    // contador interno é corrigido para baixo quando cobrou chamadas que o
    // provedor não cobrou (ex.: respostas recusadas por limite por minuto).
    if (account?.current !== null && account?.current !== undefined && account.current < used) {
      quotaRecord = await saveQuota(db, quotaRecord, {
        ...(quotaRecord?.id ? {} : { day }),
        used: account.current,
        limit,
        level: quotaLevel(account.current, limit),
        notes: 'Consumo interno corrigido pela contagem oficial do provedor',
      });
      used = account.current;
    }

    // O /status revela o limite real do plano: o orçamento se ajusta na hora.
    if (account?.limit_day) {
      limit = effectiveDailyLimit(numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT), account.limit_day);
    }

    const level = quotaLevel(used, limit);
    const policy = quotaPolicy(level);
    const planName = account?.plan || settings.football_plan || '';
    // Camada central de requisições: pausa pós-429, limite por minuto e
    // orçamento diário compartilhados com todas as outras rotinas.
    const client = await openFootballClient(db, {
      apiKey,
      base,
      settings,
      day,
      limit,
      reserve: policy.reserve,
      label: `syncFootball ${mode}`,
    });

    /* ---------------- relevância: recálculo sem consumo de API ---------------- */
    // Repontua todas as partidas da fonte a partir dos dados já armazenados:
    // custo zero de chamadas, usado como backfill e depois de mudanças de
    // configuração nos pesos e na tabela de competições prioritárias.
    if (mode === 'relevance') {
      const relevanceConfig = await loadRelevanceConfig(db);
      const relevanceUpdates = [];
      let checked = 0;
      let cursor = null;
      for (let round = 0; round < 60; round += 1) {
        const page = await db.Event.filter(
          { source: 'provider' },
          { limit: 500, sort: 'start_time', ...(cursor ? { cursor } : {}) },
        );
        const items = page.items || [];
        if (!items.length) break;
        items.forEach((event) => {
          const patch = {};
          applyRelevancePatch(patch, event, relevanceConfig);
          if (Object.keys(patch).length) relevanceUpdates.push({ id: event.id, ...patch });
        });
        checked += items.length;
        cursor = page.next_cursor;
        if (!page.has_more) break;
      }
      for (const batch of chunkArray(relevanceUpdates, 200)) {
        if (batch.length) await db.Event.bulkUpdate(batch);
      }

      const summary = [
        'relevância',
        `${checked} partida(s) verificada(s)`,
        `${relevanceUpdates.length} repontuada(s)`,
        'custo 0 chamada(s)',
        `orçamento ${used}/${limit}`,
      ].join(' · ');

      await db.ProviderSettings.update(settings.id, {
        football_last_sync_at: nowIso,
        football_last_status: 'success',
        football_last_summary: summary,
      });

      const savedQuota = await saveQuota(db, quotaRecord, {
        ...(quotaRecord?.id ? {} : { day }),
        used,
        limit,
        level: quotaLevel(used, limit),
        ...quotaPatch,
        last_status_at: nowIso,
        last_status_code: 200,
        last_error: statusError,
      });
      await releaseLock(db, savedQuota || quotaRecord);

      await db.SyncJob.update(job.id, {
        status: 'success',
        finished_at: new Date().toISOString(),
        requests_used: 0,
        records_upserted: relevanceUpdates.length,
        error_message: '',
      });

      return Response.json({
        ok: true,
        mode,
        events_checked: checked,
        events_rescored: relevanceUpdates.length,
        quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
        summary,
      });
    }

    /* ------------------------- importação diária ------------------------- */
    if (mode === 'calendar') {
      const windowDays = Math.min(Math.max(numberOr(settings.football_window_days, MAX_CALENDAR_DAYS), 1), MAX_CALENDAR_DAYS);
      // Importação diária: uma data já importada não é consultada de novo no dia.
      const calendarRefreshSeconds = numberOr(settings.football_calendar_refresh_seconds, FOOTBALL_CADENCE.calendarRefreshSeconds);
      // A rotina das 00:10 e o botão manual buscam as mesmas datas: o dia atual
      // (às 00:10, o dia que acabou de começar) e o(s) seguinte(s).
      const todayKey = localDateString(now, FOOTBALL_TIMEZONE);
      const dates = [...new Set([todayKey, ...upcomingDates(now, Math.max(1, windowDays) - 1)])];
      const planDays = policy.calendarDays > 0 ? dates.slice(0, policy.calendarDays) : dates;

      const fixtures = [];
      const syncedDays = [];
      let rateLimited = false;
      for (const date of planDays) {
        if (rateLimited || !canSpend(used, limit, policy.reserve, 1)) break;
        const cached = await readCache(db, `fixtures:date:${date}`);
        if (cached?.fresh) continue;
        // Limite por minuto compartilhado: as consultas de calendário são
        // espaçadas para não disputar o minuto com as demais rotinas.
        if (syncedDays.length) await wait(10000);
        try {
          const result = await client.call('/fixtures', { date, timezone: FOOTBALL_TIMEZONE }, { purpose: 'calendar' });
          used = client.used;
          calls.push({ endpoint: `/fixtures?date=${date}`, records: result.results, errors: result.errors });
          if (result.errors.length) {
            failures.push(`importação ${date}: ${result.errors.join(' | ')}`);
            if (result.errors.some(isRateLimit)) rateLimited = true;
            if (result.errors.some(isPlanBlocked)) {
              // O provedor recusou a data: as seguintes também estão fora do
              // alcance, então nenhuma delas é consultada hoje.
              for (const blocked of planDays.slice(planDays.indexOf(date))) {
                await writeCache(db, {
                  key: `fixtures:date:${blocked}`,
                  endpoint: '/fixtures',
                  params: `date=${blocked}`,
                  ttlSeconds: secondsUntilEndOfDay(now),
                  records: 0,
                  note: 'Data fora do alcance do plano atual',
                });
              }
              rateLimited = true;
            }
            continue;
          }
          const list = Array.isArray(result.data?.response) ? result.data.response : [];
          list.map(mapFixture).forEach((item) => item.fixture_id && item.start_time && fixtures.push(item));
          syncedDays.push(date);
          await writeCache(db, {
            key: `fixtures:date:${date}`,
            endpoint: '/fixtures',
            params: `date=${date}`,
            ttlSeconds: calendarRefreshSeconds,
            records: result.results,
            note: `${list.length} partida(s) importada(s) para ${date}`,
          });
        } catch (error) {
          failures.push(`importação ${date}: ${String(error?.message || error)}`);
          // Pausa pós-429 ou limite por minuto: as demais datas ficam para a
          // próxima execução — nenhum ciclo de retentativa.
          if (isThrottleError(error)) rateLimited = true;
        }
      }

      const unique = new Map();
      fixtures.forEach((fixture) => unique.set(fixture.fixture_id, fixture));
      const mapped = [...unique.values()];

      const competitionsPage = await db.Competition.filter({ active: true }, { limit: 300 });
      const competitionsByName = new Map(
        (competitionsPage.items || []).map((row) => [slugify(row.name), row]),
      );

      const known = await indexByFixtureId(db, mapped.map((fixture) => fixture.fixture_id));
      const unresolved = mapped.filter((fixture) => !known.has(fixture.fixture_id));
      const byName = unresolved.length ? await indexByName(db, unresolved) : new Map();

      const updates = [];
      const creations = [];
      const relevanceConfig = await loadRelevanceConfig(db);
      mapped.forEach((fixture) => {
        const linked = known.get(fixture.fixture_id) || pickCandidate(byName.get(eventKey(fixture.home_team_name, fixture.away_team_name)), fixture);
        if (linked) {
          const patch = buildPatch(fixture, linked, nowIso, settings);
          // Relevância: recalculada na importação, quando a rodada é conhecida.
          applyRelevancePatch(
            patch,
            {
              ...linked,
              league_id: linked.league_id || fixture.competition_id,
              competition_name: linked.competition_name || fixture.competition_name,
              country: linked.country || fixture.country,
            },
            relevanceConfig,
            { round: fixture.round },
          );
          if (Object.keys(patch).length) updates.push({ id: linked.id, ...patch });
          return;
        }
        const competition = competitionsByName.get(slugify(fixture.competition_name));
        const startMs = Date.parse(fixture.start_time);
        const withinWindow = startMs >= nowMs - CREATE_BEHIND_MS && startMs <= nowMs + CREATE_AHEAD_MS;
        if (!settings.football_create_events || !withinWindow) return;
        // A curadoria do que aparece na grade é feita pela cotação: a partida é
        // criada sem publicação e só vira visível quando o provedor cota o jogo.
        // A competição ativa é vinculada quando o nome casa com o catálogo.
        const creation = buildCreate(fixture, nowIso, competition?.id || '', settings);
        applyRelevancePatch(creation, fixture, relevanceConfig, { round: fixture.round });
        creations.push(creation);
      });

      for (const batch of chunkArray(updates, 200)) await db.Event.bulkUpdate(batch);
      for (const batch of chunkArray(creations, 100)) await db.Event.bulkCreate(batch);

      const summary = [
        'importação',
        `${calls.length} chamada(s)`,
        `${syncedDays.length} data(s)`,
        `${mapped.length} partida(s) lida(s)`,
        `${updates.length} atualizada(s)`,
        `${creations.length} criada(s)`,
        `auditoria agendada para ${creations.length ? 'início + 2h' : '—'}`,
        `orçamento ${used}/${limit}`,
      ].join(' · ');

      await db.ProviderSettings.update(settings.id, {
        football_last_sync_at: nowIso,
        football_last_status: failures.length ? 'partial' : 'success',
        football_last_error: failures.length ? failures.join(' | ').slice(0, 400) : '',
        football_last_summary: summary,
        football_alert_level: quotaLevel(used, limit),
        football_account_limit: account?.limit_day ?? settings.football_account_limit ?? null,
        football_account_remaining: account?.current !== null && account?.current !== undefined
          ? Math.max(0, (account.limit_day || 0) - account.current)
          : settings.football_account_remaining ?? null,
        football_plan: planName,
        ...(syncedDays.length ? { football_last_calendar_at: nowIso } : {}),
      });

      const savedQuota = await saveQuota(db, quotaRecord, {
        ...(quotaRecord?.id ? {} : { day }),
        used,
        limit,
        level: quotaLevel(used, limit),
        ...quotaPatch,
        last_status_at: nowIso,
        last_status_code: 200,
        last_error: [...failures, ...(statusError ? [`status: ${statusError}`] : [])].join(' | ').slice(0, 400),
      });
      await releaseLock(db, savedQuota || quotaRecord);

      await db.SyncJob.update(job.id, {
        status: failures.length ? 'partial' : 'success',
        finished_at: new Date().toISOString(),
        requests_used: calls.length,
        records_upserted: updates.length + creations.length,
        error_message: failures.length ? failures.join(' | ').slice(0, 400) : '',
      });

      for (const call of calls) {
        await db.ApiUsageLog.create({
          provider: 'api_football',
          endpoint: call.endpoint,
          status_code: 200,
          records_returned: call.records,
          cache_hit: false,
          credits_used: 1,
          params: `dia=${day}`,
          note: (call.errors?.length ? call.errors.join(' | ') : summary).slice(0, 240),
          error_message: call.errors?.length ? call.errors.join(' | ').slice(0, 240) : '',
        });
      }

      return Response.json({
        ok: true,
        mode,
        calls: calls.length,
        days_synced: syncedDays,
        fixtures_read: mapped.length,
        events_updated: updates.length,
        events_created: creations.length,
        quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit), alerts: quotaRecord?.alerts || [] },
        account,
        failures,
        status_error: statusError,
        summary,
      });
    }

    /* --------------------- auditoria de encerramento --------------------- */
    // Apostas pendentes sempre precisam de resultado, tenham cotação ou não.
    const openEventIds = new Set();
    const openBetCounts = new Map();
    const openMarketKeys = new Map();
    let openCursor = null;
    for (let round = 0; round < 4; round += 1) {
      const page = await db.SimulationSelection.filter({ status: 'open' }, { limit: 500, ...(openCursor ? { cursor: openCursor } : {}) });
      (page.items || []).forEach((row) => {
        openEventIds.add(row.event_id);
        openBetCounts.set(row.event_id, (openBetCounts.get(row.event_id) || 0) + 1);
        if (!openMarketKeys.has(row.event_id)) openMarketKeys.set(row.event_id, new Set());
        openMarketKeys.get(row.event_id).add(String(row.market_key || ''));
      });
      openCursor = page.next_cursor;
      if (!page.has_more) break;
    }
    let due = await loadDueEvents(db, nowIso, [...openEventIds]);
    if (policy.criticalOnly) {
      // Contingência: só partidas com apostas pendentes consomem créditos.
      due = due.filter((event) => openEventIds.has(event.id));
    }

    const updates = [];
    const auditLogs = [];
    const finishedAudits = [];
    let audited = 0;
    let confirmed = 0;
    let stillRunning = 0;
    let reviewFlagged = 0;
    let rateLimited = false;

    for (const batch of chunkArray(due, IDS_PER_CALL)) {
      if (rateLimited || !canSpend(used, limit, policy.reserve, 1)) break;
      try {
        const ids = batch.map((event) => event.fixture_id);
        const result = await client.call('/fixtures', { ids: ids.join('-') }, { purpose: 'audit' });
        used = client.used;
        calls.push({ endpoint: `/fixtures?ids=${ids.length}`, records: result.results, errors: result.errors });
        if (result.errors.length) {
          failures.push(`auditoria: ${result.errors.join(' | ')}`);
          if (result.errors.some(isRateLimit)) rateLimited = true;
          break;
        }

        const response = Array.isArray(result.data?.response) ? result.data.response : [];
        const byId = new Map(response.map((row) => [String(row?.fixture?.id), row]));

        for (const event of batch) {
          const raw = byId.get(String(event.fixture_id));
          const fixture = raw ? mapFixture(raw) : null;
          const checks = numberOr(event.audit_checks, 0) + 1;
          const patch = fixture ? buildPatch(fixture, event, nowIso, settings) : {};
          patch.audit_checks = checks;
          let outcome = '';

          if (fixture && (fixture.finished || fixture.void || fixture.review)) {
            // Encerrada, não disputada ou para revisão manual: nunca mais consultada.
            patch.next_check_at = null;
            if (fixture.finished) {
              confirmed += 1;
              outcome = 'encerrada';
              finishedAudits.push({ event, fixture });
            } else if (fixture.void) {
              outcome = 'não disputada';
            } else {
              reviewFlagged += 1;
              outcome = 'revisão manual';
            }
          } else if (checks >= MAX_AUDIT_CHECKS) {
            // Limite de consultas atingido sem definição: decide um humano.
            patch.next_check_at = null;
            patch.settlement_state = 'review';
            reviewFlagged += 1;
            outcome = 'limite de consultas atingido, em revisão';
          } else {
            // Em andamento ou sem retorno: reconsulta em 30 min, depois 15 min.
            patch.next_check_at = nextAuditAt(nowMs, settings, checks);
            stillRunning += 1;
            outcome = fixture ? `em andamento (${fixture.phase_label || fixture.phase})` : 'sem retorno do provedor';
          }

          updates.push({ id: event.id, ...patch });
          audited += 1;
          // Registro por partida: fixture, horário, status, resultado e nº de consultas.
          auditLogs.push({
            provider: 'api_football',
            endpoint: '/fixtures?ids',
            status_code: 200,
            records_returned: fixture ? 1 : 0,
            cache_hit: false,
            credits_used: 0,
            params: `fixture_id=${event.fixture_id} · consulta nº ${checks}`,
            note: `status ${fixture ? fixture.phase : 'SEM RETORNO'} · placar ${
              fixture && fixture.home_score !== null && fixture.away_score !== null ? `${fixture.home_score}x${fixture.away_score}` : '—'
            } · ${outcome}`,
          });
        }
      } catch (error) {
        failures.push(`auditoria: ${String(error?.message || error)}`);
        break;
      }
    }

    for (const batch of chunkArray(updates, 200)) await db.Event.bulkUpdate(batch);
    for (const batch of chunkArray(auditLogs, 100)) await db.ApiUsageLog.bulkCreate(batch);

    /* -------- auditoria de apostas: placar + estatísticas por encerramento -------- */
    // Toda partida encerrada recebe a auditoria de mercados pelo placar (custo 0);
    // as estatísticas oficiais (escanteios e cartões) só são consultadas quando
    // há apostas pendentes na partida, protegendo a cota diária.
    const betAudits = [];
    const eventStatUpdates = [];
    const capabilitySamples = [];
    let statisticsCalls = 0;
    let eventsCalls = 0;
    let throttled = false;
    for (const { event, fixture } of finishedAudits) {
      // Fonte pausada/limitada no meio da auditoria: o resto fica para depois.
      if (throttled) break;
      const hasBets = openEventIds.has(event.id);
      const marketKeys = openMarketKeys.get(event.id) || new Set();
      let statistics = null;
      let statisticsSource = '';
      if (hasBets && statisticsCalls < MAX_STATS_PER_RUN && canSpend(used, limit, policy.reserve, 1)) {
        try {
          const statsResult = await client.call('/fixtures/statistics', { fixture: fixture.fixture_id }, { purpose: 'statistics' });
          used = client.used;
          statisticsCalls += 1;
          statistics = parseFixtureStatistics(statsResult.data);
          statisticsSource = 'api_football';
          calls.push({ endpoint: `/fixtures/statistics?fixture=${fixture.fixture_id}`, records: Number(statsResult.results) || 0, errors: statsResult.errors });
        } catch (error) {
          failures.push(`estatísticas ${fixture.fixture_id}: ${String(error?.message || error)}`);
          if (isThrottleError(error)) throttled = true;
        }
      }

      // Eventos da partida (gols): necessários para "time marca o primeiro gol".
      let events = null;
      let eventsSource = '';
      if (hasBets && marketKeys.has('first_goal') && eventsCalls < MAX_EVENTS_PER_RUN && canSpend(used, limit, policy.reserve, 1)) {
        try {
          const eventsResult = await client.call('/fixtures/events', { fixture: fixture.fixture_id }, { purpose: 'events' });
          used = client.used;
          eventsCalls += 1;
          events = parseFixtureEvents(eventsResult.data, {
            homeName: event.home_team_name,
            awayName: event.away_team_name,
          });
          eventsSource = 'api_football';
          calls.push({ endpoint: `/fixtures/events?fixture=${fixture.fixture_id}`, records: Number(eventsResult.results) || 0, errors: eventsResult.errors });
        } catch (error) {
          failures.push(`eventos ${fixture.fixture_id}: ${String(error?.message || error)}`);
          if (isThrottleError(error)) throttled = true;
        }
      }

      // Escanteios, cartões e primeiro gol ficam na própria partida: a
      // liquidação lê daí, e a auditoria registra o relatório completo.
      const statsPatch = {};
      if (statistics && statistics.corners_home !== null && statistics.corners_away !== null) {
        statsPatch.corners_home = statistics.corners_home;
        statsPatch.corners_away = statistics.corners_away;
      }
      if (statistics && statistics.cards_home !== null && statistics.cards_away !== null) {
        statsPatch.cards_home = statistics.cards_home;
        statsPatch.cards_away = statistics.cards_away;
      }
      if (events?.first_goal) {
        statsPatch.first_goal_minute = events.first_goal.minute;
        statsPatch.first_goal_team = events.first_goal.side;
      }
      if (Object.keys(statsPatch).length) {
        eventStatUpdates.push({ id: event.id, ...statsPatch });
      }

      betAudits.push(buildBetAudit(event, fixture, {
        betCount: openBetCounts.get(event.id) || 0,
        statistics,
        statisticsSource,
        events,
        eventsSource,
      }));
      capabilitySamples.push({ event, statistics, events });
    }
    for (const batch of chunkArray(betAudits, 100)) {
      if (batch.length) await db.BetAudit.bulkCreate(batch);
    }
    for (const batch of chunkArray(eventStatUpdates, 200)) {
      if (batch.length) await db.Event.bulkUpdate(batch);
    }
    // Descoberta de capacidade por liga/temporada: o que a fonte realmente fornece.
    for (const sample of capabilitySamples) {
      await upsertMarketCapability(db, sample.event, sample.statistics, sample.events).catch(() => null);
    }

    // Próxima auditoria prevista: o evento com horário mais cedo ainda futuro.
    const nextDuePage = await db.Event.filter({ next_check_at: { $gte: nowIso } }, { sort: 'next_check_at', limit: 1 });
    const nextAuditIso = nextDuePage.items?.[0]?.next_check_at || null;

    const summary = [
      'auditoria',
      `${calls.length} chamada(s) em lote`,
      `${audited} partida(s) verificada(s)`,
      `${confirmed} encerrada(s)`,
      `${stillRunning} em andamento`,
      `${reviewFlagged} em revisão`,
      `${betAudits.length} auditoria(s) de aposta`,
      nextAuditIso ? `próxima ${nextAuditIso}` : 'sem auditoria pendente',
      `orçamento ${used}/${limit}`,
    ].join(' · ');

    await db.ProviderSettings.update(settings.id, {
      football_last_sync_at: nowIso,
      football_last_status: failures.length ? 'partial' : 'success',
      football_last_error: failures.length ? failures.join(' | ').slice(0, 400) : '',
      football_last_summary: summary,
      football_alert_level: quotaLevel(used, limit),
      football_next_run_at: nextAuditIso,
      football_account_limit: account?.limit_day ?? settings.football_account_limit ?? null,
      football_account_remaining: account?.current !== null && account?.current !== undefined
        ? Math.max(0, (account.limit_day || 0) - account.current)
        : settings.football_account_remaining ?? null,
      football_plan: planName,
    });

    const savedQuota = await saveQuota(db, quotaRecord, {
      ...(quotaRecord?.id ? {} : { day }),
      used,
      limit,
      level: quotaLevel(used, limit),
      ...quotaPatch,
      last_status_at: nowIso,
      last_status_code: 200,
      last_error: [...failures, ...(statusError ? [`status: ${statusError}`] : [])].join(' | ').slice(0, 400),
    });
    await releaseLock(db, savedQuota || quotaRecord);

    await db.SyncJob.update(job.id, {
      status: failures.length ? 'partial' : 'success',
      finished_at: new Date().toISOString(),
      requests_used: calls.length,
      records_upserted: updates.length,
      error_message: failures.length ? failures.join(' | ').slice(0, 400) : '',
    });

    for (const call of calls) {
      await db.ApiUsageLog.create({
        provider: 'api_football',
        endpoint: call.endpoint,
        status_code: 200,
        records_returned: call.records,
        cache_hit: false,
        credits_used: 1,
        params: `dia=${day}`,
        note: (call.errors?.length ? call.errors.join(' | ') : summary).slice(0, 240),
        error_message: call.errors?.length ? call.errors.join(' | ').slice(0, 240) : '',
      });
    }

    return Response.json({
      ok: true,
      mode: 'audit',
      calls: calls.length,
      audited,
      results_confirmed: confirmed,
      still_running: stillRunning,
      review_flagged: reviewFlagged,
      next_audit_at: nextAuditIso,
      quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit), alerts: quotaRecord?.alerts || [] },
      account,
      failures,
      status_error: statusError,
      summary,
    });
  } catch (error) {
    if (base44 && quotaRecord?.id) {
      await base44.asServiceRole.entities.ApiQuota
        .update(quotaRecord.id, { lock_until: null, lock_owner: '', last_error: String(error?.message || error).slice(0, 400) })
        .catch(() => null);
    }
    if (base44 && settings?.id) {
      await base44.asServiceRole.entities.ProviderSettings
        .update(settings.id, { football_last_status: 'error', football_last_error: String(error?.message || error).slice(0, 400) })
        .catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
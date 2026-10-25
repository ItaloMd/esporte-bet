import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  footballApiBase,
  fetchAccountStatus,
  fetchLiveFixtures,
  fetchFixturesByDate,
  mapFixture,
  parseAccountStatus,
  FOOTBALL_TIMEZONE,
} from '../../shared/apiFootball.ts';
import {
  quotaDayKey,
  quotaLevel,
  quotaPolicy,
  quotaPercent,
  canSpend,
  chargeQuota,
  loadQuota,
  saveQuota,
  acquireLock,
  releaseLock,
  lockHeld,
  readCache,
  writeCache,
  DEFAULT_DAILY_LIMIT,
} from '../../shared/footballQuota.ts';
import { localDateString, slugify } from '../../shared/oddsApi.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { indexByFixtureId, numberOr, windowDates } from '../../shared/footballSync.ts';

const LOCK_MS = 4 * 60 * 1000;
const MAX_LIVE_PAGES = 2;
const CREATE_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;
const CREATE_BEHIND_MS = 60 * 60 * 1000;
const MATCH_TOLERANCE_MS = 36 * 60 * 60 * 1000;
const MAX_CALENDAR_DAYS = 7;

/** O plano tem limite por minuto além da cota diária: nesse caso a execução para. */
function isRateLimit(message) {
  return /too many requests|requests per minute|rate limit/i.test(String(message || ''));
}

/**
 * O plano gratuito libera apenas uma janela curta do calendário (hoje e
 * amanhã). Datas fora do alcance não são consultadas — cada tentativa
 * desperdiçaria cota sem trazer dado novo.
 */
const FREE_PLAN_WINDOW_DAYS = 2;

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

function buildPatch(fixture, event, nowIso) {
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
  return patch;
}

function buildCreate(fixture, nowIso, competitionId) {
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
    published: true,
    source: 'provider',
    discovered_at: nowIso,
    last_sync_at: nowIso,
    live_updated_at: nowIso,
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
 * Sincroniza calendário e placares da API-Football.
 *
 * Regras centrais:
 * - uma chamada por modalidade/dia, nunca uma por partida;
 * - cache compartilhado: a resposta só é buscada quando o dado armazenado venceu;
 * - o placar nunca é substituído por zero nem por ausência de resposta;
 * - partidas vinculadas por `fixture.id`, com reconciliação por equipes e
 *   horário apenas quando a partida ainda não tem vínculo.
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
    const requested = String(payload?.mode || 'auto');
    const mode = ['live', 'calendar', 'auto', 'status'].includes(requested) ? requested : 'auto';

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

    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    const limit = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
    quotaRecord = await loadQuota(db, day);
    if (lockHeld(quotaRecord, nowMs)) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootball', LOCK_MS);
    let used = numberOr(quotaRecord?.used, 0);

    const job = await db.SyncJob.create({
      provider: 'api_football',
      trigger: payload?.trigger === 'manual' ? 'manual' : 'scheduled',
      job_type: 'results',
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

    // `/status` não consome a cota diária e revela o limite real da conta.
    let account = null;
    let statusError = '';
    try {
      const statusResult = await fetchAccountStatus(apiKey, base);
      account = parseAccountStatus(statusResult.data);
      applyQuota(statusResult.quota);
      if (statusResult.errors.length) statusError = statusResult.errors.join(' | ');
    } catch (error) {
      // Ler a quota não altera dado algum: a falha não marca a execução como
      // parcial nem derruba a sincronização.
      statusError = String(error?.message || error);
    }

    const level = quotaLevel(used, limit);
    const policy = quotaPolicy(level);

    // Partidas ao vivo conhecidas e apostas pendentes nelas: definem a frequência.
    const livePage = await db.Event.filter({ status: 'live' }, { limit: 200 });
    const liveEvents = livePage.items || [];
    let pendingLiveBets = 0;
    if (liveEvents.length) {
      pendingLiveBets = await db.SimulationSelection.count({
        status: 'open',
        event_id: { $in: liveEvents.map((event) => event.id) },
      });
    }

    const lastLiveMs = settings.football_last_live_at ? Date.parse(settings.football_last_live_at) : 0;
    const liveIntervalSeconds =
      pendingLiveBets > 0
        ? numberOr(settings.football_live_refresh_seconds, 300)
        : liveEvents.length
          ? numberOr(settings.football_live_idle_seconds, 900)
          : numberOr(settings.football_live_discover_seconds, 1800);
    const liveDue = mode === 'live' ? true : nowMs - lastLiveMs >= liveIntervalSeconds * 1000;

    const windowDays = Math.min(Math.max(numberOr(settings.football_window_days, MAX_CALENDAR_DAYS), 1), MAX_CALENDAR_DAYS);
    const calendarRefreshSeconds = numberOr(settings.football_calendar_refresh_seconds, 21600);
    const planName = account?.plan || settings.football_plan || '';
    const freePlan = /free/i.test(planName);
    const allowedDays = freePlan ? Math.min(windowDays, FREE_PLAN_WINDOW_DAYS) : windowDays;
    const calendarDue = [];
    if (mode === 'calendar' || mode === 'auto') {
      for (const date of windowDates(now, allowedDays)) {
        const cached = await readCache(db, `fixtures:date:${date}`);
        if (cached?.fresh && mode !== 'calendar') continue;
        calendarDue.push(date);
      }
      // Fora do alcance do plano: nada é consultado, e a data não volta a ser
      // tentada até a virada do dia, quando a janela se renova.
      for (const date of windowDates(now, windowDays).slice(allowedDays)) {
        const cached = await readCache(db, `fixtures:date:${date}`);
        if (cached?.fresh) continue;
        await writeCache(db, {
          key: `fixtures:date:${date}`,
          endpoint: '/fixtures',
          params: `date=${date}`,
          ttlSeconds: secondsUntilEndOfDay(now),
          records: 0,
          note: 'Data fora do alcance do plano atual',
        });
      }
    }

    const wantsLive = mode === 'live' || mode === 'auto';
    const wantsCalendar = mode === 'calendar' || mode === 'auto';
    const plan = {
      live: wantsLive && policy.live && liveDue && canSpend(used, limit, policy.reserve, 1),
      days: wantsCalendar && policy.calendarDays > 0 ? calendarDue.slice(0, policy.calendarDays) : [],
    };
    // Na faixa de contingência só o essencial roda: resultados de jogos com apostas.
    if (policy.criticalOnly && pendingLiveBets === 0) plan.live = false;

    const fixtures = [];

    if (plan.live) {
      let page = 1;
      let totalPages = 1;
      while (page <= MAX_LIVE_PAGES && page <= totalPages) {
        if (!canSpend(used, limit, policy.reserve, 1)) break;
        try {
          const result = await fetchLiveFixtures(apiKey, base, page);
          const charged = await chargeQuota(db, { record: quotaRecord, day, limit, cost: 1, purpose: 'live', reserve: policy.reserve });
          quotaRecord = charged.record || quotaRecord;
          used = charged.used;
          applyQuota(result.quota);
          calls.push({ endpoint: '/fixtures?live=all', records: result.results, errors: result.errors });
          if (result.errors.length) {
            failures.push(`live: ${result.errors.join(' | ')}`);
            if (result.errors.some(isRateLimit)) break;
          }
          const list = Array.isArray(result.data?.response) ? result.data.response : [];
          list.map(mapFixture).forEach((item) => item.fixture_id && fixtures.push(item));
          totalPages = numberOr(result.data?.paging?.total, 1);
          await writeCache(db, {
            key: 'fixtures:live',
            endpoint: '/fixtures?live=all',
            params: page > 1 ? `page=${page}` : '',
            ttlSeconds: liveIntervalSeconds,
            records: result.results,
            note: `${list.length} partida(s) em andamento`,
          });
          page += 1;
        } catch (error) {
          failures.push(`live: ${String(error?.message || error)}`);
          break;
        }
      }
      if (calls.length) await db.ProviderSettings.update(settings.id, { football_last_live_at: nowIso });
    }

    const syncedDays = [];
    let rateLimited = false;
    for (const date of plan.days) {
      if (rateLimited || !canSpend(used, limit, policy.reserve, 1)) break;
      // O plano tem limite por minuto: as consultas de calendário são espaçadas.
      if (syncedDays.length) await wait(2500);
      try {
        const result = await fetchFixturesByDate(apiKey, base, date);
        const charged = await chargeQuota(db, { record: quotaRecord, day, limit, cost: 1, purpose: 'calendar', reserve: policy.reserve });
        quotaRecord = charged.record || quotaRecord;
        used = charged.used;
        applyQuota(result.quota);
        calls.push({ endpoint: `/fixtures?date=${date}`, records: result.results, errors: result.errors });
        if (result.errors.length) {
          failures.push(`calendário ${date}: ${result.errors.join(' | ')}`);
          if (result.errors.some(isRateLimit)) rateLimited = true;
          if (result.errors.some(isPlanBlocked)) {
            // O provedor recusou a data: as seguintes também estão fora do
            // alcance, então nenhuma delas é consultada hoje.
            for (const blocked of plan.days.slice(plan.days.indexOf(date))) {
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
        list.map(mapFixture).forEach((item) => item.fixture_id && fixtures.push(item));
        syncedDays.push(date);
        await writeCache(db, {
          key: `fixtures:date:${date}`,
          endpoint: '/fixtures',
          params: `date=${date}`,
          ttlSeconds: calendarRefreshSeconds,
          records: result.results,
          note: `${list.length} partida(s) em ${date}`,
        });
      } catch (error) {
        failures.push(`calendário ${date}: ${String(error?.message || error)}`);
      }
    }

    // Uma partida pode chegar pelo calendário e pelo placar: fica a mais recente.
    const unique = new Map();
    fixtures.forEach((fixture) => unique.set(fixture.fixture_id, fixture));
    const mapped = [...unique.values()].filter((fixture) => fixture.start_time);

    const competitionsPage = await db.Competition.filter({ active: true }, { limit: 300 });
    const competitionsByName = new Map(
      (competitionsPage.items || []).map((row) => [slugify(row.name), row]),
    );

    const known = await indexByFixtureId(db, mapped.map((fixture) => fixture.fixture_id));
    const unresolved = mapped.filter((fixture) => !known.has(fixture.fixture_id));
    const byName = unresolved.length ? await indexByName(db, unresolved) : new Map();

    const updates = [];
    const creations = [];
    const reviewIds = [];

    mapped.forEach((fixture) => {
      const linked = known.get(fixture.fixture_id) || pickCandidate(byName.get(eventKey(fixture.home_team_name, fixture.away_team_name)), fixture);
      if (linked) {
        const patch = buildPatch(fixture, linked, nowIso);
        if (Object.keys(patch).length) updates.push({ id: linked.id, ...patch });
        if (patch.settlement_state === 'review') reviewIds.push(linked.id);
        return;
      }
      const competition = competitionsByName.get(slugify(fixture.competition_name));
      const startMs = Date.parse(fixture.start_time);
      const withinWindow = startMs >= nowMs - CREATE_BEHIND_MS && startMs <= nowMs + CREATE_AHEAD_MS;
      if (!settings.football_create_events || !competition || !withinWindow) return;
      creations.push(buildCreate(fixture, nowIso, competition.id));
    });

    for (const batch of chunkArray(updates, 200)) await db.Event.bulkUpdate(batch);
    for (const batch of chunkArray(creations, 100)) await db.Event.bulkCreate(batch);

    const finishedSynced = mapped.filter((fixture) => fixture.finished).length;
    const summary = [
      'api-football',
      `${calls.length} chamada(s)`,
      `${mapped.length} partida(s) lida(s)`,
      `${updates.length} atualizada(s)`,
      `${creations.length} criada(s)`,
      `${finishedSynced} encerrada(s)`,
      `orçamento ${used}/${limit}`,
    ].join(' · ');

    const nextRunMs = liveIntervalSeconds * 1000;

    await db.ProviderSettings.update(settings.id, {
      football_last_sync_at: nowIso,
      football_last_status: failures.length ? 'partial' : 'success',
      football_last_error: failures.length ? failures.join(' | ').slice(0, 400) : '',
      football_last_summary: summary,
      football_alert_level: quotaLevel(used, limit),
      football_next_run_at: new Date(nowMs + nextRunMs).toISOString(),
      football_account_limit: account?.limit_day ?? settings.football_account_limit ?? null,
      football_account_remaining: account?.current !== null && account?.current !== undefined
        ? Math.max(0, (account.limit_day || 0) - account.current)
        : settings.football_account_remaining ?? null,
      football_plan: planName,
      football_plan_note: freePlan
        ? `Plano gratuito: a fonte libera o calendário apenas de hoje a amanhã (${allowedDays} de ${windowDays} dias solicitados).`
        : settings.football_plan_note || '',
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
      status: 'success',
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
      results_confirmed: finishedSynced,
      review_flagged: reviewIds.length,
      quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit), alerts: quotaRecord?.alerts || [] },
      account,
      pending_live_bets: pendingLiveBets,
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
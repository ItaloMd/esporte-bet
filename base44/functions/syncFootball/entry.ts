import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  footballApiBase,
  fetchAccountStatus,
  fetchFixturesByDate,
  fetchFixturesByIds,
  mapFixture,
  parseAccountStatus,
} from '../../shared/apiFootball.ts';
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
import { localDateString, slugify } from '../../shared/oddsApi.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { indexByFixtureId, numberOr, upcomingDates } from '../../shared/footballSync.ts';

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

/** Partidas com auditoria vencida: nunca consultadas antes do horário agendado. */
async function loadDueEvents(db, nowIso) {
  const due = [];
  let cursor = null;
  for (let round = 0; round < 4; round += 1) {
    const page = await db.Event.filter(
      { fixture_id: { $exists: true }, next_check_at: { $lte: nowIso }, status: { $in: ['scheduled', 'live'] } },
      { limit: 500, sort: 'next_check_at', ...(cursor ? { cursor } : {}) },
    );
    due.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!page.has_more || due.length >= MAX_AUDIT_EVENTS) break;
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
    published: true,
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
 * - `calendar` (importação diária, 23:59): busca as partidas dos próximos dias
 *   em lote, uma chamada por data, e agenda a auditoria de cada partida para
 *   o início + 2 horas. O botão manual inclui hoje, para preencher a grade
 *   imediatamente.
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
    const mode = ['calendar', 'audit', 'auto'].includes(requested) ? requested : 'audit';

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

    // `/status` não consome a cota diária e revela o limite real da conta.
    let account = null;
    let statusError = '';
    try {
      const statusResult = await fetchAccountStatus(apiKey, base);
      account = parseAccountStatus(statusResult.data);
      applyQuota(statusResult.quota);
      if (statusResult.errors.length) statusError = statusResult.errors.join(' | ');
    } catch (error) {
      statusError = String(error?.message || error);
    }

    const level = quotaLevel(used, limit);
    const policy = quotaPolicy(level);
    const planName = account?.plan || settings.football_plan || '';

    /* ------------------------- importação diária ------------------------- */
    if (mode === 'calendar') {
      const windowDays = Math.min(Math.max(numberOr(settings.football_window_days, 2), 1), MAX_CALENDAR_DAYS);
      const calendarRefreshSeconds = numberOr(settings.football_calendar_refresh_seconds, 21600);
      // A rotina das 23:59 busca os próximos dias; o botão manual inclui hoje.
      const todayKey = localDateString(now, FOOTBALL_TIMEZONE);
      const dates = [...new Set(
        payload?.trigger === 'manual'
          ? [todayKey, ...upcomingDates(now, windowDays)]
          : upcomingDates(now, windowDays),
      )];
      const planDays = policy.calendarDays > 0 ? dates.slice(0, policy.calendarDays) : dates;

      const fixtures = [];
      const syncedDays = [];
      let rateLimited = false;
      for (const date of planDays) {
        if (rateLimited || !canSpend(used, limit, policy.reserve, 1)) break;
        const cached = await readCache(db, `fixtures:date:${date}`);
        if (cached?.fresh) continue;
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
      mapped.forEach((fixture) => {
        const linked = known.get(fixture.fixture_id) || pickCandidate(byName.get(eventKey(fixture.home_team_name, fixture.away_team_name)), fixture);
        if (linked) {
          const patch = buildPatch(fixture, linked, nowIso, settings);
          if (Object.keys(patch).length) updates.push({ id: linked.id, ...patch });
          return;
        }
        const competition = competitionsByName.get(slugify(fixture.competition_name));
        const startMs = Date.parse(fixture.start_time);
        const withinWindow = startMs >= nowMs - CREATE_BEHIND_MS && startMs <= nowMs + CREATE_AHEAD_MS;
        if (!settings.football_create_events || !competition || !withinWindow) return;
        creations.push(buildCreate(fixture, nowIso, competition.id, settings));
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
    let due = await loadDueEvents(db, nowIso);
    if (policy.criticalOnly) {
      // Contingência: só partidas com apostas pendentes consomem créditos.
      const openEventIds = new Set();
      let cursor = null;
      for (let round = 0; round < 4; round += 1) {
        const page = await db.SimulationSelection.filter({ status: 'open' }, { limit: 500, ...(cursor ? { cursor } : {}) });
        (page.items || []).forEach((row) => openEventIds.add(row.event_id));
        cursor = page.next_cursor;
        if (!page.has_more) break;
      }
      due = due.filter((event) => openEventIds.has(event.id));
    }

    const updates = [];
    const auditLogs = [];
    let audited = 0;
    let confirmed = 0;
    let stillRunning = 0;
    let reviewFlagged = 0;
    let rateLimited = false;

    for (const batch of chunkArray(due, IDS_PER_CALL)) {
      if (rateLimited || !canSpend(used, limit, policy.reserve, 1)) break;
      try {
        const ids = batch.map((event) => event.fixture_id);
        const result = await fetchFixturesByIds(apiKey, base, ids);
        const charged = await chargeQuota(db, { record: quotaRecord, day, limit, cost: 1, purpose: 'audit', reserve: policy.reserve });
        quotaRecord = charged.record || quotaRecord;
        used = charged.used;
        applyQuota(result.quota);
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
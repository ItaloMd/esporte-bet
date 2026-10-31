import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  fetchAccountStatus,
  footballApiBase,
  parseAccountStatus,
} from '../../shared/apiFootball.ts';
import { loadQuota, quotaDayKey, quotaLevel, quotaPercent } from '../../shared/footballQuota.ts';
import { openFootballClient } from '../../shared/footballClient.ts';
import { breakerState } from '../../shared/footballCircuit.ts';
import { clampGap, effectiveMinuteLimit, minuteWindowUsed, paceGapMs } from '../../shared/footballQueue.ts';
import { FOOTBALL_SETTINGS_RULES, validateFootballSettingsPatch } from '../../shared/footballSettings.ts';
import {
  DEFAULT_LIVE_INTERVAL_MINUTES,
  DEFAULT_MONITOR_BETS_MINUTES,
  DEFAULT_MONITOR_CRITICAL_MINUTES,
  DEFAULT_MONITOR_DEFAULT_MINUTES,
  DEFAULT_MONITOR_FAVORITES_MINUTES,
} from '../../shared/footballMonitor.ts';
import { applyHouseMargin, localDateString } from '../../shared/oddsApi.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { numberOr } from '../../shared/footballSync.ts';
import { FOOTBALL_CADENCE, FOOTBALL_LIMITS, ODDS_CURATION, ODDS_PRIORITY } from '../../shared/footballConfig.ts';

const ALERT_THRESHOLDS = [50, 75, 90, 95];
const MAX_ODD_ROUNDS = 20;

/** Primeiro instante do dia operacional no horário de Brasília. */
function dayStartIso() {
  const todayKey = localDateString(new Date(), FOOTBALL_TIMEZONE);
  return new Date(`${todayKey}T00:00:00-03:00`).toISOString();
}

function riskLevel(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'high';
  if (percent >= 50) return 'medium';
  return 'low';
}

function bucketDay(row) {
  const value = row?.created_date || row?.date || row?.dateBucket || row?.day || row?._id;
  return String(value || '').slice(0, 10);
}

function average(list) {
  if (!list.length) return 0;
  return Math.round((list.reduce((total, value) => total + value, 0) / list.length) * 10) / 10;
}

/**
 * Central API-Football: status da conta e do plano, consumo real, previsão
 * baseada no histórico, widgets operacionais, logs filtrados e reaplicação
 * imediata da margem da casa sobre as cotações salvas.
 *
 * Ações:
 * - `overview` (padrão): painel completo. Consulta `/status` (não consome cota).
 * - `logs`: logs de uso com filtros de período, endpoint, fixture e liga.
 * - `recalc_margin`: reaplica a margem configurada sobre todas as odds salvas.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'overview');

    const now = new Date();
    const nowIso = now.toISOString();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || null;
    if (!settings) return Response.json({ error: 'Configuração do provedor não encontrada.' }, { status: 400 });

    /* -------------------- reaplicação imediata da margem -------------------- */
    if (action === 'recalc_margin') {
      const margin = numberOr(settings.house_margin_percent, 20);
      if (!Number.isFinite(margin) || margin < 0 || margin > 100) {
        return Response.json({ error: 'Margem da casa inválida.' }, { status: 400 });
      }

      const rows = [];
      let cursor = null;
      for (let round = 0; round < MAX_ODD_ROUNDS; round += 1) {
        const page = await db.Odd.filter({ source: 'provider' }, { limit: 500, ...(cursor ? { cursor } : {}) });
        rows.push(...(page.items || []));
        cursor = page.next_cursor;
        if (!page.has_more) break;
      }

      // Grupos por mercado + linha, espelhando a gravação das cotações:
      // h2h (3 resultados), totals (over/under por linha), spreads (por linha).
      const groups = new Map();
      rows.forEach((odd) => {
        const original = Number(odd.original_value);
        if (!Number.isFinite(original) || original <= 1) return;
        if (odd.is_super_odd) return; // destaque promocional prevalece
        const key = `${odd.market_id}|${odd.line === null || odd.line === undefined ? '' : odd.line}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id: odd.id, original, previous: Number(odd.value) });
      });

      const updates = [];
      const markets = new Set();
      groups.forEach((list, key) => {
        if (list.length < 2) return;
        const marginResult = applyHouseMargin(list.map((item) => ({ original_value: item.original })), margin);
        if (!marginResult) return;
        markets.add(key.split('|')[0]);
        list.forEach((item, index) => {
          const offered = marginResult.values[index];
          if (!Number.isFinite(offered) || offered === item.previous) return;
          updates.push({
            id: item.id,
            value: offered,
            house_margin_percent: margin,
            quote_state: 'offered',
            status: 'open',
          });
        });
      });

      for (const batch of chunkArray(updates, 400)) {
        if (batch.length) await db.Odd.bulkUpdate(batch);
      }

      return Response.json({ margin, updated: updates.length, markets: markets.size, checked: rows.length });
    }

    /* ---------------------------- logs filtrados ---------------------------- */
    if (action === 'logs') {
      const endpoint = String(body.endpoint || '').trim();
      const fixture = String(body.fixture || '').trim();
      const league = String(body.league || '').trim();
      const days = numberOr(body.period_days, 7);
      const limit = Math.min(Math.max(numberOr(body.limit, 60), 1), 200);

      const query = { provider: 'api_football' };
      if (endpoint) query.endpoint = { $regex: endpoint, $options: 'i' };
      if (fixture) query.params = { $regex: fixture, $options: 'i' };
      if (league) query.note = { $regex: league, $options: 'i' };
      if (days > 0) query.created_date = { $gte: new Date(Date.now() - days * 86400000).toISOString() };

      const page = await db.ApiUsageLog.filter(query, { sort: '-created_date', limit });
      return Response.json({ logs: page.items || [] });
    }

    /* ------------- configurações validadas centralmente (painel admin) ------------- */
    if (action === 'update_settings') {
      const { patch, rejected } = validateFootballSettingsPatch(body.patch || {});
      if (!Object.keys(patch).length) {
        return Response.json(
          { error: rejected.length ? `${rejected[0].field}: ${rejected[0].reason}` : 'Nenhum campo válido para atualizar.', rejected },
          { status: 400 },
        );
      }
      await db.ProviderSettings.update(settings.id, patch);
      await db.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'provider.football_settings_updated',
        target_type: 'ProviderSettings',
        target_id: settings.id,
        details: Object.entries(patch)
          .map(([field, value]) => `${field}=${value}`)
          .join(' · ')
          .slice(0, 400),
        severity: 'warning',
      }).catch(() => null);

      const updated = await db.ProviderSettings.get(settings.id);
      const effective = {};
      Object.keys(FOOTBALL_SETTINGS_RULES).forEach((field) => {
        effective[field] = updated?.[field] ?? null;
      });
      return Response.json({ ok: true, applied: patch, rejected, effective });
    }

    /* ---------------- fila de revisão administrativa de resultados ---------------- */
    if (action === 'review_queue') {
      const page = await db.Event.filter({ settlement_state: 'review' }, { limit: 60, sort: '-updated_date' });
      const events = page.items || [];
      const ids = events.map((event) => event.id);

      const auditsByEvent = new Map();
      const betsByEvent = new Map();
      if (ids.length) {
        const [auditPage, betsPage] = await Promise.all([
          db.BetAudit.filter({ event_id: { $in: ids } }, { sort: '-created_date', limit: 300 }),
          db.SimulationSelection.filter({ event_id: { $in: ids }, status: 'open' }, { limit: 500 }),
        ]);
        (auditPage.items || []).forEach((row) => {
          if (!auditsByEvent.has(row.event_id)) auditsByEvent.set(row.event_id, row);
        });
        (betsPage.items || []).forEach((row) => {
          betsByEvent.set(row.event_id, (betsByEvent.get(row.event_id) || 0) + 1);
        });
      }

      const rows = events.map((event) => {
        const audit = auditsByEvent.get(event.id) || null;
        return {
          id: event.id,
          fixture_id: event.fixture_id || '',
          sport_slug: event.sport_slug,
          competition_name: event.competition_name || '',
          home_team_name: event.home_team_name,
          away_team_name: event.away_team_name,
          start_time: event.start_time,
          status: event.status,
          phase: event.phase || '',
          phase_label: event.phase_label || '',
          home_score: event.home_score ?? null,
          away_score: event.away_score ?? null,
          ht_home_score: event.ht_home_score ?? null,
          ht_away_score: event.ht_away_score ?? null,
          result_source: event.result_source || '',
          last_sync_at: event.last_sync_at || null,
          audit_checks: numberOr(event.audit_checks, 0),
          open_selections: betsByEvent.get(event.id) || 0,
          evidence: audit
            ? {
                audited_at: audit.audited_at,
                total_goals: audit.total_goals,
                corners_home: audit.corners_home,
                corners_away: audit.corners_away,
                cards_home: audit.cards_home,
                cards_away: audit.cards_away,
                audit_report: audit.audit_report || '',
              }
            : null,
        };
      });
      return Response.json({ events: rows, count: rows.length });
    }

    /* ---------------- decisão de revisão: confirmar ou anular ---------------- */
    // Idempotente: só age sobre partidas efetivamente em revisão. A decisão
    // nunca liquida apostas diretamente — a liquidação acontece no próximo
    // ciclo, a partir do resultado confirmado, e fica na trilha de auditoria.
    if (action === 'resolve_review') {
      const eventId = String(body.event_id || '');
      const decision = String(body.decision || '');
      if (!eventId || !['confirm', 'void'].includes(decision)) {
        return Response.json({ error: 'Decisão inválida: use confirm ou void com o id da partida.' }, { status: 400 });
      }
      const eventPage = await db.Event.filter({ id: eventId }, { limit: 1 });
      const event = eventPage.items?.[0];
      if (!event) return Response.json({ error: 'Partida não encontrada.' }, { status: 404 });
      if (event.settlement_state !== 'review') {
        return Response.json({ error: 'A partida não está em revisão administrativa.' }, { status: 400 });
      }

      const nowIso = new Date().toISOString();
      const patch = {
        tracking: 'finished',
        published: false,
        odds_status: 'unavailable',
        next_check_at: null,
        result_source: 'admin_review',
        result_confirmed_at: nowIso,
        settlement_state: 'waiting',
      };
      let scoreLabel = '';

      if (decision === 'confirm') {
        const home = body.home_score === undefined || body.home_score === null || body.home_score === ''
          ? event.home_score
          : Number(body.home_score);
        const away = body.away_score === undefined || body.away_score === null || body.away_score === ''
          ? event.away_score
          : Number(body.away_score);
        if (!Number.isFinite(home) || !Number.isFinite(away) || home < 0 || away < 0) {
          return Response.json({ error: 'Placar final necessário para confirmar o resultado.' }, { status: 400 });
        }
        patch.status = 'finished';
        patch.home_score = home;
        patch.away_score = away;
        const htHome = Number(body.ht_home_score);
        const htAway = Number(body.ht_away_score);
        if (Number.isFinite(htHome) && Number.isFinite(htAway)) {
          patch.ht_home_score = htHome;
          patch.ht_away_score = htAway;
        }
        scoreLabel = `${home} x ${away}`;
      } else {
        patch.status = 'cancelled';
        scoreLabel = 'partida anulada';
      }

      await db.Event.update(event.id, patch);
      await db.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'match.review_resolved',
        target_type: 'Event',
        target_id: event.id,
        details: `Revisão resolvida (${decision === 'confirm' ? 'resultado confirmado' : 'partida anulada'}) · ${
          event.home_team_name
        } x ${event.away_team_name} · ${scoreLabel}`.slice(0, 400),
        severity: 'warning',
      }).catch(() => null);

      return Response.json({ ok: true, event_id: event.id, decision, score: scoreLabel });
    }

    /* ------------------------- liberar bloqueio e testar ------------------------- */
    // Dá ao administrador o controle de tentar de novo agora, sem esperar o
    // bloqueio temporário do provedor expirar sozinho. Não consome cota diária.
    if (action === 'clear_block') {
      const current = await loadQuota(db, day);
      if (current?.id) {
        await db.ApiQuota.update(current.id, {
          daily_blocked_until: null,
          daily_blocked_at: null,
          rate_pause_until: null,
          provider_remaining: null,
          rate_limit_strikes: 0,
          // O ritmo aprendido pertence ao bloqueio: liberado o bloqueio, a fila
          // volta ao espaçamento nominal em vez de seguir no ritmo lento que a
          // recusa anterior impôs.
          request_gap_ms: null,
          success_streak: 0,
          last_error: '',
          last_error_scope: '',
        });
      }
      await db.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'provider.football_block_cleared',
        target_type: 'ApiQuota',
        target_id: current?.id || '',
        details: 'Bloqueio de coleta liberado manualmente para teste imediato',
        severity: 'warning',
      }).catch(() => null);
      return Response.json({ ok: true });
    }

    if (action !== 'overview') return Response.json({ error: 'Ação inválida.' }, { status: 400 });

    /* ------------------------------- overview ------------------------------- */
    const apiKey = secrets.get('API_FOOTBALL_KEY');
    const base = footballApiBase(settings);
    let quotaRecord = await loadQuota(db, day);

    // Recarregar o painel nunca chama o provedor: `skip_status` devolve apenas o
    // estado salvo (plano, limite e consumo já gravados em ProviderSettings e no
    // registro de cota). A consulta de conta (/status) fica para uma ação
    // explícita do administrador — ela não consome cota diária, mas ocupa a
    // janela de requisições compartilhada e por isso não pode ser automática.
    const skipStatus = Boolean(body?.skip_status);
    let account = null;
    let statusError = '';
    if (skipStatus) {
      statusError = '';
    } else if (apiKey) {
      try {
        const statusClient = await openFootballClient(db, {
          apiKey,
          base,
          settings,
          day,
          limit: numberOr(settings.football_daily_limit, 100),
          reserve: 0,
          label: 'status da conta',
        });
        const result = await statusClient.call('/status', {}, { charge: false, purpose: 'status' });
        account = parseAccountStatus(result.data);
      } catch (error) {
        statusError = String(error?.message || error);
      }
      quotaRecord = (await loadQuota(db, day)) || quotaRecord;
    } else {
      statusError = 'Chave da API-Football não configurada nos Secrets do app.';
    }

    /* -------- limites oficiais: dia (x-ratelimit-requests-*) e minuto (X-RateLimit-*) -------- */
    const pickNumber = (value) =>
      value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const nowMs = Date.now();
    const effectiveMinute = effectiveMinuteLimit(settings, quotaRecord?.provider_minute_limit);
    const headersAt = quotaRecord?.last_status_at || quotaRecord?.provider_minute_at || '';
    // O saldo diário do provedor só vale para o dia corrente (virada em UTC).
    const headersFresh = Boolean(headersAt && String(headersAt).slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10));
    const providerRemaining = headersFresh ? pickNumber(quotaRecord?.provider_remaining) : null;
    const providerLimit = headersFresh ? pickNumber(quotaRecord?.provider_limit) : null;
    const providerUsed =
      account?.current !== null && account?.current !== undefined
        ? Number(account.current)
        : providerLimit !== null && providerRemaining !== null
          ? Math.max(0, providerLimit - providerRemaining)
          : null;

    // Pausas de segurança compartilhadas por todas as rotinas: minuto e dia.
    const pauseMs = Date.parse(quotaRecord?.rate_pause_until || '');
    const dailyBlockMs = Date.parse(quotaRecord?.daily_blocked_until || '');
    // Disjuntor: estado compartilhado por todas as rotinas (falhas duras do provedor).
    const breaker = breakerState(quotaRecord, nowMs);
    const pause = {
      active: (Number.isFinite(pauseMs) && pauseMs > nowMs) || (Number.isFinite(dailyBlockMs) && dailyBlockMs > nowMs),
      scope: Number.isFinite(dailyBlockMs) && dailyBlockMs > nowMs ? 'daily' : Number.isFinite(pauseMs) && pauseMs > nowMs ? 'minute' : '',
      until:
        Number.isFinite(dailyBlockMs) && dailyBlockMs > nowMs
          ? quotaRecord.daily_blocked_until
          : quotaRecord?.rate_pause_until || null,
      daily_until: quotaRecord?.daily_blocked_until || null,
      minute_until: quotaRecord?.rate_pause_until || null,
      strikes: numberOr(quotaRecord?.rate_limit_strikes, 0),
      last_rate_limited_at: quotaRecord?.last_rate_limited_at || null,
      last_rate_scope: quotaRecord?.last_rate_scope || '',
      last_status_code: quotaRecord?.last_status_code ?? null,
      last_error: quotaRecord?.last_error || '',
      last_error_scope: quotaRecord?.last_error_scope || '',
      minute_limit: effectiveMinute,
      minute_used: minuteWindowUsed(quotaRecord, nowMs),
      minute_remaining_provider: pickNumber(quotaRecord?.provider_minute_remaining),
      slot_at: quotaRecord?.last_slot_at || null,
    };

    const internalLimit = numberOr(settings.football_daily_limit, 100);
    const configuredPlanLimit = numberOr(settings.football_account_limit, 0);
    const planLimit = account?.limit_day ?? providerLimit ?? (configuredPlanLimit || internalLimit);
    // Consumo: contagem oficial do provedor quando disponível; senão o interno.
    const used = providerUsed !== null ? providerUsed : numberOr(quotaRecord?.used, 0);
    const remaining = providerRemaining !== null ? providerRemaining : Math.max(0, planLimit - used);
    const percent = planLimit > 0 ? Math.round((used / planLimit) * 1000) / 10 : 0;
    const alerts = ALERT_THRESHOLDS.map((threshold) => ({ threshold, reached: percent >= threshold }));

    // Histórico de consumo dos últimos 30 dias, direto do log de uso.
    let history = [];
    try {
      const historyResult = await db.ApiUsageLog.aggregate({
        query: { provider: 'api_football' },
        dateBucket: { field: 'created_date', unit: 'day' },
        sum: ['credits_used'],
      });
      history = (historyResult?.rows || [])
        .map((row) => ({ day: bucketDay(row), used: Math.round(Number(row.sum_credits_used || 0)) }))
        .filter((row) => row.day)
        .sort((a, b) => a.day.localeCompare(b.day))
        .slice(-30);
    } catch {
      history = [];
    }
    const dailyValues = history.map((row) => row.used);
    const avg30 = average(dailyValues);
    const avg7 = average(dailyValues.slice(-7));
    const monthlyEstimate = Math.round(avg30 * 30);
    const maxDay = dailyValues.length ? Math.max(...dailyValues) : 0;

    // Previsão: prioriza a média recente de 7 dias, caindo para a de 30 dias.
    const projectedDaily = Math.round(avg7 || avg30);
    const forecastPercent = planLimit > 0 ? Math.round(((projectedDaily * 30) / (planLimit * 30)) * 1000) / 10 : 0;
    const safetyMargin = Math.max(0, Math.round((100 - forecastPercent) * 10) / 10);
    const forecast = {
      d1: projectedDaily,
      d7: projectedDaily * 7,
      d15: projectedDaily * 15,
      d30: projectedDaily * 30,
      percent: forecastPercent,
      safety_margin: safetyMargin,
      risk: riskLevel(forecastPercent),
    };

    const todayKey = localDateString(now, FOOTBALL_TIMEZONE);
    const startIso = dayStartIso();
    const [
      gamesToday, liveGames, finishedToday, pendingBets, auditedToday, auditQueue,
      reviewEvents, brazilianLive, resultQueuePending, resultsConfirmed,
      resultsUnavailable, pendingTickets, nextAttemptPage, lastAuditPage,
      rateLimitedToday, endpointConsumption, ledgerCalls, lastCallPage,
    ] = await Promise.all([
      db.Event.count({ local_date: todayKey, source: 'provider' }),
      db.Event.count({ status: 'live', source: 'provider' }),
      db.Event.count({ local_date: todayKey, status: 'finished' }),
      db.SimulationSelection.count({ status: 'open' }),
      db.BetAudit.count({ created_date: { $gte: startIso } }),
      db.ResultAuditQueue.count({ status: 'pending' }),
      db.Event.count({ settlement_state: 'review' }),
      db.Event.count({ status: 'live', source: 'provider', country: 'Brazil' }),
      db.ResultAuditQueue.count({ status: 'pending' }),
      db.ResultAuditQueue.count({ result_state: 'confirmed' }),
      db.ResultAuditQueue.count({ result_state: 'unavailable' }),
      db.SimulationTicket.count({ status: 'open' }),
      db.ResultAuditQueue.filter({ status: 'pending', next_attempt_at: { $exists: true } }, { sort: 'next_attempt_at', limit: 1 }),
      db.SyncJob.filter({ job_type: 'results_audit' }, { sort: '-created_date', limit: 1 }),
      // Respostas de limite excedido (429) recebidas hoje, compartilhadas por todas as rotinas.
      db.ApiUsageLog.count({ provider: 'api_football', status_code: 429, created_date: { $gte: startIso } }),
      // Consumo real por endpoint: somente as chamadas efetivamente enviadas.
      db.ApiUsageLog
        .aggregate({
          query: { provider: 'api_football', note: 'ledger', created_date: { $gte: startIso } },
          groupBy: 'endpoint',
          sum: ['credits_used'],
        })
        .catch(() => ({ rows: [] })),
      // Requisições realmente enviadas hoje (linhas de registro) e a última delas.
      db.ApiUsageLog.count({ provider: 'api_football', note: 'ledger', created_date: { $gte: startIso } }),
      db.ApiUsageLog.filter({ provider: 'api_football', note: 'ledger' }, { sort: '-created_date', limit: 1 }),
    ]);
    const lastAudit = lastAuditPage?.items?.[0] || null;
    const byEndpoint = (Array.isArray(endpointConsumption?.rows) ? endpointConsumption.rows : [])
      .map((row) => ({
        endpoint: String(row.endpoint || '—'),
        calls: Math.round(Number(row.count || 0)),
        credits: Math.round(Number(row.sum_credits_used || 0)),
      }))
      .sort((a, b) => b.credits - a.credits || b.calls - a.calls)
      .slice(0, 6);

    const widgets = {
      games_today: gamesToday,
      live_games: liveGames,
      finished_today: finishedToday,
      pending_bets: pendingBets,
      audited_today: auditedToday,
      audit_queue: resultQueuePending,
      review_events: reviewEvents,
      consumption: used,
      remaining,
      brazilian_live: brazilianLive,
      pending_tickets: pendingTickets,
      results_confirmed: resultsConfirmed,
      results_unavailable: resultsUnavailable,
    };

    /* ---- monitoramento da auditoria de resultados (só dados internos) ---- */
    const resultAudit = {
      queue_pending: resultQueuePending,
      pending_selections: pendingBets,
      pending_tickets: pendingTickets,
      brazilian_live: brazilianLive,
      results_confirmed: resultsConfirmed,
      results_unavailable: resultsUnavailable,
      review_events: reviewEvents,
      next_attempt_at: nextAttemptPage?.items?.[0]?.next_attempt_at || null,
      last_run_at: lastAudit?.created_date || null,
      last_run_status: lastAudit?.status || '',
      last_run_requests: numberOr(lastAudit?.requests_used, 0),
      last_run_summary: lastAudit?.note || '',
      last_run_error: lastAudit?.error_message || '',
    };

    // Persiste a previsão do dia para histórico de tendência.
    const forecastPayload = {
      day,
      computed_at: nowIso,
      projected_daily: projectedDaily,
      actual_daily: used,
      percent_used: percent,
      safety_margin: safetyMargin,
      risk_level: forecast.risk,
      notes: `Média 7 dias: ${avg7} · média 30 dias: ${avg30} · pico: ${maxDay}`,
    };
    const existingForecast = await db.ApiConsumptionForecast.filter({ day }, { limit: 1 });
    if (existingForecast.items?.[0]) await db.ApiConsumptionForecast.update(existingForecast.items[0].id, forecastPayload);
    else await db.ApiConsumptionForecast.create(forecastPayload);

    /* ---------------- limites oficiais e diagnóstico de conciliação ---------------- */
    const lastCallAt = lastCallPage?.items?.[0]?.created_date || null;
    const lockMs = Date.parse(quotaRecord?.lock_until || '');
    const lockStuck = Number.isFinite(lockMs) && lockMs > nowMs;
    const internalUsed = numberOr(quotaRecord?.used, 0);
    const divergence = providerUsed !== null ? internalUsed - providerUsed : null;
    const checks = [
      {
        id: 'key',
        label: 'Chave da API configurada',
        status: apiKey ? 'ok' : 'error',
        detail: apiKey ? 'Secret API_FOOTBALL_KEY presente.' : 'Cadastre API_FOOTBALL_KEY nos Secrets do app.',
      },
      {
        id: 'headers',
        label: 'Leitura oficial do provedor',
        status: headersFresh ? 'ok' : 'warn',
        detail: headersFresh
          ? `Saldo lido em ${headersAt}.`
          : 'Sem leitura de hoje: use Consultar conta (/status, não consome cota diária).',
      },
      {
        id: 'daily',
        label: 'Saldo diário',
        status: pause.scope === 'daily' ? (pause.last_error_scope === 'throttle' ? 'warn' : 'error') : remaining > 0 ? 'ok' : 'error',
        detail:
          pause.scope === 'daily'
            ? pause.last_error_scope === 'throttle'
              ? `Provedor bloqueou o tráfego temporariamente por excesso de requisições (saldo informado ${remaining}). Coleta retoma em ${pause.until}.`
              : `Cota diária esgotada. Coleta bloqueada até ${pause.until}.`
            : `${remaining} de ${planLimit} requisições restantes${
                providerUsed !== null ? '' : ' (contador interno)'
              }.`,
      },
      {
        id: 'minute',
        label: 'Limite por minuto',
        status: pause.scope === 'minute' ? 'warn' : 'ok',
        detail:
          pause.scope === 'minute'
            ? `Fila fechada até ${pause.until}; reabre sozinha no próximo minuto.`
            : `${pause.minute_used} de ${effectiveMinute} usados neste minuto.`,
      },
      {
        id: 'ledger',
        label: 'Conciliação de consumo',
        status: divergence !== null && Math.abs(divergence) > 10 ? 'warn' : 'ok',
        detail:
          divergence !== null
            ? `Contador interno ${internalUsed} · provedor ${providerUsed} · diferença ${divergence}.`
            : 'Aguardando leitura oficial para conciliar contadores.',
      },
      {
        id: 'lock',
        label: 'Trava de execução',
        status: lockStuck ? 'warn' : 'ok',
        detail: lockStuck
          ? `Reservada por ${quotaRecord?.lock_owner || 'outra rotina'} até ${quotaRecord?.lock_until}.`
          : 'Nenhuma rotina em execução.',
      },
      {
        id: 'breaker',
        label: 'Disjuntor do provedor',
        status: breaker.open ? 'warn' : 'ok',
        detail: breaker.open
          ? `Aberto até ${breaker.until} · ${breaker.reason}`
          : `Fechado · ${breaker.failures} de ${breaker.threshold} falhas consecutivas de infraestrutura`,
      },
    ];

    /* ------------------ motor de cotações pré-jogo (curadoria) ------------------ */
    const oddsWindowDays = numberOr(settings.football_window_days, FOOTBALL_CADENCE.oddsWindowDays);
    const oddsHorizonIso = new Date(nowMs + oddsWindowDays * 86400000).toISOString();
    const [oddsCurated, oddsQueueTotal, oddsDueNow, oddsPriorityRows, lastOddsJobPage] = await Promise.all([
      db.Event.count({
        source: 'provider',
        status: 'scheduled',
        start_time: { $gt: nowIso, $lte: oddsHorizonIso },
        relevance_score: { $gte: ODDS_CURATION.minRelevance },
      }),
      db.OddsQueueItem.count({ status: 'queued' }),
      db.OddsQueueItem.count({ status: 'queued', next_run_at: { $lte: nowIso } }),
      db.OddsQueueItem
        .aggregate({ query: { status: 'queued' }, groupBy: 'priority' })
        .catch(() => ({ rows: [] })),
      db.SyncJob.filter({ job_type: 'odds' }, { sort: '-created_date', limit: 1 }),
    ]);
    const lastOddsJob = lastOddsJobPage?.items?.[0] || null;
    const oddsEngine = {
      running: Boolean(settings.football_enabled) && !settings.football_paused,
      window_days: oddsWindowDays,
      min_relevance: ODDS_CURATION.minRelevance,
      high_relevance: ODDS_CURATION.highRelevance,
      max_lots: ODDS_CURATION.maxLotsPerRun,
      max_pages: FOOTBALL_CADENCE.oddsMaxPages,
      house_margin: numberOr(settings.house_margin_percent, 20),
      curated_matches: oddsCurated,
      queue_total: numberOr(oddsQueueTotal, 0),
      due_now: numberOr(oddsDueNow, 0),
      cadence: Object.entries(ODDS_PRIORITY).map(([priority, seconds]) => ({
        priority,
        minutes: Math.round(Number(seconds) / 60),
      })),
      by_priority: (oddsPriorityRows?.rows || [])
        .map((row) => ({ priority: String(row.priority || '—'), count: Math.round(Number(row.count || 0)) }))
        .sort((a, b) => b.count - a.count),
      last_run: lastOddsJob
        ? {
            at: lastOddsJob.finished_at || lastOddsJob.started_at || lastOddsJob.created_date || null,
            status: lastOddsJob.status || '',
            requests: numberOr(lastOddsJob.requests_used, 0),
            odds: numberOr(lastOddsJob.records_upserted, 0),
            summary: lastOddsJob.note || '',
            error: lastOddsJob.error_message || '',
          }
        : null,
    };

    /* --------------- catálogo de casas de apostas (seleção admin) --------------- */
    const [bookmakerTotal, bookmakerSelected, bookmakerLastPage] = await Promise.all([
      db.Bookmaker.count({ provider: 'api_football' }),
      db.Bookmaker.count({ provider: 'api_football', enabled: true }),
      db.Bookmaker.filter({ provider: 'api_football' }, { sort: '-synced_at', limit: 1 }),
    ]);
    const bookmakers = {
      total: numberOr(bookmakerTotal, 0),
      selected: numberOr(bookmakerSelected, 0),
      last_sync_at: bookmakerLastPage?.items?.[0]?.synced_at || null,
      mode: numberOr(bookmakerSelected, 0) > 0 ? 'selecao' : 'preferencia_padrao',
    };

    return Response.json({
      connection: {
        key_configured: Boolean(apiKey),
        status: statusError ? 'error' : 'connected',
        status_error: statusError,
        last_sync_at: settings.football_last_sync_at || null,
        last_live_at: settings.football_last_live_at || null,
        last_calendar_at: settings.football_last_calendar_at || null,
        next_run_at: settings.football_next_run_at || null,
        last_sync_status: settings.football_last_status || '',
        last_summary: settings.football_last_summary || '',
        rate_limited_today: numberOr(rateLimitedToday, 0),
        by_endpoint: byEndpoint,
      },
      plan: {
        name: account?.plan || settings.football_plan || '',
        limit: planLimit,
        internal_limit: internalLimit,
        active: account?.active ?? null,
        end: account?.end || '',
      },
      consumption: {
        used,
        remaining,
        percent,
        level: quotaLevel(used, internalLimit),
        avg_daily: avg30,
        avg_recent: avg7,
        max_day: maxDay,
        monthly_estimate: monthlyEstimate,
      },
      alerts,
      widgets,
      result_audit: resultAudit,
      odds_engine: oddsEngine,
      bookmakers,
      pause,
      provider: {
        daily: {
          limit: planLimit,
          remaining,
          used,
          source: providerUsed !== null ? 'provedor' : 'interno',
          fresh: headersFresh && providerRemaining !== null,
          read_at: headersAt || null,
        },
        minute: {
          limit: effectiveMinute,
          remaining: pause.minute_remaining_provider,
          read_at: quotaRecord?.provider_minute_at || null,
        },
        window: { used: pause.minute_used, limit: effectiveMinute, key: quotaRecord?.minute_key || null },
        breaker,
        pacing: {
          gap_ms: clampGap(Number(quotaRecord?.request_gap_ms) || paceGapMs(effectiveMinute)),
          learned: Boolean(quotaRecord?.request_gap_ms),
          next_slot_at: quotaRecord?.last_slot_at || null,
        },
        internal: { limit: internalLimit, used: internalUsed, purposes: quotaRecord?.purpose_used || '' },
      },
      diagnostics: {
        ledger_calls_today: numberOr(ledgerCalls, 0),
        internal_used: internalUsed,
        provider_used: providerUsed,
        divergence,
        last_call_at: lastCallAt,
        cache: {
          hits: numberOr(quotaRecord?.cache_hits, 0),
          misses: numberOr(quotaRecord?.cache_misses, 0),
          dedupe: numberOr(quotaRecord?.dedupe_hits, 0),
          calls: numberOr(quotaRecord?.call_count, 0),
          avg_ms:
            numberOr(quotaRecord?.call_count, 0) > 0
              ? Math.round(numberOr(quotaRecord?.total_duration_ms, 0) / numberOr(quotaRecord?.call_count, 0))
              : 0,
          count_429: numberOr(quotaRecord?.count_429, 0),
          errors_5xx: numberOr(quotaRecord?.errors_5xx, 0),
        },
        second: {
          key: quotaRecord?.second_key || null,
          used: numberOr(quotaRecord?.second_used, 0),
          limit: FOOTBALL_LIMITS.secondRequests,
        },
        checks,
      },
      forecast,
      history,
      monitor: {
        enabled: Boolean(settings.football_enabled),
        live_interval_minutes: numberOr(settings.football_live_interval_minutes, DEFAULT_LIVE_INTERVAL_MINUTES),
        monitor_default_minutes: numberOr(settings.football_monitor_default_minutes, DEFAULT_MONITOR_DEFAULT_MINUTES),
        monitor_bets_minutes: numberOr(settings.football_monitor_bets_minutes, DEFAULT_MONITOR_BETS_MINUTES),
        monitor_favorites_minutes: numberOr(settings.football_monitor_favorites_minutes, DEFAULT_MONITOR_FAVORITES_MINUTES),
        monitor_critical_minutes: numberOr(settings.football_monitor_critical_minutes, DEFAULT_MONITOR_CRITICAL_MINUTES),
        critical_from_minute: numberOr(settings.football_critical_from_minute, 80),
        window_days: numberOr(settings.football_window_days, 7),
        calendar_refresh_hours: Math.round(numberOr(settings.football_calendar_refresh_seconds, 86400) / 3600),
        minute_limit: effectiveMinute,
        daily_limit: numberOr(settings.football_daily_limit, 100),
      },
      quota_percent: quotaPercent(used, internalLimit),
    });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
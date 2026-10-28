import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  fetchAccountStatus,
  footballApiBase,
  parseAccountStatus,
} from '../../shared/apiFootball.ts';
import { loadQuota, quotaDayKey, quotaLevel, quotaPercent } from '../../shared/footballQuota.ts';
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

    if (action !== 'overview') return Response.json({ error: 'Ação inválida.' }, { status: 400 });

    /* ------------------------------- overview ------------------------------- */
    const apiKey = secrets.get('API_FOOTBALL_KEY');
    const base = footballApiBase(settings);
    let account = null;
    let statusError = '';
    if (apiKey) {
      try {
        const result = await fetchAccountStatus(apiKey, base);
        account = parseAccountStatus(result.data);
      } catch (error) {
        statusError = String(error?.message || error);
      }
    } else {
      statusError = 'Chave da API-Football não configurada nos Secrets do app.';
    }

    const quotaRecord = await loadQuota(db, day);
    const internalLimit = numberOr(settings.football_daily_limit, 100);
    const planLimit = account?.limit_day ?? settings.football_account_limit ?? internalLimit;
    const used = account?.current !== null && account?.current !== undefined ? account.current : numberOr(quotaRecord?.used, 0);
    const remaining = Math.max(0, planLimit - used);
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
    const [gamesToday, liveGames, finishedToday, monitored, pendingBets, auditedToday, auditQueue, criticalQueue] =
      await Promise.all([
        db.Event.count({ local_date: todayKey, source: 'provider' }),
        db.Event.count({ status: 'live', source: 'provider' }),
        db.Event.count({ local_date: todayKey, status: 'finished' }),
        db.MatchMonitorQueue.count({ status: 'queued' }),
        db.SimulationSelection.count({ status: 'open' }),
        db.BetAudit.count({ created_date: { $gte: startIso } }),
        db.Event.count({ next_check_at: { $ne: null }, status: { $in: ['scheduled', 'live'] } }),
        db.MatchMonitorQueue.count({ status: 'queued', priority: 4 }),
      ]);

    const widgets = {
      games_today: gamesToday,
      live_games: liveGames,
      finished_today: finishedToday,
      monitored: monitored,
      pending_bets: pendingBets,
      audited_today: auditedToday,
      audit_queue: auditQueue,
      critical_queue: criticalQueue,
      consumption: used,
      remaining,
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

    return Response.json({
      connection: {
        key_configured: Boolean(apiKey),
        status: statusError ? 'error' : 'connected',
        status_error: statusError,
        last_sync_at: settings.football_last_sync_at || null,
        last_live_at: settings.football_last_live_at || null,
        last_sync_status: settings.football_last_status || '',
        last_summary: settings.football_last_summary || '',
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
        window_days: numberOr(settings.football_window_days, 5),
      },
      quota_percent: quotaPercent(used, internalLimit),
    });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
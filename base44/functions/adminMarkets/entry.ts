import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  apiFootballFetch,
  footballApiBase,
  fetchFixtureEvents,
  fetchFixtureStatistics,
  parseFixtureEvents,
  parseFixtureStatistics,
} from '../../shared/apiFootball.ts';
import { fetchOddsByDate } from '../../shared/apiFootballOdds.ts';
import { MARKET_CATALOG, upsertMarketCapability } from '../../shared/footballMarkets.ts';
import {
  DEFAULT_DAILY_LIMIT,
  acquireLock,
  canSpend,
  chargeQuota,
  effectiveDailyLimit,
  loadQuota,
  lockHeld,
  quotaDayKey,
  quotaLevel,
  quotaPolicy,
  releaseLock,
  saveQuota,
} from '../../shared/footballQuota.ts';
import { localDateString } from '../../shared/oddsApi.ts';
import { numberOr } from '../../shared/footballSync.ts';

const LOCK_MS = 90 * 1000;
/** Ligas verificadas por execução da descoberta de capacidade. */
const MAX_DISCOVER_LEAGUES = 8;

/**
 * Configuração de mercados: ativação, prioridade, auditoria automática,
 * validação de suporte na API-Football (o bet precisa estar registrado no
 * plano e observado nas cotações reais) e descoberta de capacidade por
 * liga/temporada — o que a fonte realmente fornece de estatísticas e eventos.
 */
export default async function (req) {
  let base44;
  let quotaRecord = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action || 'overview');

    if (action === 'update_setting') {
      const marketKey = String(payload?.market_key || '');
      const page = await db.MarketSettings.filter({ market_key: marketKey }, { limit: 1 });
      const settings = page.items?.[0];
      if (!settings) return Response.json({ error: 'Mercado não encontrado' }, { status: 404 });
      const patch = {};
      if (typeof payload.enabled === 'boolean') patch.enabled = payload.enabled;
      if (typeof payload.auto_audit === 'boolean') patch.auto_audit = payload.auto_audit;
      if (Number.isFinite(Number(payload.priority))) patch.priority = Number(payload.priority);
      if (!Object.keys(patch).length) return Response.json({ ok: true });
      await db.MarketSettings.update(settings.id, patch);
      await db.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'admin_markets.update_setting',
        target_type: 'MarketSettings',
        target_id: settings.id,
        details: JSON.stringify({ market_key: marketKey, ...patch }),
      });
      return Response.json({ ok: true, market_key: marketKey, ...patch });
    }

    if (action === 'overview') {
      const existingPage = await db.MarketSettings.list({ limit: 200 });
      const existing = new Map((existingPage.items || []).map((row) => [row.market_key, row]));
      const missing = MARKET_CATALOG.filter((row) => !existing.has(row.key));
      if (missing.length) {
        await db.MarketSettings.bulkCreate(missing.map((row) => ({
          market_key: row.key,
          market_name: row.name,
          market_group: row.group,
          provider_bet: row.provider_bet,
          enabled: true,
          priority: row.priority,
          auto_audit: true,
          support_status: 'available',
        })));
      }
      const settingsPage = await db.MarketSettings.list({ limit: 200, sort: 'priority' });
      const [wonAgg, lostAgg, openAgg] = await Promise.all([
        db.SimulationSelection.aggregate({ query: { status: 'won' }, groupBy: 'market_key' }),
        db.SimulationSelection.aggregate({ query: { status: 'lost' }, groupBy: 'market_key' }),
        db.SimulationSelection.aggregate({ query: { status: 'open' }, groupBy: 'market_key' }),
      ]);
      const byKey = (agg) => Object.fromEntries((agg?.rows || []).map((row) => [row.market_key, Number(row.count) || 0]));
      const won = byKey(wonAgg);
      const lost = byKey(lostAgg);
      const open = byKey(openAgg);

      const processed = await db.BetAudit.count({});
      const openByEvent = await db.SimulationSelection.aggregate({ query: { status: 'open' }, groupBy: 'event_id' });
      const betsWonTotal = Object.values(won).reduce((sum, value) => sum + value, 0);
      const betsLostTotal = Object.values(lost).reduce((sum, value) => sum + value, 0);
      const settledTotal = betsWonTotal + betsLostTotal;
      const capabilitiesPage = await db.MarketCapability.list({ sort: '-last_checked_at', limit: 60 });

      return Response.json({
        markets: (settingsPage.items || []).map((row) => ({
          market_key: row.market_key,
          market_name: row.market_name,
          market_group: row.market_group,
          provider_bet: row.provider_bet,
          enabled: Boolean(row.enabled),
          priority: Number(row.priority) || 0,
          auto_audit: Boolean(row.auto_audit),
          support_status: row.support_status || 'available',
          support_checked_at: row.support_checked_at || null,
          support_note: row.support_note || '',
          bets_won: won[row.market_key] || 0,
          bets_lost: lost[row.market_key] || 0,
          bets_open: open[row.market_key] || 0,
        })),
        totals: {
          processed_audits: Number(processed) || 0,
          pending_events: (openByEvent?.rows || []).length,
          bets_settled: settledTotal,
          bets_won: betsWonTotal,
          win_rate: settledTotal ? Math.round((betsWonTotal / settledTotal) * 100) : null,
        },
        capabilities: capabilitiesPage.items || [],
      });
    }

    if (action !== 'validate' && action !== 'discover') {
      return Response.json({ error: 'Ação inválida' }, { status: 400 });
    }

    /* ------------- ações que consomem créditos da API-Football ------------- */
    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || null;
    if (!settings) return Response.json({ skipped: true, reason: 'Configuração do provedor não encontrada' });
    if (!settings.football_enabled) {
      return Response.json({ skipped: true, reason: 'Integração API-Football desabilitada' });
    }
    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    const now = new Date();
    const nowMs = now.getTime();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);
    let limit = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
    quotaRecord = await loadQuota(db, day);
    limit = effectiveDailyLimit(limit, quotaRecord?.provider_limit);
    if (lockHeld(quotaRecord, nowMs)) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'adminMarkets', LOCK_MS);
    let used = numberOr(quotaRecord?.used, 0);
    const policy = quotaPolicy(quotaLevel(used, limit));
    const failures = [];
    const charge = async (cost, purpose, endpoint) => {
      const charged = await chargeQuota(db, { record: quotaRecord, day, limit, cost, purpose, endpoint, reserve: policy.reserve });
      quotaRecord = charged.record || quotaRecord;
      used = charged.used;
    };

    let summary = '';
    if (action === 'validate') {
      // 1) Bets registrados na conta (o que o plano atual libera).
      const registeredSet = new Set();
      if (canSpend(used, limit, policy.reserve, 1)) {
        const betsResult = await apiFootballFetch(apiKey, '/odds/bets', {}, { base, timeoutMs: 15000 });
        await charge(1, 'validate', '/odds/bets');
        const registeredList = Array.isArray(betsResult.data?.response) ? betsResult.data.response : [];
        registeredList.forEach((row) => {
          registeredSet.add(String(row?.name || '').trim().toLowerCase());
        });
        if (betsResult.errors.length) failures.push(betsResult.errors.join(' | '));
      }

      // 2) Observação real: cotações de hoje e amanhã revelam o que a fonte entrega.
      const observedSet = new Set();
      let observedFixtures = 0;
      const dates = [
        localDateString(now, FOOTBALL_TIMEZONE),
        localDateString(new Date(nowMs + 86400000), FOOTBALL_TIMEZONE),
      ];
      for (const date of dates) {
        if (!canSpend(used, limit, policy.reserve, 1)) break;
        const oddsResult = await fetchOddsByDate(apiKey, base, date, 1);
        await charge(1, 'validate', '/odds');
        const list = Array.isArray(oddsResult.data?.response) ? oddsResult.data.response : [];
        observedFixtures += list.length;
        list.forEach((entry) => {
          (entry.bookmakers || []).forEach((book) => {
            (book.bets || []).forEach((bet) => {
              observedSet.add(String(bet?.name || '').trim().toLowerCase());
            });
          });
        });
        if (oddsResult.errors.length) failures.push(oddsResult.errors.join(' | '));
      }

      // 3) Status por mercado: observado > registrado > exige upgrade.
      const counts = { available: 0, unavailable: 0, upgrade: 0 };
      const checkedAt = new Date().toISOString();
      for (const row of MARKET_CATALOG) {
        const bet = row.provider_bet.toLowerCase();
        const status = observedSet.has(bet) ? 'available' : registeredSet.has(bet) ? 'unavailable' : 'upgrade';
        counts[status] += 1;
        const note = status === 'available'
          ? `Cotação observada na API em ${dates[0]}`
          : status === 'unavailable'
            ? 'Bet registrado no plano, sem cotação nas datas observadas (cobertura varia por liga)'
            : 'Bet não registrado no plano atual';
        const page = await db.MarketSettings.filter({ market_key: row.key }, { limit: 1 });
        const existing = page.items?.[0];
        const patch = { support_status: status, support_checked_at: checkedAt, support_note: note };
        if (existing) {
          await db.MarketSettings.update(existing.id, patch);
        } else {
          await db.MarketSettings.create({
            market_key: row.key,
            market_name: row.name,
            market_group: row.group,
            provider_bet: row.provider_bet,
            enabled: true,
            priority: row.priority,
            auto_audit: true,
            ...patch,
          });
        }
      }
      summary = `Validação: ${counts.available} disponível(is) · ${counts.unavailable} indisponível(is) · ${counts.upgrade} requer upgrade · ${observedFixtures} partida(s) observadas`;
    } else {
      // Descoberta por liga: amostra o último jogo encerrado de cada liga.
      const leaguePage = await db.Event.list({ distinct: 'competition_name' });
      const leagueNames = (leaguePage.items || []).filter(Boolean).slice(0, MAX_DISCOVER_LEAGUES);
      const discovered = [];
      for (const leagueName of leagueNames) {
        const page = await db.Event.filter(
          { source: 'provider', status: 'finished', competition_name: leagueName },
          { sort: '-start_time', limit: 1 },
        );
        const event = page.items?.[0];
        if (!event?.fixture_id) continue;
        let statistics = null;
        let events = null;
        if (canSpend(used, limit, policy.reserve, 1)) {
          try {
            const statsResult = await fetchFixtureStatistics(apiKey, base, event.fixture_id);
            await charge(1, 'discover', '/fixtures/statistics');
            statistics = parseFixtureStatistics(statsResult.data);
          } catch (error) {
            failures.push(`${leagueName}: ${String(error?.message || error)}`);
          }
        }
        if (canSpend(used, limit, policy.reserve, 1)) {
          try {
            const eventsResult = await fetchFixtureEvents(apiKey, base, event.fixture_id);
            await charge(1, 'discover', '/fixtures/events');
            events = parseFixtureEvents(eventsResult.data, {
              homeName: event.home_team_name,
              awayName: event.away_team_name,
            });
          } catch (error) {
            failures.push(`${leagueName}: ${String(error?.message || error)}`);
          }
        }
        if (!statistics && !events) continue;
        const capability = await upsertMarketCapability(db, event, statistics, events);
        if (capability) discovered.push(capability);
      }
      summary = `Descoberta: ${discovered.length} liga(s) verificada(s)`;
    }

    const savedQuota = await saveQuota(db, quotaRecord, {
      ...(quotaRecord?.id ? {} : { day }),
      used,
      limit,
      level: quotaLevel(used, limit),
    });
    await releaseLock(db, savedQuota || quotaRecord);
    return Response.json({ ok: true, summary, failures, quota: { used, limit } });
  } catch (error) {
    if (base44 && quotaRecord?.id) {
      await base44.asServiceRole.entities.ApiQuota
        .update(quotaRecord.id, { lock_until: null, lock_owner: '', last_error: String(error?.message || error).slice(0, 400) })
        .catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
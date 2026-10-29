import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  apiFootballFetch,
  fetchFixtureEvents,
  fetchFixtureStatistics,
  footballApiBase,
} from '../../shared/apiFootball.ts';
import {
  DEFAULT_DAILY_LIMIT,
  canSpend,
  chargeQuota,
  effectiveDailyLimit,
  loadQuota,
  quotaDayKey,
  quotaLevel,
  quotaPercent,
  writeCache,
} from '../../shared/footballQuota.ts';

/**
 * Acompanhamento de uma partida: estatísticas, eventos e histórico.
 *
 * Os dados vêm da API-Football sob demanda, com reuso obrigatório entre todos
 * os usuários: cada seção tem um registro de cache próprio cuja validade é
 * também a resposta armazenada (payload normalizado e compacto). Enquanto o
 * cache é válido, nenhum crédito é gasto e todos os visitantes recebem os
 * mesmos dados. O orçamento diário compartilhado é respeitado com reserva e a
 * coleta para em contingência (consumo acima de 95% do orçamento).
 */

const RESERVE_CALLS = 10;
/** Estatísticas e eventos mudam durante o jogo; após o fim, são estáveis. */
const LIVE_STATS_TTL = 300;
const FINAL_STATS_TTL = 86400;
/** Histórico de confrontos e últimos jogos muda no máximo uma vez por dia. */
const HISTORY_TTL = 86400;
const MAX_H2H = 10;
const MAX_RECENT = 5;
/** Teto do payload armazenado por seção, protegendo o tamanho do registro. */
const MAX_PAYLOAD_CHARS = 15000;

const FINISHED_SHORTS = ['FT', 'AET', 'PEN'];

function normalizeStatistics(payload) {
  const rows = Array.isArray(payload?.response) ? payload.response : [];
  return rows.map((row) => ({
    team_id: row?.team?.id ? String(row.team.id) : '',
    team_name: row?.team?.name || '',
    stats: (row?.statistics || []).map((item) => ({
      type: String(item?.type || ''),
      value: item?.value === null || item?.value === undefined ? null : item?.value,
    })),
  }));
}

function normalizeEvents(payload) {
  const rows = Array.isArray(payload?.response) ? payload.response : [];
  return rows
    .map((row) => {
      const elapsed = Number(row?.time?.elapsed);
      const extra = Number(row?.time?.extra);
      return {
        minute: Number.isFinite(elapsed) ? elapsed + (Number.isFinite(extra) && extra > 0 ? extra : 0) : null,
        team: row?.team?.name || '',
        type: String(row?.type || ''),
        detail: String(row?.detail || ''),
        player: row?.player?.name || '',
      };
    })
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
}

function normalizeFixtures(payload, limit) {
  const rows = Array.isArray(payload?.response) ? payload.response : [];
  return rows
    .filter((row) => FINISHED_SHORTS.includes(String(row?.fixture?.status?.short || '').toUpperCase()))
    .map((row) => ({
      fixture_id: row?.fixture?.id ? String(row.fixture.id) : '',
      date: row?.fixture?.date || '',
      league: row?.league?.name || '',
      home: row?.teams?.home?.name || '',
      away: row?.teams?.away?.name || '',
      home_logo: row?.teams?.home?.logo || '',
      away_logo: row?.teams?.away?.logo || '',
      home_goals: row?.goals?.home,
      away_goals: row?.goals?.away,
      status: String(row?.fixture?.status?.short || '').toUpperCase(),
    }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);
}

/** Lê a seção em cache: payload normalizado guardado no próprio registro. */
async function readSection(db, key) {
  const page = await db.ApiCache.filter({ provider: 'api_football', key }, { limit: 1 });
  const row = page.items?.[0] || null;
  if (!row) return { fresh: false, payload: null, fetched_at: null };
  const fresh = Boolean(row.expires_at && Date.parse(row.expires_at) > Date.now());
  let payload = null;
  if (row.note && row.note.startsWith('{')) {
    try {
      payload = JSON.parse(row.note);
    } catch {
      payload = null;
    }
  }
  return { fresh, payload, fetched_at: row.fetched_at || null };
}

async function writeSection(db, { key, endpoint, params, ttlSeconds, payload, note }) {
  const encoded = JSON.stringify(payload);
  await writeCache(db, {
    key,
    endpoint,
    params,
    ttlSeconds,
    records: Array.isArray(payload) ? payload.length : 0,
    note: encoded.length <= MAX_PAYLOAD_CHARS ? encoded : (note || 'payload grande demais para o cache'),
  });
}

export default async function (req) {
  let base44;
  try {
    base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const eventId = String(payload?.event_id || '');
    if (!eventId) return Response.json({ error: 'event_id é obrigatório' }, { status: 400 });

    const event = await db.Event.get(eventId).catch(() => null);
    if (!event) return Response.json({ ok: true, available: false, reason: 'Partida não encontrada' });
    if (!event.fixture_id) {
      return Response.json({ ok: true, available: false, reason: 'Partida sem vínculo com a fonte de dados' });
    }

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || null;
    if (!settings?.football_enabled) {
      return Response.json({ ok: true, available: false, reason: 'Integração API-Football desabilitada' });
    }
    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ ok: true, available: false, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    const now = new Date();
    const nowMs = now.getTime();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);
    const quotaRecord = await loadQuota(db, day);
    const limit = effectiveDailyLimit(Number(settings.football_daily_limit) || DEFAULT_DAILY_LIMIT, quotaRecord?.provider_limit);
    let used = Number(quotaRecord?.used || 0);
    const level = quotaLevel(used, limit);
    if (level >= 3) {
      return Response.json({
        ok: true,
        available: false,
        reason: 'Orçamento diário da API-Football em contingência',
        quota: { used, limit, percent: quotaPercent(used, limit), level },
      });
    }

    const started = Date.parse(event.start_time || '') <= nowMs;
    const finished = event.status === 'finished';
    const statsTtl = finished ? FINAL_STATS_TTL : LIVE_STATS_TTL;

    const fixtureId = String(event.fixture_id);
    const homeId = event.home_team_id ? String(event.home_team_id) : '';
    const awayId = event.away_team_id ? String(event.away_team_id) : '';

    const sections = { statistics: null, events: null, h2h: null, home_recent: null, away_recent: null };
    const fetched = {};
    const failures = [];
    let calls = 0;

    /** Coleta uma seção: serve o cache válido, consulta a fonte apenas quando
     *  o cache venceu e ainda há orçamento acima da reserva. */
    const collect = async ({ key, endpoint, params, ttlSeconds, normalize, condition = true }) => {
      const hit = await readSection(db, key);
      if (hit.fresh && hit.payload) {
        fetched[key] = hit.fetched_at;
        return hit.payload;
      }
      if (!condition) return null;
      if (!canSpend(used, limit, RESERVE_CALLS, 1)) {
        failures.push(`orçamento reservado: ${used}/${limit}`);
        return null;
      }
      try {
        const result = await apiFootballFetch(apiKey, endpoint, params, { base });
        const charged = await chargeQuota(db, {
          record: quotaRecord,
          day,
          limit,
          cost: 1,
          purpose: 'insights',
          endpoint,
          reserve: RESERVE_CALLS,
        });
        if (!charged.allowed) {
          failures.push(`orçamento esgotado: ${used}/${limit}`);
          return null;
        }
        used = charged.used;
        calls += 1;
        if (result.errors.length) {
          failures.push(`${endpoint}: ${result.errors.join(' | ')}`);
          return null;
        }
        const data = normalize(result.data);
        await writeSection(db, { key, endpoint, params: JSON.stringify(params), ttlSeconds, payload: data });
        fetched[key] = new Date().toISOString();
        return data;
      } catch (error) {
        failures.push(`${endpoint}: ${String(error?.message || error)}`);
        return null;
      }
    };

    // Estatísticas e eventos só existem a partir do apito inicial.
    if (started) {
      sections.statistics = await collect({
        key: `insights:statistics:${fixtureId}`,
        endpoint: '/fixtures/statistics',
        params: { fixture: fixtureId },
        ttlSeconds: statsTtl,
        normalize: normalizeStatistics,
      });
      sections.events = await collect({
        key: `insights:events:${fixtureId}`,
        endpoint: '/fixtures/events',
        params: { fixture: fixtureId },
        ttlSeconds: statsTtl,
        normalize: normalizeEvents,
      });
    }

    // Histórico: confrontos diretos e últimos jogos de cada equipe.
    if (homeId && awayId) {
      sections.h2h = await collect({
        key: `insights:h2h:${homeId}-${awayId}`,
        endpoint: '/fixtures/headtohead',
        params: { h2h: `${homeId}-${awayId}`, timezone: FOOTBALL_TIMEZONE },
        ttlSeconds: HISTORY_TTL,
        normalize: (data) => normalizeFixtures(data, MAX_H2H),
      });
      sections.home_recent = await collect({
        key: `insights:recent:${homeId}`,
        endpoint: '/fixtures',
        params: { team: homeId, last: 10, timezone: FOOTBALL_TIMEZONE },
        ttlSeconds: HISTORY_TTL,
        normalize: (data) => normalizeFixtures(data, MAX_RECENT),
      });
      sections.away_recent = await collect({
        key: `insights:recent:${awayId}`,
        endpoint: '/fixtures',
        params: { team: awayId, last: 10, timezone: FOOTBALL_TIMEZONE },
        ttlSeconds: HISTORY_TTL,
        normalize: (data) => normalizeFixtures(data, MAX_RECENT),
      });
    }

    const hasAny = Object.values(sections).some(Boolean);
    return Response.json({
      ok: true,
      available: hasAny,
      event_status: event.status,
      started,
      sections,
      fetched,
      calls,
      quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
      failures: failures.slice(0, 5),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
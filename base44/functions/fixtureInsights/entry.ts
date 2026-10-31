import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { FOOTBALL_TIMEZONE, footballApiBase } from '../../shared/apiFootball.ts';
import { FOOTBALL_LIMITS, FOOTBALL_TTL } from '../../shared/footballConfig.ts';
import { isThrottleError, openFootballClient } from '../../shared/footballClient.ts';
import {
  DEFAULT_DAILY_LIMIT,
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
 * mesmos dados — nenhum card ou usuário gera chamada própria.
 *
 * Camadas de proteção (todas compartilhadas com as demais rotinas):
 * - deduplicação de execuções simultâneas: se outra requisição já está buscando
 *   a mesma seção, esta espera o cache dela em vez de repetir a chamada;
 * - limite por minuto e pausa pós-429 da camada central: quando a fonte está
 *   limitada, serve o último dado válido em cache com o horário dele marcado
 *   como desatualizado — nunca como atualização ao vivo;
 * - orçamento diário com reserva e parada em contingência (95%+).
 */

const RESERVE_CALLS = FOOTBALL_LIMITS.reservePlacares;
/** Estatísticas e eventos mudam durante o jogo; após o fim, são estáveis. */
const LIVE_STATS_TTL = FOOTBALL_TTL.liveStats;
const FINAL_STATS_TTL = FOOTBALL_TTL.finalStats;
/** Histórico de confrontos e últimos jogos muda no máximo uma vez por dia. */
const HISTORY_TTL = FOOTBALL_TTL.history;
const MAX_H2H = 10;
const MAX_RECENT = 5;
/** Teto do payload armazenado por seção, protegendo o tamanho do registro. */
const MAX_PAYLOAD_CHARS = 15000;
/** Janela em que outra execução buscando a mesma seção é considerada ativa. */
const INFLIGHT_TTL_SECONDS = FOOTBALL_TTL.inflight;

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

/* ------- deduplicação de buscas simultâneas da mesma seção ------- */

const inflightKey = (key) => `inflight:${key}`;

async function inflightFresh(db, key) {
  const page = await db.ApiCache.filter({ provider: 'api_football', key: inflightKey(key) }, { limit: 1 });
  const row = page.items?.[0];
  return Boolean(row?.fetched_at && Date.parse(row.fetched_at) > Date.now() - INFLIGHT_TTL_SECONDS * 1000);
}

async function markInflight(db, key) {
  await writeCache(db, {
    key: inflightKey(key),
    endpoint: 'inflight',
    params: key,
    ttlSeconds: INFLIGHT_TTL_SECONDS,
    records: 0,
    note: 'busca em andamento por outra execução',
  });
}

async function clearInflight(db, key) {
  await db.ApiCache.deleteMany({ provider: 'api_football', key: inflightKey(key) });
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
    const used = Number(quotaRecord?.used || 0);
    const level = quotaLevel(used, limit);
    if (level >= 3) {
      return Response.json({
        ok: true,
        available: false,
        reason: 'Orçamento diário da API-Football em contingência',
        quota: { used, limit, percent: quotaPercent(used, limit), level },
      });
    }

    // Camada central de requisições: pausa pós-429, limite por minuto e
    // orçamento diário compartilhados com todas as demais rotinas.
    const client = await openFootballClient(db, {
      apiKey,
      base,
      settings,
      day,
      limit,
      reserve: RESERVE_CALLS,
      label: 'insights',
    });

    const started = Date.parse(event.start_time || '') <= nowMs;
    const finished = event.status === 'finished';
    const statsTtl = finished ? FINAL_STATS_TTL : LIVE_STATS_TTL;

    const fixtureId = String(event.fixture_id);
    const homeId = event.home_team_id ? String(event.home_team_id) : '';
    const awayId = event.away_team_id ? String(event.away_team_id) : '';

    const sections = { statistics: null, events: null, h2h: null, home_recent: null, away_recent: null };
    const fetched = {};
    const staleSections = {};
    const failures = [];
    let calls = 0;

    /**
     * Coleta uma seção: cache válido é servido a todos; cache vencido gera
     * uma única chamada (deduplicada entre execuções simultâneas); quando a
     * fonte está pausada/limitada, serve o último dado válido com o horário
     * dele — identificado como desatualizado, nunca como tempo real.
     */
    const collect = async ({ key, endpoint, params, ttlSeconds, normalize, condition = true }) => {
      const hit = await readSection(db, key);
      if (hit.fresh && hit.payload) {
        fetched[key] = hit.fetched_at;
        return hit.payload;
      }
      if (!condition) return null;
      // Outra execução já está buscando esta mesma seção: ela grava o cache
      // em segundos; aqui não se repete a chamada externa.
      if (await inflightFresh(db, key)) {
        if (hit.payload) {
          staleSections[key] = hit.fetched_at;
          return hit.payload;
        }
        return null;
      }
      await markInflight(db, key);
      try {
        const result = await client.call(endpoint, params, { purpose: 'insights' });
        calls += 1;
        if (result.errors.length) {
          failures.push(`${endpoint}: ${result.errors.join(' | ')}`);
          return null;
        }
        const data = normalize(result.data);
        await writeSection(db, { key, endpoint, params: JSON.stringify(params), ttlSeconds, payload: data });
        await clearInflight(db, key);
        fetched[key] = new Date().toISOString();
        return data;
      } catch (error) {
        await clearInflight(db, key).catch(() => null);
        if (isThrottleError(error)) {
          // Fonte pausada (429) ou limite por minuto: o último dado válido em
          // cache é servido com o horário da coleta — dado antigo nunca se
          // apresenta como atualização em tempo real.
          if (hit.payload) {
            staleSections[key] = hit.fetched_at;
            return hit.payload;
          }
          failures.push(`${endpoint}: ${String(error?.message || error)}`);
          return null;
        }
        failures.push(`${endpoint}: ${String(error?.message || error)}`);
        return null;
      }
    };

    // Eventos e estatísticas são coletados durante o jogo somente para partidas
    // com bilhete ativo: partida sem aposta não gera chamada desses endpoints.
    // Cache válido continua sendo servido a todos, sem custo. Partida encerrada
    // é coletada uma única vez (validade de 24 h) para a página não ficar vazia.
    const openBets = await db.SimulationSelection.count({ event_id: eventId, status: 'open' });
    const liveDetailAllowed = finished || openBets > 0;

    // Estatísticas e eventos só existem a partir do apito inicial.
    if (started) {
      sections.statistics = await collect({
        key: `insights:statistics:${fixtureId}`,
        endpoint: '/fixtures/statistics',
        params: { fixture: fixtureId },
        ttlSeconds: statsTtl,
        normalize: normalizeStatistics,
        condition: liveDetailAllowed,
      });
      sections.events = await collect({
        key: `insights:events:${fixtureId}`,
        endpoint: '/fixtures/events',
        params: { fixture: fixtureId },
        ttlSeconds: statsTtl,
        normalize: normalizeEvents,
        condition: liveDetailAllowed,
      });
    }

    // Histórico: confrontos diretos e últimos jogos de cada equipe. Cache válido
    // é sempre servido (custo zero); a coleta externa acontece antes do apito
    // inicial ou quando o visitante pede — durante o jogo a prioridade são
    // estatísticas e eventos, e o histórico não consome cota.
    const includeHistory = !started || Boolean(payload?.include_history);
    if (homeId && awayId) {
      sections.h2h = await collect({
        key: `insights:h2h:${homeId}-${awayId}`,
        endpoint: '/fixtures/headtohead',
        params: { h2h: `${homeId}-${awayId}`, timezone: FOOTBALL_TIMEZONE },
        ttlSeconds: HISTORY_TTL,
        normalize: (data) => normalizeFixtures(data, MAX_H2H),
        condition: includeHistory,
      });
      sections.home_recent = await collect({
        key: `insights:recent:${homeId}`,
        endpoint: '/fixtures',
        params: { team: homeId, last: 10, timezone: FOOTBALL_TIMEZONE },
        ttlSeconds: HISTORY_TTL,
        normalize: (data) => normalizeFixtures(data, MAX_RECENT),
        condition: includeHistory,
      });
      sections.away_recent = await collect({
        key: `insights:recent:${awayId}`,
        endpoint: '/fixtures',
        params: { team: awayId, last: 10, timezone: FOOTBALL_TIMEZONE },
        ttlSeconds: HISTORY_TTL,
        normalize: (data) => normalizeFixtures(data, MAX_RECENT),
        condition: includeHistory,
      });
    }

    const hasAny = Object.values(sections).some(Boolean);
    return Response.json({
      ok: true,
      available: hasAny,
      // Sem dados não se afirma "não existe": falha da fonte e ausência de
      // cobertura são situações diferentes para o visitante.
      reason: hasAny ? '' : failures.length ? 'Fonte de dados temporariamente indisponível · nenhuma informação confirmada para esta partida ainda' : '',
      event_status: event.status,
      started,
      history_available: Boolean(homeId && awayId) && !includeHistory && !sections.h2h,
      sections,
      fetched,
      stale: staleSections,
      calls,
      quota: { used: client.used, limit, percent: quotaPercent(client.used, limit), level: quotaLevel(client.used, limit) },
      failures: failures.slice(0, 5),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
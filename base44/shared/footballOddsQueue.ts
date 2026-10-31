/**
 * Fila de cotações PRÉ-JOGO (curadoria).
 *
 * A janela de 7 dias tem milhares de partidas e o orçamento diário não permite
 * cotar todas. Entra na fila apenas o que o jogador pode encontrar na grade:
 *
 * - partidas futuras cuja relevância passou do mínimo configurado em
 *   ODDS_CURATION (competição prioritária, time de alta relevância etc.);
 * - partidas favoritas do jogador;
 * - partidas com aposta aberta — o preço precisa acompanhar até a liquidação.
 *
 * A cadência de cada item vem da distância até o início, nunca de um relógio
 * de tempo real: 30 min perto do jogo, 6 h para o que está a dias de distância.
 */
import {
  FOOTBALL_CADENCE,
  ODDS_CURATION,
  ODDS_PRIORITY,
  ODDS_PRIORITY_ORDER,
  oddsCadenceSeconds,
} from './footballConfig.ts';
import { chunkArray } from './matchLifecycle.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Horas entre agora e o início da partida (nunca negativo). */
export function hoursToKickoff(startTime, nowMs) {
  const start = Date.parse(startTime || '');
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, (start - nowMs) / (60 * 60 * 1000));
}

/** Prioridade de uma partida, da mais urgente para a menos urgente. */
function resolvePriority({ hasBets, isFavorite, relevance, hours }) {
  if (hasBets) return 'APOSTA_ABERTA';
  if (isFavorite) return 'FAVORITA';
  if (relevance >= ODDS_CURATION.highRelevance || hours <= 12) return 'CRITICA';
  return 'NORMAL';
}

/**
 * Monta (ou atualiza) a fila a partir do banco: curadoria por relevância na
 * janela de 7 dias, mais favoritas e apostas abertas. O que já saiu da janela
 * ou já começou simplesmente não entra.
 */
export async function refreshOddsQueue(db, { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const horizonIso = new Date(nowMs + FOOTBALL_CADENCE.oddsWindowDays * DAY_MS).toISOString();

  const favoriteFixtureIds = new Set();
  const favoritePage = await db.FavoriteMatch.list({ limit: 500 });
  (favoritePage.items || []).forEach((row) => row.fixture_id && favoriteFixtureIds.add(String(row.fixture_id)));

  const betFixtureIds = new Set();
  const betEventIds = new Set();
  let betCursor = null;
  for (let round = 0; round < 3; round += 1) {
    const page = await db.SimulationSelection.filter(
      { status: 'open' },
      { limit: 500, ...(betCursor ? { cursor: betCursor } : {}) },
    );
    (page.items || []).forEach((row) => {
      if (row.fixture_id) betFixtureIds.add(String(row.fixture_id));
      if (row.event_id) betEventIds.add(row.event_id);
    });
    betCursor = page.next_cursor;
    if (!page.has_more) break;
  }

  // Curadoria: partidas futuras acima da relevância mínima.
  const candidates = [];
  let cursor = null;
  for (let round = 0; round < 4; round += 1) {
    const page = await db.Event.filter(
      {
        source: 'provider',
        status: 'scheduled',
        start_time: { $gt: nowIso, $lte: horizonIso },
        relevance_score: { $gte: ODDS_CURATION.minRelevance },
      },
      { limit: 500, sort: '-relevance_score', ...(cursor ? { cursor } : {}) },
    );
    const items = page.items || [];
    if (!items.length) break;
    candidates.push(...items);
    cursor = page.next_cursor;
    if (!page.has_more || candidates.length >= ODDS_CURATION.maxQueueItems) break;
  }

  // Fora da curadoria, favorita e aposta aberta continuam valendo preço.
  const known = new Map(candidates.map((event) => [event.id, event]));
  const extraIds = [...new Set([...betEventIds, ...betFixtureIds])].filter(Boolean);
  for (const chunk of chunkArray(extraIds, 100)) {
    if (!chunk.length) continue;
    const [byId, byFixture] = await Promise.all([
      db.Event.filter({ id: { $in: chunk } }, { limit: 500 }).catch(() => ({ items: [] })),
      db.Event.filter({ fixture_id: { $in: chunk } }, { limit: 500 }).catch(() => ({ items: [] })),
    ]);
    [...(byId.items || []), ...(byFixture.items || [])].forEach((event) => {
      if (known.has(event.id)) return;
      if (String(event.source || '') !== 'provider') return;
      if (event.status !== 'scheduled') return;
      const startMs = Date.parse(event.start_time || '');
      if (!Number.isFinite(startMs) || startMs <= nowMs || startMs > Date.parse(horizonIso)) return;
      known.set(event.id, event);
    });
  }

  const rows = [...known.values()]
    .slice(0, ODDS_CURATION.maxQueueItems)
    .map((event) => {
      const fixtureId = String(event.fixture_id || '');
      const hours = hoursToKickoff(event.start_time, nowMs);
      const hasBets = betFixtureIds.has(fixtureId) || betEventIds.has(event.id);
      const isFavorite = favoriteFixtureIds.has(fixtureId);
      const relevance = Number(event.relevance_score) || 0;
      const priority = resolvePriority({ hasBets, isFavorite, relevance, hours });
      const cadence = Math.min(
        oddsCadenceSeconds({ hoursToKickoff: hours, hasBets, isFavorite }),
        ODDS_PRIORITY[priority],
      );
      return { event, fixtureId, priority, cadence, hasBets, isFavorite, relevance, hours };
    })
    .filter((row) => row.fixtureId);

  // Fila persistida: atualiza prioridade/cadência e o próximo horário de coleta.
  const existing = new Map();
  for (const chunk of chunkArray(rows.map((row) => row.fixtureId), 100)) {
    if (!chunk.length) continue;
    const page = await db.OddsQueueItem.filter({ fixture_id: { $in: chunk } }, { limit: 500 });
    (page.items || []).forEach((item) => existing.set(item.fixture_id, item));
  }

  const updates = [];
  const creations = [];
  rows.forEach(({ event, fixtureId, priority, cadence, hasBets, isFavorite, relevance }) => {
    const reason = hasBets
      ? 'aposta aberta'
      : isFavorite
        ? 'favorita do jogador'
        : relevance >= ODDS_CURATION.highRelevance
          ? `relevância ${Math.round(relevance)}`
          : 'grade pré-jogo';
    const found = existing.get(fixtureId);
    if (found) {
      if (found.priority === priority && Number(found.cadence_seconds) === cadence && found.event_id === event.id) return;
      updates.push({
        id: found.id,
        event_id: event.id,
        priority,
        cadence_seconds: cadence,
        reason,
      });
      return;
    }
    creations.push({
      fixture_id: fixtureId,
      event_id: event.id,
      priority,
      cadence_seconds: cadence,
      status: 'queued',
      reason,
      next_run_at: nowIso,
      last_run_at: null,
    });
  });

  for (const chunk of chunkArray(updates, 200)) {
    if (chunk.length) await db.OddsQueueItem.bulkUpdate(chunk);
  }
  for (const chunk of chunkArray(creations, 100)) {
    if (chunk.length) await db.OddsQueueItem.bulkCreate(chunk);
  }

  return { size: rows.length, updated: updates.length, created: creations.length, priorities: ODDS_PRIORITY_ORDER };
}

/** Itens vencidos, na ordem de prioridade (aposta aberta primeiro). */
export async function dueOddsItems(db, { now = new Date(), limit = 200 } = {}) {
  const nowIso = now.toISOString();
  const items = [];
  for (const priority of ODDS_PRIORITY_ORDER) {
    if (items.length >= limit) break;
    const page = await db.OddsQueueItem.filter(
      { priority, status: 'queued', next_run_at: { $lte: nowIso } },
      { limit: Math.min(200, limit - items.length), sort: 'next_run_at' },
    );
    items.push(...(page.items || []));
  }
  if (!items.length) return { items: [], events: [], priority: null };

  const eventIds = [...new Set(items.map((item) => item.event_id).filter(Boolean))];
  const events = new Map();
  for (const chunk of chunkArray(eventIds, 100)) {
    if (!chunk.length) continue;
    const page = await db.Event.filter({ id: { $in: chunk } }, { limit: 500 });
    (page.items || []).forEach((event) => events.set(event.id, event));
  }

  return { items, events: [...events.values()], priority: items[0]?.priority || null };
}

/** Marca o item como atendido e agenda a próxima coleta pela cadência. */
export async function markOddsItemsDone(db, items, { now = new Date() } = {}) {
  if (!items?.length) return 0;
  const nowMs = now.getTime();
  const updates = items.map((item) => {
    const cadence = Number(item.cadence_seconds) || ODDS_PRIORITY[item.priority] || ODDS_PRIORITY.NORMAL;
    return {
      id: item.id,
      status: 'queued',
      last_run_at: new Date(nowMs).toISOString(),
      next_run_at: new Date(nowMs + cadence * 1000).toISOString(),
    };
  });
  for (const chunk of chunkArray(updates, 200)) {
    if (chunk.length) await db.OddsQueueItem.bulkUpdate(chunk);
  }
  return updates.length;
}
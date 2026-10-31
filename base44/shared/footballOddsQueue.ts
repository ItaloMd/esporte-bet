/**
 * Fila prioritária de cotações.
 *
 * Só entra na fila a partida que realmente precisa de preço: em andamento,
 * favorita do jogador, com aposta aberta ou do dia (NORMAL). A cadência de cada
 * prioridade vem de footballConfig (60/120/180/300 s) e nenhuma partida fora da
 * fila recebe cotação.
 */
import { ODDS_PRIORITY, ODDS_PRIORITY_ORDER } from './footballConfig.ts';
import { localDateString } from './oddsApi.ts';
import { FOOTBALL_TIMEZONE } from './apiFootball.ts';
import { chunkArray } from './matchLifecycle.ts';

/** Teto de partidas na fila: protege o banco e a cota. */
const MAX_QUEUE_ITEMS = 400;

/** Prioridade de uma partida, da mais urgente para a menos urgente. */
function resolvePriority({ isLive, isFavorite, hasBets }) {
  if (isLive) return 'CRITICA';
  if (isFavorite) return 'FAVORITA';
  if (hasBets) return 'APOSTA_ABERTA';
  return 'NORMAL';
}

/**
 * Monta (ou atualiza) a fila a partir do banco: live_fixtures para as partidas
 * em andamento, favoritos e apostas abertas para a urgência, e a grade publicada
 * do dia para as demais.
 */
export async function refreshOddsQueue(db, { now = new Date() } = {}) {
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const livePage = await db.LiveFixture.list({ limit: 300 });
  const liveIds = new Set((livePage.items || []).map((row) => row.fixture_id));

  const favoriteIds = new Set();
  const favoritePage = await db.FavoriteMatch.list({ limit: 500 });
  (favoritePage.items || []).forEach((row) => row.fixture_id && favoriteIds.add(String(row.fixture_id)));

  const betIds = new Set();
  const betEventIds = new Set();
  let cursor = null;
  for (let round = 0; round < 3; round += 1) {
    const page = await db.SimulationSelection.filter(
      { status: 'open' },
      { limit: 500, ...(cursor ? { cursor } : {}) },
    );
    (page.items || []).forEach((row) => {
      if (row.fixture_id) betIds.add(String(row.fixture_id));
      if (row.event_id) betEventIds.add(row.event_id);
    });
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }

  // Grade candidata: apenas partidas da fonte que ainda não começaram. Jogo
  // iniciado não recebe mais aposta, então ocupar a fila só consumiria cota.
  const horizon = new Date(nowMs + 6 * 24 * 60 * 60 * 1000).toISOString();
  const candidates = [];
  let eventCursor = null;
  for (let round = 0; round < 6; round += 1) {
    const page = await db.Event.filter(
      {
        source: 'provider',
        status: 'scheduled',
        start_time: { $gt: nowIso, $lte: horizon },
      },
      { limit: 500, sort: 'start_time', ...(eventCursor ? { cursor: eventCursor } : {}) },
    );
    const items = page.items || [];
    if (!items.length) break;
    candidates.push(...items);
    eventCursor = page.next_cursor;
    if (!page.has_more || candidates.length >= MAX_QUEUE_ITEMS) break;
  }

  const rows = candidates.slice(0, MAX_QUEUE_ITEMS).map((event) => {
    const fixtureId = String(event.fixture_id || '');
    const isLive = liveIds.has(fixtureId) || event.status === 'live';
    const priority = resolvePriority({
      isLive,
      isFavorite: favoriteIds.has(fixtureId),
      hasBets: betIds.has(fixtureId) || betEventIds.has(event.id),
    });
    return { event, fixtureId, priority };
  }).filter((row) => row.fixtureId);

  // Fila persistida: atualiza prioridade/cadência das já existentes.
  const existing = new Map();
  const ids = rows.map((row) => row.fixtureId);
  for (const chunk of chunkArray(ids, 100)) {
    const page = await db.OddsQueueItem.filter({ fixture_id: { $in: chunk } }, { limit: 500 });
    (page.items || []).forEach((item) => existing.set(item.fixture_id, item));
  }

  const updates = [];
  const creations = [];
  rows.forEach(({ event, fixtureId, priority }) => {
    const cadence = ODDS_PRIORITY[priority];
    const found = existing.get(fixtureId);
    if (found) {
      updates.push({
        id: found.id,
        event_id: event.id,
        priority,
        cadence_seconds: cadence,
        reason: priority === 'CRITICA' ? 'partida ao vivo' : priority === 'FAVORITA' ? 'favorita' : priority === 'APOSTA_ABERTA' ? 'aposta aberta' : 'grade do dia',
      });
      return;
    }
    creations.push({
      fixture_id: fixtureId,
      event_id: event.id,
      priority,
      cadence_seconds: cadence,
      status: 'queued',
      reason: 'entrou na fila',
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

  return { size: rows.length, priorities: ODDS_PRIORITY_ORDER };
}

/**
 * Itens vencidos, na ordem de prioridade. Devolve também os dias (calendário
 * brasileiro) que precisam de uma nova coleta de cotações.
 */
export async function dueOddsItems(db, { now = new Date(), limit = 120 } = {}) {
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
  if (!items.length) return { items: [], dates: [] };

  const eventIds = [...new Set(items.map((item) => item.event_id).filter(Boolean))];
  const events = new Map();
  for (const chunk of chunkArray(eventIds, 100)) {
    const page = await db.Event.filter({ id: { $in: chunk } }, { limit: 500 });
    (page.items || []).forEach((event) => events.set(event.id, event));
  }

  const dates = [...new Set(
    items
      .map((item) => events.get(item.event_id))
      .filter(Boolean)
      .map((event) => localDateString(new Date(event.start_time), FOOTBALL_TIMEZONE)),
  )];

  return { items, dates, priority: items[0]?.priority || null };
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
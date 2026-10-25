/**
 * Gravação de mercados e cotações a partir de cotações normalizadas.
 *
 * Recebe, por partida, os mercados já agrupados por linha e resultado, aplica a
 * margem da casa sobre cada mercado completo e mantém o banco coerente:
 * mercados que a fonte deixou de devolver ficam suspensos, cotações não
 * renovadas na execução são substituídas e a partida só permanece publicada
 * enquanto tiver pelo menos um mercado prioritário oferecido.
 *
 * A cotação retida (`quote_state: 'withheld'`) nunca é oferecida: quando o
 * conjunto está incompleto, a seleção fica suspensa em vez de sair com preço
 * incorreto. Super odds marcadas pelo admin prevalecem sobre o recálculo.
 */
import { HOUSE_MARGIN_VERSION, PRIORITY_MARKETS, applyHouseMargin, marketGroup, marketName } from './oddsApi.ts';

const ID_CHUNK = 100;
const WRITE_CHUNK = 400;

/** Ordem de exibição dos mercados conhecidos. */
export function marketSortOrder(marketKey) {
  if (marketKey === 'h2h') return 1;
  if (marketKey === 'spreads') return 2;
  if (marketKey === 'totals') return 3;
  return 9;
}

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

async function loadByExternalId(db, entityName, externalIds) {
  const map = new Map();
  for (const ids of chunk(externalIds, ID_CHUNK)) {
    const page = await db[entityName].filter({ external_id: { $in: ids } }, { limit: 500 });
    (page.items || []).forEach((row) => map.set(row.external_id, row));
  }
  return map;
}

async function writeInChunks(db, entityName, rows, operation) {
  for (const batch of chunk(rows, WRITE_CHUNK)) {
    if (operation === 'create') await db[entityName].bulkCreate(batch);
    else await db[entityName].bulkUpdate(batch);
  }
}

/**
 * `quotesByEvent`: Map<external_id da partida, {
 *   event: registro da partida,
 *   markets: Map<chave do mercado, Map<linha, { universe: Set<código>, quotes: Map<código, cotação> }>>,
 *   books: Map<chave do mercado, Set<nome da casa>>
 * }>
 */
export async function writeQuotes(db, {
  quotesByEvent,
  houseMargin,
  marginVersion = HOUSE_MARGIN_VERSION,
  now,
  priorityMarkets = PRIORITY_MARKETS,
}) {
  const iso = now.toISOString();
  const marketRows = new Map();
  const oddRows = new Map();
  const offeredEvents = new Set();
  const consulted = new Set();

  quotesByEvent.forEach((entry, eventExternalId) => {
    const eventRow = entry.event;
    consulted.add(eventExternalId);

    entry.markets.forEach((byLine, marketKey) => {
      const marketRef = `${eventExternalId}|${marketKey}`;
      let offeredLines = 0;

      byLine.forEach((group, lineKey) => {
        const quotes = [...group.quotes.values()];
        // Mercado completo: todos os resultados possíveis observados têm preço válido.
        const complete =
          group.universe.size >= 2 &&
          quotes.length === group.universe.size &&
          [...group.universe].every((code) => group.quotes.has(code));
        const margin = complete ? applyHouseMargin(quotes, houseMargin) : null;
        if (margin) offeredLines += 1;

        quotes.forEach((quote, index) => {
          const offered = margin ? margin.values[index] : null;
          const externalId = `${eventExternalId}|${marketKey}|${quote.code}`;
          const row = {
            event_id: eventRow.id,
            market_name: marketName(marketKey, eventRow.sport_slug),
            market_group: marketGroup(marketKey),
            market_key: marketKey,
            bookmaker: quote.bookmaker,
            label: quote.label,
            code: quote.code,
            original_value: quote.original_value,
            value: offered === null ? quote.original_value : offered,
            house_margin_percent: margin ? margin.margin_percent : null,
            calc_version: margin ? marginVersion : null,
            original_overround: margin ? margin.original_overround : null,
            target_overround: margin ? margin.target_overround : null,
            offered_overround: margin ? margin.offered_overround : null,
            quote_state: margin ? 'offered' : 'withheld',
            status: margin ? 'open' : 'suspended',
            sort_order: marketSortOrder(marketKey),
            source: 'provider',
            external_id: externalId,
            last_sync_at: iso,
            market_ref: marketRef,
          };
          if (quote.line !== null && quote.line !== undefined) row.line = quote.line;
          if (quote.source_updated_at) row.source_updated_at = quote.source_updated_at;
          oddRows.set(externalId, row);
        });
      });

      if (!offeredLines && ![...byLine.values()].some((group) => group.quotes.size)) return;
      if (offeredLines && priorityMarkets.includes(marketKey)) offeredEvents.add(eventExternalId);
      marketRows.set(marketRef, {
        event_id: eventRow.id,
        name: marketName(marketKey, eventRow.sport_slug),
        code: marketKey,
        market_key: marketKey,
        market_group: marketGroup(marketKey),
        status: offeredLines ? 'open' : 'suspended',
        sort_order: marketSortOrder(marketKey),
        is_main: marketKey === 'h2h',
        bookmaker_count: (entry.books?.get(marketKey) || new Set()).size,
        source: 'provider',
        external_id: marketRef,
        last_sync_at: iso,
      });
    });
  });

  const marketRefs = [...marketRows.keys()];
  const existingMarkets = await loadByExternalId(db, 'Market', marketRefs);
  const marketCreates = [];
  const marketUpdates = [];
  marketRows.forEach((row, marketRef) => {
    const existing = existingMarkets.get(marketRef);
    if (existing) marketUpdates.push({ id: existing.id, ...row });
    else marketCreates.push(row);
  });
  await writeInChunks(db, 'Market', marketCreates, 'create');
  await writeInChunks(db, 'Market', marketUpdates, 'update');

  const marketDb = await loadByExternalId(db, 'Market', marketRefs);
  const existingOdds = await loadByExternalId(db, 'Odd', [...oddRows.keys()]);
  const oddCreates = [];
  const oddUpdates = [];
  oddRows.forEach((row, externalId) => {
    const market = marketDb.get(row.market_ref);
    if (!market) return;
    const payload = { ...row, market_id: market.id };
    delete payload.market_ref;
    const existing = existingOdds.get(externalId);
    if (existing) {
      const previousValue = Number(existing.value);
      payload.previous_value = Number.isFinite(previousValue) ? previousValue : payload.value;
      payload.movement = payload.value > previousValue ? 'up' : payload.value < previousValue ? 'down' : 'stable';
      // Super odd marcada pelo admin: o valor promocional prevalece sobre o
      // recálculo de margem, para que o destaque não desapareça na sincronização.
      if (existing.is_super_odd) {
        payload.value = previousValue;
        payload.is_super_odd = true;
        payload.super_odd_value = Number(existing.super_odd_value) || previousValue;
        payload.super_odd_at = existing.super_odd_at;
      }
      oddUpdates.push({ id: existing.id, ...payload });
    } else {
      oddCreates.push(payload);
    }
  });
  await writeInChunks(db, 'Odd', oddCreates, 'create');
  await writeInChunks(db, 'Odd', oddUpdates, 'update');

  const consultedIds = [...consulted].map((externalId) => quotesByEvent.get(externalId)?.event?.id).filter(Boolean);
  const refreshedRefs = new Set(marketRows.keys());

  // Mercados que a fonte deixou de devolver nesta execução deixam de ser
  // oferecidos: o mercado e suas seleções passam a suspenso, sem apagar nada.
  const vanishedMarketIds = [];
  for (const ids of chunk(consultedIds, ID_CHUNK)) {
    const page = await db.Market.filter({ event_id: { $in: ids } }, { limit: 500 });
    (page.items || []).forEach((market) => {
      if (refreshedRefs.has(market.external_id)) return;
      if (market.status === 'suspended') return;
      vanishedMarketIds.push(market.id);
    });
  }
  for (const ids of chunk(vanishedMarketIds, ID_CHUNK)) {
    await db.Market.updateMany({ id: { $in: ids } }, { $set: { status: 'suspended' } });
  }

  // Cotações não renovadas nesta execução são substituídas: evita duplicar
  // seleções e impede que um preço antigo volte a ser oferecido sem margem.
  const staleOddIds = [];
  for (const ids of chunk(consultedIds, ID_CHUNK)) {
    let cursor = null;
    for (let round = 0; round < 20; round += 1) {
      const page = await db.Odd.filter(
        { event_id: { $in: ids }, last_sync_at: { $lt: iso } },
        { limit: 500, ...(cursor ? { cursor } : {}) },
      );
      (page.items || []).forEach((row) => staleOddIds.push(row.id));
      cursor = page.next_cursor;
      if (!page.has_more) break;
    }
  }
  for (const ids of chunk(staleOddIds, 200)) {
    await db.Odd.deleteMany({ id: { $in: ids } });
  }

  const eventUpdates = [];
  let available = 0;
  let unavailable = 0;
  quotesByEvent.forEach((entry, eventExternalId) => {
    const started = Date.parse(entry.event.start_time) <= now.getTime();
    const hasOffered = offeredEvents.has(eventExternalId) && !started;
    if (hasOffered) available += 1;
    else unavailable += 1;
    const payload = {
      id: entry.event.id,
      published: hasOffered,
      odds_status: hasOffered ? 'available' : entry.event.odds_status === 'available' ? 'stale' : 'unavailable',
    };
    if (hasOffered) payload.odds_updated_at = iso;
    eventUpdates.push(payload);
  });
  await writeInChunks(db, 'Event', eventUpdates, 'update');

  return {
    markets: marketRows.size,
    odds: oddRows.size,
    events: consulted.size,
    available,
    unavailable,
    published: offeredEvents.size,
    suspendedMarkets: vanishedMarketIds.length,
    removedOdds: staleOddIds.length,
  };
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  apiBase,
  listSports,
  listEvents,
  listOdds,
  inBatches,
  sportSlug,
  sportName,
  marketGroup,
  marketName,
  selectionLabel,
  selectionCode,
  localDateString,
  localDayRange,
  DEFAULT_REGIONS,
  DEFAULT_MARKETS,
  FEATURED_LEAGUES,
  PRIORITY_MARKETS,
  DEFAULT_HOUSE_MARGIN_PERCENT,
  HOUSE_MARGIN_VERSION,
  applyHouseMargin,
  isBrazilianCompetition,
} from '../../shared/oddsApi.ts';
import { markStartedEventsLive } from '../../shared/matchLifecycle.ts';

const TIME_ZONE = 'America/Bahia';
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 4 * 60 * 1000;
const WINDOW_DAYS = 7;
const ID_CHUNK = 100;
const WRITE_CHUNK = 400;
const DISCOVERY_BATCH = 5;
const ODDS_BATCH = 3;
const ALERT_LEVELS = [70, 85, 95];

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sortFor(marketKey) {
  if (marketKey === 'h2h') return 1;
  if (marketKey === 'spreads') return 2;
  if (marketKey === 'totals') return 3;
  return 9;
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

async function upsertCatalog(db, sports, now) {
  const iso = now.toISOString();
  const groups = new Map();
  sports.forEach((sport) => {
    const slug = sportSlug(sport.group);
    const entry = groups.get(slug) || { slug, name: sportName(slug, sport.group), total: 0, inSeason: 0 };
    entry.total += 1;
    if (sport.active) entry.inSeason += 1;
    groups.set(slug, entry);
  });

  const existingSports = await db.Sport.list({ limit: 200 });
  const sportsBySlug = new Map((existingSports.items || []).map((row) => [row.slug, row]));
  const sportCreates = [];
  const sportUpdates = [];
  for (const entry of groups.values()) {
    const payload = {
      name: entry.name,
      slug: entry.slug,
      external_id: entry.slug,
      in_season: entry.inSeason > 0,
      active: true,
      event_count: entry.total,
      last_catalog_at: iso,
    };
    const existing = sportsBySlug.get(entry.slug);
    if (existing) sportUpdates.push({ id: existing.id, ...payload });
    else sportCreates.push({ ...payload, markets_available: [] });
  }
  await writeInChunks(db, 'Sport', sportCreates, 'create');
  await writeInChunks(db, 'Sport', sportUpdates, 'update');

  const activeSports = sports.filter((sport) => sport.active);
  const existingCompetitions = await db.Competition.list({ limit: 500 });
  const competitionsByKey = new Map(
    (existingCompetitions.items || []).filter((row) => row.external_id).map((row) => [row.external_id, row]),
  );
  const competitionCreates = [];
  const competitionUpdates = [];
  for (const sport of activeSports) {
    const payload = {
      name: sport.title || sport.description || sport.key,
      slug: sport.key,
      sport_slug: sportSlug(sport.group),
      active: true,
      external_id: sport.key,
      last_sync_at: iso,
    };
    const existing = competitionsByKey.get(sport.key);
    if (existing) competitionUpdates.push({ id: existing.id, ...payload });
    else competitionCreates.push(payload);
  }
  await writeInChunks(db, 'Competition', competitionCreates, 'create');
  await writeInChunks(db, 'Competition', competitionUpdates, 'update');

  return {
    groups: groups.size,
    keys: sports.length,
    activeKeys: activeSports.length,
    competitionsCreated: competitionCreates.length,
  };
}

async function runSync({ db, settings, apiKey, mode, now, force }) {
  const startedMs = Date.now();
  const base = apiBase(settings);
  const regions = (settings.regions || []).filter(Boolean);
  const markets = (settings.markets || []).filter(Boolean);
  const activeRegions = regions.length ? regions : DEFAULT_REGIONS;
  const activeMarkets = markets.length ? markets : DEFAULT_MARKETS;
  const enabledSlugs = (settings.sports || []).filter(Boolean);
  const maxSports = Math.max(1, num(settings.max_sports_per_run, 10));
  const maxBookmakers = Math.max(1, num(settings.max_bookmakers, 8));
  const budget = Math.max(0, num(settings.budget_credits, 0));
  const dailyLimit = Math.max(0, num(settings.daily_request_limit, 0));
  const houseMargin = num(settings.house_margin_percent, DEFAULT_HOUSE_MARGIN_PERCENT);
  const marginVersion = settings.house_margin_version || HOUSE_MARGIN_VERSION;

  const today = localDateString(now, TIME_ZONE);
  const sameDay = settings.credits_today_date === today;
  const spentPeriod = Math.max(0, num(settings.credits_used, 0));
  const spentToday = sameDay ? Math.max(0, num(settings.credits_today, 0)) : 0;

  const usage = { used: null, remaining: null, cost: 0, calls: 0 };
  const track = (result) => {
    const info = result?.usage;
    if (!info) return;
    if (info.used !== null && info.used !== undefined) usage.used = info.used;
    if (info.remaining !== null && info.remaining !== undefined) usage.remaining = info.remaining;
    if (info.last !== null && info.last !== undefined) {
      usage.cost += Number(info.last) || 0;
      usage.calls += 1;
    }
  };

  const catalogAge = settings.catalog_sync_at ? now.getTime() - new Date(settings.catalog_sync_at).getTime() : Infinity;
  const needsCatalog = mode === 'catalog' || catalogAge > CATALOG_TTL_MS;

  let catalog = { groups: 0, keys: 0, activeKeys: 0, competitionsCreated: 0 };
  if (needsCatalog) {
    const response = await listSports(apiKey, base);
    track(response);
    catalog = await upsertCatalog(db, response.data || [], now);
  }

  if (mode === 'catalog') {
    return {
      catalog,
      usage,
      selected: [],
      skipped: [],
      failures: [],
      events: 0,
      odds: 0,
      markets: 0,
      bookmakers: 0,
      available: 0,
      unavailable: 0,
      today,
    };
  }

  const refreshSeconds =
    mode === 'today' ? num(settings.refresh_upcoming_seconds, 3600) : num(settings.refresh_finished_seconds, 86400);
  const todayRange = localDayRange(today, TIME_ZONE);
  // Somente partidas que ainda não começaram: a comparação é feita em UTC.
  const windowFrom = now.toISOString();
  const windowTo =
    mode === 'today' ? todayRange.end : new Date(now.getTime() + WINDOW_DAYS * 86400000).toISOString();
  const windowEndMs = Date.parse(windowTo);

  const competitionPage = await db.Competition.filter({ active: true }, { limit: 500 });
  let targets = (competitionPage.items || []).filter((row) => row.external_id && row.sport_slug);
  if (enabledSlugs.length) targets = targets.filter((row) => enabledSlugs.includes(row.sport_slug));

  const discovered = new Map();
  const failures = [];
  const candidates = [];

  const discovery = await inBatches(targets, DISCOVERY_BATCH, async (competition) => {
    const response = await listEvents(apiKey, base, competition.external_id);
    return { competition, events: response.data || [] };
  });
  discovery.forEach((result) => {
    if (result.status === 'rejected') {
      failures.push(String(result.reason?.message || result.reason));
      return;
    }
    const { competition, events } = result.value;
    let count = 0;
    events.forEach((event) => {
      const start = Date.parse(event.commence_time);
      if (!Number.isFinite(start)) return;
      if (start < now.getTime() || start > windowEndMs) return;
      discovered.set(event.id, { api: event, competition });
      count += 1;
    });
    if (count) candidates.push({ competition, count });
  });

  // Prioridade de catálogo: competições brasileiras primeiro; as demais entram
  // apenas enquanto houver orçamento e vagas na execução.
  candidates.sort((a, b) => {
    const aBrazil = isBrazilianCompetition(a.competition.external_id, a.competition.name) ? 1 : 0;
    const bBrazil = isBrazilianCompetition(b.competition.external_id, b.competition.name) ? 1 : 0;
    if (aBrazil !== bBrazil) return bBrazil - aBrazil;
    // Rotação: entre as demais, a liga consultada há mais tempo vem primeiro,
    // para que todas recebam cobertura sem repetir consultas desnecessárias.
    const aLast = a.competition.odds_synced_at ? Date.parse(a.competition.odds_synced_at) : 0;
    const bLast = b.competition.odds_synced_at ? Date.parse(b.competition.odds_synced_at) : 0;
    if (aLast !== bLast) return aLast - bLast;
    return b.count - a.count;
  });

  const budgetReached = budget > 0 && spentPeriod >= budget * 0.95;
  const dailyReached = dailyLimit > 0 && spentToday >= dailyLimit;
  const budgetBlocked = budgetReached || dailyReached;

  const selected = [];
  const skipped = [];
  candidates.forEach((candidate) => {
    const lastRun = candidate.competition.odds_synced_at ? Date.parse(candidate.competition.odds_synced_at) : 0;
    const stillFresh = !force && lastRun && now.getTime() - lastRun < refreshSeconds * 1000;
    if (budgetBlocked || stillFresh || selected.length >= maxSports) {
      skipped.push(candidate.competition.external_id);
      return;
    }
    selected.push(candidate);
  });

  const oddsResults = [];
  if (selected.length) {
    const settled = await inBatches(selected, ODDS_BATCH, async (candidate) => {
      const response = await listOdds(apiKey, base, {
        sportKey: candidate.competition.external_id,
        regions: activeRegions,
        markets: activeMarkets,
        from: windowFrom,
        to: windowTo,
      });
      track(response);
      return { competition: candidate.competition, data: response.data || [] };
    });
    settled.forEach((result) => {
      if (result.status === 'rejected') {
        failures.push(String(result.reason?.message || result.reason));
        return;
      }
      oddsResults.push(result.value);
    });
  }

  oddsResults.forEach(({ competition, data }) => {
    data.forEach((event) => {
      // A resposta de odds também pode trazer partidas já iniciadas: elas nunca
      // entram no catálogo, mesmo que a API ainda as devolva.
      const start = Date.parse(event.commence_time);
      if (!Number.isFinite(start) || start <= now.getTime() || start > windowEndMs) return;
      if (!discovered.has(event.id)) discovered.set(event.id, { api: event, competition });
    });
  });

  const externalIds = [...discovered.keys()];
  const existingEvents = await loadByExternalId(db, 'Event', externalIds);
  const eventCreates = [];
  const eventUpdates = [];
  discovered.forEach((entry, externalId) => {
    const api = entry.api;
    const start = new Date(api.commence_time);
    const localDate = localDateString(start, TIME_ZONE);
    const payload = {
      sport_slug: entry.competition.sport_slug,
      competition_id: entry.competition.id,
      competition_name: entry.competition.name,
      home_team_name: api.home_team,
      away_team_name: api.away_team,
      start_time: start.toISOString(),
      local_date: localDate,
      status: 'scheduled',
      tracking: localDate === today ? 'today' : 'upcoming',
      is_featured: FEATURED_LEAGUES.has(entry.competition.external_id),
      source: 'provider',
      external_id: externalId,
      last_sync_at: now.toISOString(),
      last_checked_at: now.toISOString(),
      next_check_at: new Date(now.getTime() + refreshSeconds * 1000).toISOString(),
    };
    const existing = existingEvents.get(externalId);
    if (existing) eventUpdates.push({ id: existing.id, ...payload });
    else eventCreates.push({ ...payload, discovered_at: now.toISOString(), odds_status: 'unavailable' });
  });
  await writeInChunks(db, 'Event', eventCreates, 'create');
  await writeInChunks(db, 'Event', eventUpdates, 'update');

  const eventRows = await loadByExternalId(db, 'Event', externalIds);

  const observed = new Map();
  const bookmakers = new Set();
  const marketRows = new Map();
  const oddRows = new Map();
  const marketBooks = new Map();
  const universe = new Map();
  const priced = new Map();
  const consulted = new Set();

  const lineKeyOf = (value) => {
    const parsed = value === undefined || value === null ? NaN : Number(value);
    return Number.isFinite(parsed) ? String(parsed) : 'principal';
  };

  const branchFor = (store, eventId, marketKey, lineKey, factory) => {
    if (!store.has(eventId)) store.set(eventId, new Map());
    const byMarket = store.get(eventId);
    if (!byMarket.has(marketKey)) byMarket.set(marketKey, new Map());
    const byLine = byMarket.get(marketKey);
    if (!byLine.has(lineKey)) byLine.set(lineKey, factory());
    return byLine.get(lineKey);
  };
  const groupFor = (store, eventId, marketKey, lineKey) =>
    branchFor(store, eventId, marketKey, lineKey, () => new Map());
  const setFor = (store, eventId, marketKey, lineKey) =>
    branchFor(store, eventId, marketKey, lineKey, () => new Set());

  oddsResults.forEach(({ data }) => {
    data.forEach((apiEvent) => {
      const eventRow = eventRows.get(apiEvent.id);
      if (!eventRow) return;
      consulted.add(apiEvent.id);
      const books = (apiEvent.bookmakers || []).slice(0, maxBookmakers);
      books.forEach((book) => {
        const bookName = book.title || book.key;
        bookmakers.add(bookName);
        (book.markets || []).forEach((market) => {
          if (!activeMarkets.includes(market.key)) return;
          if (!observed.has(eventRow.sport_slug)) observed.set(eventRow.sport_slug, new Set());
          observed.get(eventRow.sport_slug).add(market.key);
          const marketRef = `${apiEvent.id}|${market.key}`;
          if (!marketBooks.has(marketRef)) marketBooks.set(marketRef, new Set());
          marketBooks.get(marketRef).add(bookName);

          (market.outcomes || []).forEach((outcome) => {
            const line = outcome.point === undefined || outcome.point === null ? null : Number(outcome.point);
            const lineKey = lineKeyOf(line);
            const code = selectionCode(market.key, outcome);
            // O universo de resultados possíveis define o que é um mercado completo,
            // inclusive quando alguma casa não devolve preço para uma das seleções.
            setFor(universe, apiEvent.id, market.key, lineKey).add(code);
            const price = Number(outcome.price);
            if (!Number.isFinite(price) || price <= 1) return;
            const group = groupFor(priced, apiEvent.id, market.key, lineKey);
            const current = group.get(code);
            if (current && current.original_value >= price) return;
            group.set(code, {
              code,
              line: Number.isFinite(line) ? line : null,
              label: selectionLabel(market.key, outcome),
              original_value: price,
              bookmaker: bookName,
              source_updated_at: book.last_update || null,
            });
          });
        });
      });
    });
  });

  // Uma cotação por seleção: o melhor preço original entre as casas, com a
  // margem da casa aplicada sobre o conjunto completo do mercado.
  const offeredEvents = new Set();
  eventRows.forEach((eventRow, eventExternalId) => {
    const byMarket = priced.get(eventExternalId);
    if (!byMarket) return;
    byMarket.forEach((byLine, marketKey) => {
      const marketRef = `${eventExternalId}|${marketKey}`;
      const seenLines = universe.get(eventExternalId)?.get(marketKey) || new Map();
      let offeredLines = 0;

      byLine.forEach((group, lineKey) => {
        const seen = seenLines.get(lineKey) || new Set();
        const quotes = [...group.values()];
        // Mercado completo: todos os resultados possíveis observados têm preço válido.
        const complete = seen.size >= 2 && quotes.length === seen.size && [...seen].every((code) => group.has(code));
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
            sort_order: sortFor(marketKey),
            source: 'provider',
            external_id: externalId,
            last_sync_at: now.toISOString(),
            market_ref: marketRef,
          };
          if (quote.line !== null) row.line = quote.line;
          if (quote.source_updated_at) row.source_updated_at = quote.source_updated_at;
          oddRows.set(externalId, row);
        });
      });

      if (!offeredLines && ![...byLine.values()].some((group) => group.size)) return;
      if (offeredLines && PRIORITY_MARKETS.includes(marketKey)) offeredEvents.add(eventExternalId);
      marketRows.set(marketRef, {
        event_id: eventRow.id,
        name: marketName(marketKey, eventRow.sport_slug),
        code: marketKey,
        market_key: marketKey,
        market_group: marketGroup(marketKey),
        status: offeredLines ? 'open' : 'suspended',
        sort_order: sortFor(marketKey),
        is_main: marketKey === 'h2h',
        bookmaker_count: (marketBooks.get(marketRef) || new Set()).size,
        source: 'provider',
        external_id: marketRef,
        last_sync_at: now.toISOString(),
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
  const oddExternalIds = [...oddRows.keys()];
  const existingOdds = await loadByExternalId(db, 'Odd', oddExternalIds);
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
      oddUpdates.push({ id: existing.id, ...payload });
    } else {
      oddCreates.push(payload);
    }
  });
  await writeInChunks(db, 'Odd', oddCreates, 'create');
  await writeInChunks(db, 'Odd', oddUpdates, 'update');

  // Mercados que a fonte deixou de devolver nesta execução deixam de ser
  // oferecidos: o mercado e suas seleções passam a suspenso, sem apagar nada.
  const consultedIds = [...consulted].map((externalId) => eventRows.get(externalId)?.id).filter(Boolean);
  const refreshedRefs = new Set(marketRows.keys());
  const vanishedMarketIds = [];
  for (const ids of chunk(consultedIds, 100)) {
    const page = await db.Market.filter({ event_id: { $in: ids } }, { limit: 500 });
    (page.items || []).forEach((market) => {
      if (refreshedRefs.has(market.external_id)) return;
      if (market.status === 'suspended') return;
      vanishedMarketIds.push(market.id);
    });
  }
  if (vanishedMarketIds.length) {
    for (const ids of chunk(vanishedMarketIds, 100)) {
      await db.Market.updateMany({ id: { $in: ids } }, { $set: { status: 'suspended' } });
    }
  }

  // Cotações não renovadas nesta execução são substituídas: evita duplicar
  // seleções e impede que um preço antigo volte a ser oferecido sem margem.
  const runStartIso = now.toISOString();
  const staleOddIds = [];
  for (const ids of chunk(consultedIds, 100)) {
    let staleCursor = null;
    for (let round = 0; round < 20; round += 1) {
      const page = await db.Odd.filter(
        { event_id: { $in: ids }, last_sync_at: { $lt: runStartIso } },
        { limit: 500, ...(staleCursor ? { cursor: staleCursor } : {}) },
      );
      (page.items || []).forEach((row) => staleOddIds.push(row.id));
      staleCursor = page.next_cursor;
      if (!page.has_more) break;
    }
  }
  for (const ids of chunk(staleOddIds, 200)) {
    await db.Odd.deleteMany({ id: { $in: ids } });
  }

  const eventStatusUpdates = [];
  let available = 0;
  let unavailable = 0;
  eventRows.forEach((row, externalId) => {
    // Liga não consultada nesta execução: o estado anterior é preservado.
    if (!consulted.has(externalId)) return;
    const started = Date.parse(row.start_time) <= now.getTime();
    const hasOffered = offeredEvents.has(externalId) && !started;
    if (hasOffered) available += 1;
    else unavailable += 1;
    const payload = {
      id: row.id,
      published: hasOffered,
      odds_status: hasOffered ? 'available' : row.odds_status === 'available' ? 'stale' : 'unavailable',
    };
    if (hasOffered) payload.odds_updated_at = now.toISOString();
    eventStatusUpdates.push(payload);
  });
  await writeInChunks(db, 'Event', eventStatusUpdates, 'update');

  // Partidas iniciadas saem do catálogo de apostas e passam a "ao vivo" pelo
  // horário previsto. O resultado é confirmado depois, pela rotina de liquidação,
  // sem que a sincronização de odds consulte nada durante a partida.
  await markStartedEventsLive(db, now.toISOString());

  if (selected.length) {
    await writeInChunks(
      db,
      'Competition',
      selected.map((candidate) => ({ id: candidate.competition.id, odds_synced_at: now.toISOString() })),
      'update',
    );
  }

  const sportRows = await db.Sport.list({ limit: 200 });
  const sportUpdates = [];
  (sportRows.items || []).forEach((row) => {
    const set = observed.get(row.slug);
    if (!set || !set.size) return;
    sportUpdates.push({
      id: row.id,
      markets_available: [...set],
      odds_available: true,
      in_season: true,
      last_catalog_at: row.last_catalog_at || now.toISOString(),
    });
  });
  await writeInChunks(db, 'Sport', sportUpdates, 'update');

  const usedNow = usage.used !== null ? usage.used : spentPeriod + usage.cost;
  const creditsToday = spentToday + usage.cost;

  return {
    catalog,
    usage,
    selected: selected.map((candidate) => candidate.competition.external_id),
    skipped,
    failures,
    events: discovered.size,
    odds: oddRows.size,
    markets: marketRows.size,
    bookmakers: bookmakers.size,
    available,
    unavailable,
    published: offeredEvents.size,
    margin_percent: houseMargin,
    today,
    usedNow,
    creditsToday,
    budgetBlocked,
    elapsedMs: Date.now() - startedMs,
  };
}

export default async function (req) {
  let base44;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const mode = ['today', 'upcoming', 'catalog'].includes(body?.mode) ? body.mode : 'today';
    const trigger = ['scheduled', 'manual'].includes(body?.trigger) ? body.trigger : 'manual';
    const force = Boolean(body?.force);

    const apiKey = secrets.get('THE_ODDS_API_KEY');
    if (!apiKey) return Response.json({ error: 'THE_ODDS_API_KEY não configurada' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const page = await db.ProviderSettings.list({ limit: 1 });
    const settings = page.items?.[0];
    if (!settings) return Response.json({ skipped: true, reason: 'Configuração do provedor não encontrada' });
    if (!settings.enabled) return Response.json({ skipped: true, reason: 'Integração desabilitada' });
    if (settings.provider !== 'the_odds_api') {
      return Response.json({ skipped: true, reason: 'Provedor ativo não é a The Odds API' });
    }

    const now = new Date();
    if (settings.locked_until && Date.parse(settings.locked_until) > now.getTime()) {
      return Response.json({ skipped: true, reason: 'Outra execução está em andamento' });
    }
    await db.ProviderSettings.update(settings.id, {
      locked_until: new Date(now.getTime() + LOCK_MS).toISOString(),
      lock_owner: `${mode}:${trigger}`,
    });

    const job = await db.SyncJob.create({
      provider: settings.provider,
      trigger,
      job_type: mode === 'catalog' ? 'catalog' : mode === 'today' ? 'odds' : 'events',
      status: 'running',
      started_at: now.toISOString(),
      triggered_by: user.email,
    });

    let result;
    try {
      result = await runSync({ db, settings, apiKey, mode, now, force });
    } catch (error) {
      await db.SyncJob.update(job.id, {
        status: 'error',
        finished_at: new Date().toISOString(),
        error_message: String(error?.message || error).slice(0, 400),
      });
      await db.ProviderSettings.update(settings.id, {
        locked_until: null,
        lock_owner: '',
        last_status: 'error',
        last_error: String(error?.message || error).slice(0, 400),
      });
      return Response.json({ error: String(error?.message || error) }, { status: 502 });
    }

    const alertPercent = num(settings.budget_credits, 0) > 0 ? (result.usedNow / num(settings.budget_credits, 0)) * 100 : 0;
    const level = ALERT_LEVELS.filter((threshold) => alertPercent >= threshold).pop() || 0;
    const previousLevel = num(settings.alert_level, 0);

    const summary = [
      `modo ${mode}`,
      `${result.events} evento(s)`,
      `${result.odds} cotação(ões)`,
      `${result.published} publicado(s)`,
      `${result.selected.length} liga(s) consultada(s)`,
      `${result.skipped.length} adiada(s)`,
      `margem ${result.margin_percent}%`,
      `custo observado ${result.usage.cost}`,
    ].join(' · ');

    const patch = {
      locked_until: null,
      lock_owner: '',
      credits_used: result.usedNow,
      credits_last: result.usage.cost,
      credits_today: result.creditsToday,
      credits_today_date: result.today,
      credits_period_start: settings.credits_period_start || now.toISOString(),
      catalog_sync_at: result.catalog.keys ? now.toISOString() : settings.catalog_sync_at,
      today_sync_at: mode === 'today' ? now.toISOString() : settings.today_sync_at,
      upcoming_sync_at: mode === 'upcoming' ? now.toISOString() : settings.upcoming_sync_at,
      next_today_run_at:
        mode === 'today'
          ? new Date(now.getTime() + num(settings.refresh_upcoming_seconds, 3600) * 1000).toISOString()
          : settings.next_today_run_at,
      next_upcoming_run_at:
        mode === 'upcoming'
          ? new Date(now.getTime() + num(settings.refresh_finished_seconds, 86400) * 1000).toISOString()
          : settings.next_upcoming_run_at,
      skipped_queries: num(settings.skipped_queries, 0) + result.skipped.length,
      skipped_reason: result.budgetBlocked
        ? 'Consultas suspensas: limite de consumo atingido'
        : result.skipped.length
          ? `${result.skipped.length} liga(s) adiada(s) nesta execução`
          : '',
      alert_level: level,
      last_sync_at: now.toISOString(),
      last_status: result.failures.length ? 'partial' : 'success',
      last_error: result.failures.length ? result.failures[0].slice(0, 400) : '',
      last_run_summary: summary,
      credentials_configured: true,
    };
    if (result.usage.remaining !== null) patch.credits_remaining = result.usage.remaining;
    await db.ProviderSettings.update(settings.id, patch);

    await db.SyncJob.update(job.id, {
      status: result.failures.length && !result.odds ? 'error' : 'success',
      finished_at: new Date().toISOString(),
      requests_used: result.usage.cost,
      records_upserted: result.odds,
      error_message: result.failures.length ? result.failures.join(' | ').slice(0, 400) : '',
    });

    await db.ApiUsageLog.create({
      provider: settings.provider,
      endpoint: `/sports/{key}/odds · ${result.selected.length} liga(s)`,
      status_code: 200,
      duration_ms: result.elapsedMs,
      records_returned: result.odds,
      cache_hit: result.usage.calls === 0,
      credits_used: result.usage.cost,
      params: `regiões=${(settings.regions || DEFAULT_REGIONS).join(',')} mercados=${(settings.markets || DEFAULT_MARKETS).join(',')}`,
      note: summary.slice(0, 240),
    });

    if (level > previousLevel) {
      await db.AdminAuditLog.create({
        actor_email: user.email,
        action: 'provider.budget_alert',
        target_type: 'ProviderSettings',
        target_id: settings.id,
        details: `Consumo em ${alertPercent.toFixed(1)}% do orçamento configurado`,
        severity: level >= 95 ? 'critical' : 'warning',
      });
    }

    return Response.json({ ok: true, mode, trigger, ...result });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
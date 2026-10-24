import { base44 } from "@/api/base44Client";
import { OTHERS_SLUGS } from "@/lib/sports";

export const MAX_CARD_ODDS = 3;

export function buildEventFilter({ sportSlug, competitionId, dayRange, status, search, featured, country, from } = {}) {
  const filter = {};
  if (sportSlug === "outros") filter.sport_slug = { $in: OTHERS_SLUGS };
  else if (sportSlug) filter.sport_slug = sportSlug;
  if (competitionId) filter.competition_id = competitionId;
  if (country) filter.country = country;
  if (status) filter.status = status;
  if (featured) filter.is_featured = true;
  if (dayRange) filter.start_time = { $gte: dayRange.start, $lte: dayRange.end };
  // Partidas ao vivo já começaram e não recebem mais apostas: ficam fora do
  // catálogo publicável, mas continuam listadas enquanto a fonte não confirma o resultado.
  if (status === "live") {
    filter.start_time = { $lte: new Date().toISOString() };
    const liveTerm = (search || "").trim();
    if (liveTerm) {
      filter.$or = [
        { home_team_name: { $regex: liveTerm, $options: "i" } },
        { away_team_name: { $regex: liveTerm, $options: "i" } },
        { competition_name: { $regex: liveTerm, $options: "i" } },
      ];
    }
    return filter;
  }
  // Nenhuma listagem exibe partidas que já começaram: a comparação é feita em
  // UTC e a exibição converte para America/Bahia.
  filter.start_time = { ...(filter.start_time || {}), $gte: from || new Date().toISOString() };
  // Catálogo público: apenas partidas com cotação efetivamente oferecida pelo
  // sistema. Quem perdeu as odds ou já começou sai da listagem para apostar.
  filter.published = true;
  const term = (search || "").trim();
  if (term) {
    filter.$or = [
      { home_team_name: { $regex: term, $options: "i" } },
      { away_team_name: { $regex: term, $options: "i" } },
      { competition_name: { $regex: term, $options: "i" } },
    ];
  }
  return filter;
}

export function eventLabel(event) {
  return `${event.home_team_name} x ${event.away_team_name}`;
}

export function decorateOdd(odd, event) {
  if (!event) return odd;
  return {
    ...odd,
    event_label: eventLabel(event),
    competition_name: event.competition_name,
    sport_slug: event.sport_slug,
    event_start_time: event.start_time,
    event_status: event.status,
  };
}

export function decorateOdds(odds, event) {
  return odds.map((odd) => decorateOdd(odd, event));
}

/**
 * A mesma seleção pode chegar de várias casas de apostas. Mantém a melhor
 * cotação disponível por seleção, para não repetir o mesmo botão no cartão.
 */
export function bestBySelection(odds) {
  const byCode = new Map();
  odds.forEach((odd) => {
    const key = odd.code || odd.id;
    const current = byCode.get(key);
    if (!current) {
      byCode.set(key, odd);
      return;
    }
    const currentOpen = current.status === "open";
    const nextOpen = odd.status === "open";
    if (nextOpen !== currentOpen) {
      if (nextOpen) byCode.set(key, odd);
      return;
    }
    if (Number(odd.value) > Number(current.value)) byCode.set(key, odd);
  });
  return [...byCode.values()].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

export async function fetchMainOddsForEvents(events) {
  const ids = events.filter(Boolean).map((event) => event.id);
  if (!ids.length) return {};
  const page = await base44.entities.Odd.filter(
    { event_id: { $in: ids }, market_group: "principal" },
    { limit: 500, sort: "sort_order" },
  );
  const byId = new Map(events.map((event) => [event.id, event]));
  const mainByEvent = {};
  (page.items || []).forEach((odd) => {
    const event = byId.get(odd.event_id);
    if (!event) return;
    if (!mainByEvent[odd.event_id]) mainByEvent[odd.event_id] = [];
    mainByEvent[odd.event_id].push(decorateOdd(odd, event));
  });

  const byEvent = {};
  Object.entries(mainByEvent).forEach(([eventId, list]) => {
    const open = list.filter((odd) => odd.status === "open");
    const suspended = list.filter((odd) => odd.status === "suspended");
    const chosen = bestBySelection(open.length ? open : suspended);
    if (chosen.length) byEvent[eventId] = chosen.slice(0, MAX_CARD_ODDS);
  });
  return byEvent;
}

export async function loadEventFeed(filter, { sort = "start_time", limit = 12, cursor } = {}) {
  const page = await base44.entities.Event.filter(filter, { sort, limit, ...(cursor ? { cursor } : {}) });
  const events = page.items || [];
  const oddsByEvent = await fetchMainOddsForEvents(events);
  return {
    events,
    oddsByEvent,
    nextCursor: page.next_cursor,
    hasMore: Boolean(page.has_more),
  };
}
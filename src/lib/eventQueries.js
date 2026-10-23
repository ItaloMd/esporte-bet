import { base44 } from "@/api/base44Client";
import { OTHERS_SLUGS } from "@/lib/sports";

export const MAX_CARD_ODDS = 3;

export function buildEventFilter({ sportSlug, competitionId, dayRange, status, search, featured, country } = {}) {
  const filter = {};
  if (sportSlug === "outros") filter.sport_slug = { $in: OTHERS_SLUGS };
  else if (sportSlug) filter.sport_slug = sportSlug;
  if (competitionId) filter.competition_id = competitionId;
  if (country) filter.country = country;
  if (status) filter.status = status;
  if (featured) filter.is_featured = true;
  if (dayRange) filter.start_time = { $gte: dayRange.start, $lte: dayRange.end };
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

export async function fetchMainOddsForEvents(events) {
  const ids = events.filter(Boolean).map((event) => event.id);
  if (!ids.length) return {};
  const page = await base44.entities.Odd.filter(
    { event_id: { $in: ids } },
    { limit: 400, sort: "sort_order" },
  );
  const byId = new Map(events.map((event) => [event.id, event]));
  const mainByEvent = {};
  (page.items || []).forEach((odd) => {
    if (odd.market_group !== "principal") return;
    const event = byId.get(odd.event_id);
    if (!event) return;
    if (!mainByEvent[odd.event_id]) mainByEvent[odd.event_id] = [];
    mainByEvent[odd.event_id].push(decorateOdd(odd, event));
  });

  const byEvent = {};
  Object.entries(mainByEvent).forEach(([eventId, list]) => {
    const open = list.filter((odd) => odd.status === "open");
    const suspended = list.filter((odd) => odd.status === "suspended");
    const chosen = open.length ? open : suspended;
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
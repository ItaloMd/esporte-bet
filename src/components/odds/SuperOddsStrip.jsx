import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import TeamCrest from "@/components/sports/TeamCrest";
import OddsButton from "@/components/odds/OddsButton";
import { decorateOdd } from "@/lib/eventQueries";
import { formatDay, formatTime } from "@/lib/format";

function boostPercent(odd) {
  const base = Number(odd.value) || 0;
  const boosted = Number(odd.super_odd_value) || 0;
  if (!base || !boosted || boosted <= base) return null;
  return Math.round((boosted / base - 1) * 100);
}

/**
 * Faixa de super odds: as cotações turbinadas do dia, no topo da página,
 * com a partida e a seleção prontas para entrar no bilhete.
 */
export default function SuperOddsStrip() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = await base44.entities.Odd.filter(
          { is_super_odd: true, status: "open" },
          { limit: 8, sort: "-super_odd_at" },
        );
        const odds = page.items || [];
        const ids = [...new Set(odds.map((odd) => odd.event_id).filter(Boolean))];
        if (!ids.length) return;
        const eventPage = await base44.entities.Event.filter({ id: { $in: ids } }, { limit: ids.length });
        const byId = new Map((eventPage.items || []).map((event) => [event.id, event]));
        const now = Date.now();
        const next = odds
          .map((odd) => {
            const event = byId.get(odd.event_id);
            if (!event || event.status !== "scheduled") return null;
            if (Date.parse(event.start_time || "") < now) return null;
            return { odd, event };
          })
          .filter(Boolean);
        if (alive) setCards(next);
      } catch {
        if (alive) setCards([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return <div className="h-[104px] animate-pulse rounded-lg border border-border bg-card" />;
  }
  if (!cards.length) return null;

  return (
    <section aria-label="Super odds do dia">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" /> Super odds
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Turbinadas do dia</span>
      </div>
      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
        {cards.map(({ odd, event }) => {
          const boost = boostPercent(odd);
          return (
            <article key={odd.id} className="w-[268px] shrink-0 rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  <Flame className="h-3 w-3" aria-hidden="true" />
                  Super odd{boost ? ` +${boost}%` : ""}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {formatDay(event.start_time)} · {formatTime(event.start_time)}
                </span>
              </div>

              <Link to={`/partida/${event.id}`} className="mt-2 block space-y-1">
                <div className="flex items-center gap-1.5">
                  <TeamCrest name={event.home_team_name} crest={event.home_team_crest} className="h-4 w-4" />
                  <span className="truncate text-xs font-medium">{event.home_team_name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TeamCrest name={event.away_team_name} crest={event.away_team_crest} className="h-4 w-4" />
                  <span className="truncate text-xs font-medium">{event.away_team_name}</span>
                </div>
              </Link>

              <div className="mt-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {odd.market_name}: {odd.label}
                </p>
                <div className="w-[76px] shrink-0">
                  <OddsButton odd={decorateOdd({ ...odd, value: odd.super_odd_value ?? odd.value }, event)} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
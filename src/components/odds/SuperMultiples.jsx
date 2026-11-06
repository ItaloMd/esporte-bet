import React, { useEffect, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useSlip } from "@/lib/SlipProvider";
import { formatOdds } from "@/lib/format";
import { boostedOdd, legBoostFactor, parseSelections, boostedLegValue } from "@/lib/superMultiples";

/**
 * Super múltiplas publicadas: combinações montadas no painel, com as cotações
 * vigentes lidas na hora. A múltipla some se alguma seleção fechar ou a partida
 * começar, para nunca oferecer um combo que não pode ser pago.
 */
export default function SuperMultiples() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const { selections, addSelection } = useSlip();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = await base44.entities.SuperMultiple.filter({ status: "published" }, { limit: 6, sort: "sort_order" });
        const rows = page.items || [];
        const groups = rows.map((row) => parseSelections(row.selections));
        const flat = groups.flat();
        const oddIds = [...new Set(flat.map((leg) => leg.odd_id).filter(Boolean))];
        const eventIds = [...new Set(flat.map((leg) => leg.event_id).filter(Boolean))];
        if (!oddIds.length) {
          if (alive) setCards([]);
          return;
        }
        const [oddPage, eventPage] = await Promise.all([
          base44.entities.Odd.filter({ id: { $in: oddIds } }, { limit: oddIds.length }),
          base44.entities.Event.filter({ id: { $in: eventIds } }, { limit: eventIds.length }),
        ]);
        const oddsById = new Map((oddPage.items || []).map((odd) => [odd.id, odd]));
        const eventsById = new Map((eventPage.items || []).map((event) => [event.id, event]));
        const now = Date.now();
        const next = rows
          .map((row, index) => {
            const legs = groups[index].map((leg) => {
              const odd = oddsById.get(leg.odd_id);
              const event = eventsById.get(leg.event_id);
              if (!odd || odd.status !== "open") return null;
              if (!event || event.status !== "scheduled" || Date.parse(event.start_time || "") < now) return null;
              return { leg, odd, event, value: Number(odd.value) || 0 };
            });
            if (legs.length < 2 || legs.some((item) => !item)) return null;
            const base = legs.reduce((acc, item) => acc * item.value, 1);
            return { multiple: row, legs, total: boostedOdd(base, row.boost_percent) };
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
    return <div className="h-[188px] animate-pulse rounded-lg border border-border bg-card" />;
  }
  if (!cards.length) return null;

  const picked = new Set(selections.map((item) => item.odd_id));

  const addAll = (card, factor) => {
    card.legs.forEach((item) => {
      addSelection({
        event_id: item.event.id,
        event_label: `${item.event.home_team_name} x ${item.event.away_team_name}`,
        competition_name: item.event.competition_name,
        sport_slug: item.event.sport_slug,
        event_start_time: item.event.start_time,
        market_id: item.odd.market_id,
        market_name: item.odd.market_name,
        odd_id: item.odd.id,
        odd_label: item.odd.label,
        odd_value: boostedLegValue(item.value, factor),
        status: item.odd.status,
      });
    });
  };

  return (
    <section aria-label="Super múltiplas">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide">
          <Layers className="h-4 w-4 text-primary" aria-hidden="true" /> Super múltiplas
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Turbinadas</span>
      </div>
      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
        {cards.map(({ multiple, legs, total }) => {
          const boost = Number(multiple.boost_percent) || 0;
          const factor = legBoostFactor(boost, legs.length);
          const allPicked = legs.every((item) => picked.has(item.odd.id));
          return (
            <article key={multiple.id} className="flex w-[300px] shrink-0 flex-col rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  <Layers className="h-3 w-3" aria-hidden="true" />
                  Super múltipla{boost ? ` +${boost}%` : ""}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {legs.length} seleções
                </span>
              </div>

              <h3 className="mt-1.5 truncate text-sm font-bold">{multiple.title}</h3>
              {multiple.subtitle && (
                <p className="truncate text-[11px] text-muted-foreground">{multiple.subtitle}</p>
              )}

              <ul className="mt-1.5 flex-1 space-y-1">
                {legs.map((item) => (
                  <li key={item.odd.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                      <span className="text-foreground">
                        {item.event.home_team_name} x {item.event.away_team_name}
                      </span>{" "}
                      · {item.odd.label}
                    </span>
                    <span className="score-num shrink-0 text-[11px] text-muted-foreground">
                      {formatOdds(item.value)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-2 flex items-end justify-between gap-2 border-t border-border pt-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Odd total</p>
                  <p className="score-num text-lg font-bold leading-none text-primary">{formatOdds(total)}</p>
                </div>
                <Button size="sm" onClick={() => addAll({ legs }, factor)} disabled={allPicked}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {allPicked ? "No bilhete" : "Adicionar"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
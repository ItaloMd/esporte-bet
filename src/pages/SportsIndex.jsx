import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import SportIcon from "@/components/sports/SportIcon";
import { SPORTS } from "@/lib/sports";
import { formatNumber } from "@/lib/format";

export default function SportsIndex() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    base44.entities.Event.aggregate({ query: { status: "scheduled" }, groupBy: "sport_slug" })
      .then((result) => {
        if (!active) return;
        const map = {};
        (result.rows || []).forEach((row) => {
          map[row.sport_slug] = row.count;
        });
        setCounts(map);
        setLoading(false);
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const others = SPORTS.filter((sport) => ["futebol-americano", "mma", "automobilismo"].includes(sport.slug));
  const othersCount = others.reduce((acc, sport) => acc + (counts[sport.slug] || 0), 0);

  const items = [
    ...SPORTS.filter((sport) => !others.some((other) => other.slug === sport.slug)),
    { slug: "outros", name: "Outros esportes", count: othersCount },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Esportes</h1>
        <p className="text-xs text-muted-foreground">Escolha um esporte para ver os eventos disponíveis</p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((sport) => (
          <Link
            key={sport.slug}
            to={`/esporte/${sport.slug}`}
            className="card-surface flex items-center gap-3 px-4 py-3 transition-colors hover:border-primary/50"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-secondary/60">
              <SportIcon slug={sport.slug} className="h-4 w-4 text-primary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{sport.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {loading ? "Carregando eventos…" : `${formatNumber(sport.count || counts[sport.slug] || 0)} eventos agendados`}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
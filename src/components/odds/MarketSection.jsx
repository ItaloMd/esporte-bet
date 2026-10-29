import React from "react";
import { Clock } from "lucide-react";
import OddsButton from "@/components/odds/OddsButton";
import { timeAgo } from "@/lib/format";
import { orderMarketOdds } from "@/lib/eventQueries";

const OVER_UNDER_CODE = /^(over|under)_/;

/**
 * Grade de um mercado: seleções suspensas não são exibidas (o botão desabilitado
 * já impede a seleção), e o mercado some quando nada resta aberto. Mercados de
 * linha usam duas colunas — Mais à esquerda, Menos à direita.
 */
export default function MarketSection({ market, odds = [] }) {
  const ordered = orderMarketOdds(market, odds);
  if (!ordered.length) return null;

  const suspended = market.status !== "open";
  const pairGrid = ordered.every((odd) => OVER_UNDER_CODE.test(String(odd.code || "")));

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{market.name}</h3>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {market.code || market.id}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {suspended && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
              {market.status === "suspended" ? "Suspenso" : "Encerrado"}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {timeAgo(market.last_sync_at)}
          </span>
        </div>
      </div>
      <div className={`grid gap-2 px-3.5 py-3 ${pairGrid ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
        {ordered.map((odd) => (
          <OddsButton key={odd.id} odd={odd} />
        ))}
      </div>
    </section>
  );
}
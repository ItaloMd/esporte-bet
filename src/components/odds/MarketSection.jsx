import React from "react";
import { Clock } from "lucide-react";
import OddsButton from "@/components/odds/OddsButton";
import { timeAgo } from "@/lib/format";

export default function MarketSection({ market, odds }) {
  const suspended = market.status !== "open";
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
      <div className="flex flex-wrap gap-2 px-3.5 py-3">
        {odds.length ? (
          odds.map((odd) => (
            <div key={odd.id} className="min-w-[6.5rem] flex-1">
              <OddsButton odd={odd} />
              {odd.status !== "open" && (
                <p className="mt-1 text-center text-[10px] text-amber-400">
                  {odd.status === "suspended" ? "Odd suspensa" : "Odd encerrada"}
                </p>
              )}
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma seleção retornada pela fonte para este mercado.</p>
        )}
      </div>
    </section>
  );
}
import React from "react";
import { X } from "lucide-react";
import { formatOdds } from "@/lib/format";

/** Seleções já incluídas na múltipla em montagem. */
export default function DraftList({ legs = [], onRemove }) {
  if (!legs.length) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        Nenhuma seleção incluída. Busque um jogo e inclua pelo menos duas.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {legs.map((leg, index) => (
        <li key={leg.odd_id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
          <span className="w-4 shrink-0 text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{leg.event_label}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {leg.market_name}: {leg.label}
            </p>
          </div>
          <span className="score-num shrink-0 text-xs">{formatOdds(leg.odd_value)}</span>
          <button
            type="button"
            onClick={() => onRemove(leg.odd_id)}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
            aria-label={`Remover ${leg.label}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
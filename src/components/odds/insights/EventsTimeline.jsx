import React from "react";

const EVENT_META = {
  Goal: { label: "Gol", className: "bg-primary/15 text-primary" },
  Card: { label: "Cartão", className: "bg-amber-500/15 text-amber-400" },
  subst: { label: "Substituição", className: "bg-secondary text-secondary-foreground" },
  Var: { label: "VAR", className: "bg-destructive/15 text-destructive" },
};

/** Linha do tempo dos eventos: gols, cartões, substituições e VAR. */
export default function EventsTimeline({ items }) {
  if (!items || !items.length) return null;
  return (
    <section className="card-surface overflow-hidden">
      <h2 className="border-b border-border px-3.5 py-2.5 text-sm font-semibold">Eventos da partida</h2>
      <ul className="divide-y divide-border/40">
        {items.map((item, index) => {
          const meta = EVENT_META[item.type] || { label: item.type, className: "bg-secondary text-secondary-foreground" };
          return (
            <li key={`${item.minute}-${index}`} className="flex items-center gap-3 px-3.5 py-2">
              <span className="score-num w-10 shrink-0 text-sm font-semibold text-muted-foreground">
                {item.minute ?? "—"}'
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${meta.className}`}>
                {meta.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">
                <span className="font-medium">{item.team}</span>
                {item.player ? ` · ${item.player}` : ""}
                {item.detail ? ` · ${item.detail}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
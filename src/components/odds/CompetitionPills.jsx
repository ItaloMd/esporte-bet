import React from "react";
import { flagFor } from "@/lib/flags";
import { formatNumber } from "@/lib/format";

/**
 * Faixa de competições presentes na base, no formato de pílulas com a
 * quantidade de jogos — clicar filtra a lista principal.
 */
export default function CompetitionPills({ competitions = [], value, onChange, loading }) {
  if (loading) {
    return <div className="h-8 w-2/3 animate-pulse rounded-md bg-secondary" />;
  }
  if (!competitions.length) {
    return (
      <p className="text-xs text-muted-foreground">
        As competições aparecem aqui conforme os jogos são importados.
      </p>
    );
  }

  const total = competitions.reduce((sum, item) => sum + item.count, 0);
  const base = "shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors";
  const on = "border-primary bg-primary text-primary-foreground";
  const off = "border-border bg-secondary/40 text-muted-foreground hover:border-primary/50 hover:text-foreground";

  return (
    <div className="hide-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5">
      <button type="button" onClick={() => onChange("")} className={`${base} ${value ? off : on}`}>
        Todas <span className="ml-1 opacity-70">{formatNumber(total)}</span>
      </button>
      {competitions.map((competition) => (
        <button
          key={competition.name}
          type="button"
          onClick={() => onChange(competition.name)}
          className={`${base} ${value === competition.name ? on : off}`}
        >
          {flagFor(competition.country) && <span className="mr-1">{flagFor(competition.country)}</span>}
          {competition.name}
          <span className="ml-1 opacity-70">{formatNumber(competition.count)}</span>
        </button>
      ))}
    </div>
  );
}
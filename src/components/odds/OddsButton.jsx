import React from "react";
import { Check, TrendingDown, TrendingUp } from "lucide-react";
import { formatOdds } from "@/lib/format";
import { useSlip } from "@/lib/SlipProvider";

/** Caixa de seleção de odd: rótulo em cima, cotação centralizada e marcadores nos cantos. */
export default function OddsButton({ odd }) {
  const { selections, addSelection, removeSelection } = useSlip();
  const selected = selections.some((item) => item.odd_id === odd.id);
  const disabled = odd.status !== "open";
  const superOdd = Boolean(odd.is_super_odd);

  const handleClick = () => {
    if (disabled) return;
    if (selected) {
      removeSelection(odd.id);
      return;
    }
    addSelection({
      event_id: odd.event_id,
      event_label: odd.event_label,
      competition_name: odd.competition_name,
      sport_slug: odd.sport_slug,
      event_start_time: odd.event_start_time,
      market_id: odd.market_id,
      market_name: odd.market_name,
      odd_id: odd.id,
      odd_label: odd.label,
      odd_value: odd.value,
      status: odd.status,
    });
  };

  return (
    <button
      type="button"
      className="odds-btn"
      data-selected={selected}
      data-super={superOdd}
      disabled={disabled}
      onClick={handleClick}
      title={
        disabled
          ? "Odd indisponível"
          : superOdd
            ? `Super odd — ${odd.market_name}: ${odd.label}`
            : `${odd.market_name} — ${odd.label}`
      }
      aria-pressed={selected}
    >
      {selected && (
        <Check
          className={`absolute left-1 top-1 h-3 w-3 ${superOdd ? "text-primary-foreground" : "text-primary"}`}
          aria-hidden="true"
        />
      )}
      {odd.movement === "up" && (
        <TrendingUp className={`absolute right-1 top-1 h-3 w-3 ${superOdd ? "text-primary-foreground/80" : "text-primary/80"}`} aria-hidden="true" />
      )}
      {odd.movement === "down" && (
        <TrendingDown className="absolute right-1 top-1 h-3 w-3 text-destructive/80" aria-hidden="true" />
      )}

      <span
        className={`w-full truncate text-[10px] font-medium uppercase tracking-wide ${
          superOdd ? "text-primary-foreground/80" : "text-muted-foreground"
        }`}
      >
        {superOdd ? `Super · ${odd.label}` : odd.label}
      </span>
      <span className="score-num text-[15px] font-semibold leading-none">{formatOdds(odd.value)}</span>
    </button>
  );
}
import React from "react";
import { Check, TrendingDown, TrendingUp } from "lucide-react";
import { formatOdds } from "@/lib/format";
import { useSlip } from "@/lib/SlipProvider";

export default function OddsButton({ odd }) {
  const { selections, addSelection, removeSelection } = useSlip();
  const selected = selections.some((item) => item.odd_id === odd.id);
  const disabled = odd.status !== "open";

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
      disabled={disabled}
      onClick={handleClick}
      title={disabled ? "Odd indisponível" : `${odd.market_name} — ${odd.label}`}
      aria-pressed={selected}
    >
      <span className="line-clamp-1 text-[11px] font-normal text-muted-foreground">{odd.label}</span>
      <span className="flex items-center gap-1 score-num text-[15px]">
        {selected && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
        {formatOdds(odd.value)}
        {odd.movement === "up" && <TrendingUp className="h-3 w-3 text-primary/80" aria-hidden="true" />}
        {odd.movement === "down" && <TrendingDown className="h-3 w-3 text-destructive/80" aria-hidden="true" />}
      </span>
    </button>
  );
}
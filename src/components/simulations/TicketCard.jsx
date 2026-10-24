import React, { useState } from "react";
import { formatCurrency, formatDateTime, formatOdds } from "@/lib/format";
import CashoutButton from "@/components/simulations/CashoutButton";

const STATUS_LABEL = {
  open: "Em aberto",
  won: "Ganha",
  lost: "Perdida",
  void: "Anulada",
  partial: "Parcial",
  cashed_out: "Cashout realizado",
};

const CASHOUT_LEAD_MS = 10 * 60 * 1000;

export function cashoutAvailable(selections) {
  if (!selections.length) return false;
  const now = Date.now();
  return selections.every((selection) => {
    const start = Date.parse(selection.event_start_time);
    return Number.isFinite(start) && now < start - CASHOUT_LEAD_MS;
  });
}

export default function TicketCard({ ticket, selections, onChanged }) {
  const [open, setOpen] = useState(false);
  const canCashout = cashoutAvailable(selections);

  return (
    <article className="card-surface overflow-hidden">
      <button type="button" className="w-full px-4 py-3 text-left" onClick={() => setOpen((value) => !value)}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {ticket.selection_count} seleç{ticket.selection_count === 1 ? "ão" : "ões"} ·{" "}
              {formatCurrency(ticket.stake_points)}
            </p>
            <p className="text-[11px] text-muted-foreground">Registrada em {formatDateTime(ticket.created_date)}</p>
          </div>
          <div className="text-right">
            <p className="score-num text-lg font-semibold text-primary">{formatOdds(ticket.total_odd)}</p>
            <p className="text-[11px] text-muted-foreground">
              retorno {formatCurrency(ticket.potential_points)}
            </p>
          </div>
        </div>
        <span className="mt-2 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
          {ticket.settlement_state === "review"
            ? "Revisão manual necessária"
            : STATUS_LABEL[ticket.status] || ticket.status}
        </span>
      </button>

      {ticket.status === "open" && (
        <div className="border-t border-border px-4 py-3">
          <CashoutButton ticket={ticket} available={canCashout} onDone={onChanged} />
        </div>
      )}

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {selections.length ? (
            selections.map((selection) => (
              <div key={selection.id} className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{selection.event_label}</p>
                  <p className="truncate text-muted-foreground">
                    {selection.market_name} · {selection.odd_label} · odd registrada{" "}
                    {formatOdds(selection.odd_value)}
                  </p>
                </div>
                <span className="shrink-0 text-muted-foreground">
                  {STATUS_LABEL[selection.status] || selection.status}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Seleções não encontradas.</p>
          )}
        </div>
      )}
    </article>
  );
}
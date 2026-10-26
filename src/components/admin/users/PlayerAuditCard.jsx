import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatCurrency } from "@/lib/format";
import { ISSUE_TEXT } from "@/components/admin/AdminAudit";

/** Auditoria do extrato de um jogador, exibida na gestão de usuários. */
export default function PlayerAuditCard({ userId }) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    base44.functions
      .invoke("auditFinance", { action: "player", user_id: userId })
      .then((res) => active && setRow(res.data?.row || null))
      .catch((err) => active && setError(err?.response?.data?.error || err.message || "Falha na auditoria."));
    return () => {
      active = false;
    };
  }, [userId]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!row) return <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />;

  const clean = row.issues.length === 0;
  return (
    <div className={`card-surface space-y-2 p-3 ${clean ? "" : "border-destructive/40"}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Auditoria do extrato</h3>
        {clean ? (
          <span className="flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> consistente
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {row.issues.length} pendência(s)
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <p className="score-num font-semibold">{formatCurrency(row.credits.valid_sum)}</p>
          <p className="text-[10px] text-muted-foreground">Créditos Liqfy válidos</p>
        </div>
        <div>
          <p className="score-num font-semibold">{formatCurrency(row.bets.staked)}</p>
          <p className="text-[10px] text-muted-foreground">Apostas ({row.bets.count})</p>
        </div>
        <div>
          <p className="score-num font-semibold">{formatCurrency(row.computed_balance)}</p>
          <p className="text-[10px] text-muted-foreground">Saldo pelo extrato</p>
        </div>
        <div>
          <p className="score-num font-semibold">{formatCurrency(row.balance)}</p>
          <p className="text-[10px] text-muted-foreground">Saldo na carteira</p>
        </div>
      </div>
      {row.credits.dup_amount > 0 && (
        <p className="text-[11px] text-destructive">
          {row.credits.dup_count} crédito(s) duplicado(s) no extrato: {formatCurrency(row.credits.dup_amount)} a mais.
        </p>
      )}
      {row.issues
        .filter((issue) => issue !== "credito_duplicado")
        .map((issue) => (
          <p key={issue} className="text-[11px] text-destructive">
            {ISSUE_TEXT[issue] || issue}
          </p>
        ))}
    </div>
  );
}
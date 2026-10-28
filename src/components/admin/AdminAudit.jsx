import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";

export const ISSUE_TEXT = {
  credito_duplicado: "Crédito de depósito duplicado: o mesmo depósito entrou no extrato mais de uma vez.",
  aposta_duplicada: "Aposta duplicada: o mesmo boletim debitou o saldo mais de uma vez.",
  cashout_duplicado: "Cashout duplicado: o mesmo boletim devolveu saldo mais de uma vez.",
  aposta_acima_dos_creditos: "Apostou acima dos créditos recebidos, sem cashout que cubra a diferença.",
  divergencia_saldo: "O saldo da carteira diverge do extrato das movimentações.",
  deposito_sem_credito: "Depósito pago que não gerou crédito no saldo.",
  credito_sem_deposito: "Crédito no saldo sem depósito pago correspondente.",
};

function Stat({ label, value, danger }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${danger ? "border-destructive/50 bg-destructive/10" : "border-border"}`}>
      <p className="score-num text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export default function AdminAudit() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await base44.functions.invoke("auditFinance", { action: "overview" });
    setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar a auditoria.");
      setLoading(false);
    });
  }, [load]);

  if (loading) return <div className="card-surface h-40 animate-pulse" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return null;

  const { rows, summary } = data;

  return (
    <div className="space-y-4">
      <section className="card-surface space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileSearch className="h-4 w-4 text-primary" aria-hidden="true" /> Auditoria financeira
          </h2>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Extrato reconstruído a partir das movimentações reais e comparado com os depósitos pagos e com o saldo de
          cada carteira.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Depósitos pagos" value={formatCurrency(summary.paid_deposits)} />
          <Stat
            label={`Créditos duplicados (${summary.duplicate_credits_count})`}
            value={formatCurrency(summary.duplicate_credits)}
            danger={summary.duplicate_credits > 0}
          />
          <Stat
            label="Exposição: apostas acima dos créditos"
            value={formatCurrency(summary.overstake_exposure)}
            danger={summary.overstake_exposure > 0}
          />
          <Stat
            label="Divergência carteira x extrato"
            value={formatCurrency(summary.mismatch_total)}
            danger={summary.mismatch_total > 0}
          />
          <Stat
            label="Jogadores com pendência"
            value={`${summary.players_with_issues} de ${summary.players}`}
            danger={summary.players_with_issues > 0}
          />
        </div>
        {summary.tx_incomplete && (
          <p className="text-[11px] text-amber-400">
            Há mais movimentações do que o limite da auditoria; os totais abaixo podem estar incompletos.
          </p>
        )}
      </section>

      {rows.map((row) => (
        <section
          key={row.user_id}
          className={`card-surface space-y-2 p-4 ${row.issues.length ? "border-destructive/40" : ""}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{row.email}</p>
            {row.issues.length ? (
              <span className="flex items-center gap-1.5 rounded-full border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {row.issues.length} pendência(s)
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Extrato consistente
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-border px-2.5 py-1.5">
              <p className="score-num font-semibold">{formatCurrency(row.paid_deposits.sum)}</p>
              <p className="text-[10px] text-muted-foreground">Depósitos pagos ({row.paid_deposits.count})</p>
            </div>
            <div className="rounded-lg border border-border px-2.5 py-1.5">
              <p className="score-num font-semibold">{formatCurrency(row.credits.valid_sum)}</p>
              <p className="text-[10px] text-muted-foreground">Créditos válidos no extrato</p>
            </div>
            <div className="rounded-lg border border-border px-2.5 py-1.5">
              <p className="score-num font-semibold">{formatCurrency(row.bets.staked)}</p>
              <p className="text-[10px] text-muted-foreground">Apostas ({row.bets.count})</p>
            </div>
            <div className="rounded-lg border border-border px-2.5 py-1.5">
              <p className="score-num font-semibold">{formatCurrency(row.prizes + row.cashouts.sum)}</p>
              <p className="text-[10px] text-muted-foreground">Prêmios + cashouts</p>
            </div>
            <div className="rounded-lg border border-border px-2.5 py-1.5">
              <p className="score-num font-semibold">{formatCurrency(row.computed_balance)}</p>
              <p className="text-[10px] text-muted-foreground">Saldo calculado pelo extrato</p>
            </div>
            <div className="rounded-lg border border-border px-2.5 py-1.5">
              <p className="score-num font-semibold">{formatCurrency(row.balance)}</p>
              <p className="text-[10px] text-muted-foreground">Saldo na carteira</p>
            </div>
          </div>

          {row.issues.length > 0 && (
            <ul className="space-y-1">
              {row.issues.map((issue) => (
                <li key={issue} className="flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    {ISSUE_TEXT[issue] || issue}
                    {issue === "credito_duplicado" &&
                      ` ${row.credits.dup_count} crédito(s) a mais, ${formatCurrency(row.credits.dup_amount)}.`}
                    {issue === "aposta_acima_dos_creditos" &&
                      ` Apostou ${formatCurrency(row.bets.staked)} tendo ${formatCurrency(row.credits.valid_sum + Math.max(0, row.adjustments))} creditados: ${formatCurrency(row.overstake)} acima.`}
                    {issue === "divergencia_saldo" &&
                      ` Carteira ${formatCurrency(row.balance)} x extrato ${formatCurrency(row.computed_balance)} (diferença de ${formatCurrency(Math.abs(row.mismatch))}).`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {row.open_tickets.count > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {row.open_tickets.count} aposta(s) em aberto, {formatCurrency(row.open_tickets.stake)} de risco em jogo.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
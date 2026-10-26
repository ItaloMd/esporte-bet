import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import PlayerAuditCard from "@/components/admin/users/PlayerAuditCard";

const WITHDRAWAL_LABEL = {
  pending: "Aguardando",
  processing: "Processando",
  completed: "Concluído",
  failed: "Falhou",
  rejected: "Recusado",
};

const TICKET_LABEL = {
  open: "Em aberto",
  won: "Ganhou",
  lost: "Perdeu",
  void: "Anulada",
  partial: "Parcial",
  cashed_out: "Cashout",
};

const DEPOSIT_LABEL = { pending: "Pendente", paid: "Pago", expired: "Expirado", cancelled: "Cancelado" };

function HistoryItem({ title, subtitle, right, rightHint }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-muted-foreground">{subtitle}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="score-num font-semibold">{right}</p>
        {rightHint && <p className="text-[10px] text-muted-foreground">{rightHint}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export default function UserDetail({ row, onAdjusted }) {
  const [history, setHistory] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [deposits, withdrawals, tickets, transactions] = await Promise.all([
      base44.entities.Deposit.filter({ user_id: row.user_id }, { sort: "-created_date", limit: 10 }),
      base44.entities.Withdrawal.filter({ user_id: row.user_id }, { sort: "-created_date", limit: 10 }),
      base44.entities.SimulationTicket.filter({ user_id: row.user_id }, { sort: "-created_date", limit: 10 }),
      base44.entities.WalletTransaction.filter({ user_id: row.user_id }, { sort: "-created_date", limit: 15 }),
    ]);
    setHistory({
      deposits: deposits.items || [],
      withdrawals: withdrawals.items || [],
      tickets: tickets.items || [],
      transactions: transactions.items || [],
    });
  }, [row.user_id]);

  useEffect(() => {
    load().catch((err) => setError(err.message || "Falha ao carregar o histórico."));
  }, [load]);

  const adjust = async (direction) => {
    const value = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await base44.functions.invoke("adminUserOps", {
        action: "adjust_balance",
        user_id: row.user_id,
        amount: direction === "credit" ? value : -value,
        note: note.trim() || undefined,
      });
      setAmount("");
      setNote("");
      toast({ title: "Saldo ajustado" });
      await load();
      onAdjusted?.();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Falha ao ajustar o saldo.");
    } finally {
      setBusy(false);
    }
  };

  if (!history) {
    return (
      <div className="mt-3 space-y-2 border-t border-border pt-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="h-20 animate-pulse rounded-lg bg-secondary/40" />
      </div>
    );
  }

  const wallet = row.wallet || {};

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Saldo disponível</p>
          <p className="score-num text-lg font-semibold">{formatCurrency(wallet.balance)}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Reservado em saques</p>
          <p className="score-num text-lg font-semibold">{formatCurrency(wallet.locked_balance)}</p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Rollover atual</p>
          <p className="score-num text-lg font-semibold">
            {formatCurrency(wallet.rollover_completed)}{" "}
            <span className="text-xs text-muted-foreground">/ {formatCurrency(wallet.rollover_required)}</span>
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Depositado / sacado</p>
          <p className="score-num text-lg font-semibold">
            {formatCurrency(wallet.total_deposited)}{" "}
            <span className="text-xs text-muted-foreground">/ {formatCurrency(wallet.total_withdrawn)}</span>
          </p>
        </div>
      </div>

      <PlayerAuditCard userId={row.user_id} />

      <div className="card-surface space-y-2 p-3">
        <h3 className="text-sm font-semibold">Editar saldo</h3>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <div className="space-y-1">
            <Label htmlFor={`amount-${row.id}`}>Valor (R$)</Label>
            <Input
              id={`amount-${row.id}`}
              type="number"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`note-${row.id}`}>Observação</Label>
            <Input
              id={`note-${row.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Motivo do ajuste"
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={() => adjust("credit")} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Creditar
            </Button>
          </div>
          <div className="flex items-end">
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => adjust("debit")} disabled={busy}>
              <Minus className="h-3.5 w-3.5" /> Debitar
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Depósitos">
          {history.deposits.length ? (
            history.deposits.map((item) => (
              <HistoryItem
                key={item.id}
                title={formatCurrency(item.amount)}
                subtitle={`${formatDateTime(item.created_date)} · ${item.payer_name || "sem pagador"}`}
                right={DEPOSIT_LABEL[item.status] || item.status}
                rightHint={item.status === "paid" ? `taxa ${formatCurrency(item.fee)}` : ""}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum depósito.</p>
          )}
        </Section>

        <Section title="Saques">
          {history.withdrawals.length ? (
            history.withdrawals.map((item) => (
              <HistoryItem
                key={item.id}
                title={formatCurrency(item.amount)}
                subtitle={`${formatDateTime(item.created_date)} · chave ${(item.pix_key_type || "").toUpperCase()}`}
                right={WITHDRAWAL_LABEL[item.status] || item.status}
                rightHint={item.sent_amount > 0 && item.sent_amount < item.amount ? `enviado ${formatCurrency(item.sent_amount)}` : ""}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum saque.</p>
          )}
        </Section>

        <Section title="Apostas">
          {history.tickets.length ? (
            history.tickets.map((item) => (
              <HistoryItem
                key={item.id}
                title={`${formatCurrency(item.stake_points)} · odd ${Number(item.total_odd || 0).toFixed(2)}`}
                subtitle={`${formatDateTime(item.created_date)} · ${item.selection_count || 0} seleção(ões)`}
                right={TICKET_LABEL[item.status] || item.status}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma aposta.</p>
          )}
        </Section>

        <Section title="Movimentações">
          {history.transactions.length ? (
            history.transactions.map((item) => (
              <HistoryItem
                key={item.id}
                title={item.label || item.kind}
                subtitle={formatDateTime(item.created_date)}
                right={`${item.amount > 0 ? "+" : ""}${formatCurrency(item.amount)}`}
                rightHint={`saldo ${formatCurrency(item.balance_after)}`}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma movimentação.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
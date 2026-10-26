import React from "react";
import { formatCurrency, formatDateTime } from "@/lib/format";

const DEPOSIT_LABEL = {
  pending: "Aguardando pagamento",
  paid: "Confirmado",
  expired: "Expirado",
  cancelled: "Cancelado",
};

const WITHDRAWAL_LABEL = {
  pending: "Aguardando liberação",
  processing: "Processando",
  completed: "Enviado",
  failed: "Falhou",
  rejected: "Recusado",
};

function Row({ title, subtitle, value, status }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <div className="text-right">
        <p className="score-num font-semibold">{value}</p>
        <p className="text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}

const TRANSACTION_LABEL = {
  deposit: "Depósito",
  bet: "Aposta",
  cashout: "Cashout",
  prize: "Prêmio",
  adjustment: "Ajuste",
};

export default function WalletHistory({ deposits, withdrawals, transactions = [] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Depósitos recentes</h2>
        {deposits.length ? (
          deposits.map((deposit) => (
            <Row
              key={deposit.id}
              title={formatCurrency(deposit.amount)}
              subtitle={formatDateTime(deposit.created_date)}
              value={`Taxa ${formatCurrency(deposit.fee)}`}
              status={DEPOSIT_LABEL[deposit.status] || deposit.status}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum depósito registrado ainda.</p>
        )}
      </section>

      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Saques solicitados</h2>
        {withdrawals.length ? (
          withdrawals.map((withdrawal) => (
            <Row
              key={withdrawal.id}
              title={formatCurrency(withdrawal.amount)}
              subtitle={`${withdrawal.pix_key_type?.toUpperCase()} · ${withdrawal.pix_key}`}
              value={withdrawal.status === "completed" ? "PIX enviado" : "Reservado"}
              status={WITHDRAWAL_LABEL[withdrawal.status] || withdrawal.status}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum saque solicitado ainda.</p>
        )}
      </section>

      <section className="card-surface space-y-2 p-4 lg:col-span-2">
        <h2 className="text-sm font-semibold">Movimentações do saldo</h2>
        {transactions.length ? (
          transactions.map((transaction) => (
            <Row
              key={transaction.id}
              title={TRANSACTION_LABEL[transaction.kind] || transaction.kind}
              subtitle={`${formatDateTime(transaction.created_date)}${transaction.label ? ` · ${transaction.label}` : ""}`}
              value={`${Number(transaction.amount) >= 0 ? "+" : "-"}${formatCurrency(Math.abs(Number(transaction.amount)))}`}
              status={`saldo ${formatCurrency(transaction.balance_after)}`}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
        )}
      </section>
    </div>
  );
}
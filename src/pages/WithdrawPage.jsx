import React from "react";
import { Link } from "react-router-dom";
import { ArrowUpFromLine, RefreshCw, Wallet as WalletIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import WithdrawPanel from "@/components/wallet/WithdrawPanel";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { useWalletData } from "@/lib/useWalletData";
import { formatCpf } from "@/lib/cpf";
import { formatCurrency, formatDateTime } from "@/lib/format";

const WITHDRAWAL_STATUS = {
  pending: { label: "Aguardando liberação", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  processing: { label: "Processando", className: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  completed: { label: "Enviado", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  failed: { label: "Falhou", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  rejected: { label: "Recusado", className: "border-destructive/40 bg-destructive/10 text-destructive" },
};

export default function WithdrawPage() {
  const { loading, wallet, withdrawals, settings, profile, load } = useWalletData();

  if (loading) return <CardListSkeleton count={2} />;

  const walletData = wallet || {};
  const balance = Number(walletData.balance || 0);
  const locked = Number(walletData.locked_balance || 0);
  const required = Number(walletData.rollover_required || 0);
  const completed = Number(walletData.rollover_completed || 0);
  const rolloverPending = Math.max(0, Math.round((required - completed) * 100) / 100);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <ArrowUpFromLine className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Sacar</h1>
          <p className="text-xs text-muted-foreground">Envio via PIX para o CPF vinculado à sua conta</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </header>

      <div className="card-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <WalletIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Disponível para sacar</p>
            <p className="score-num text-2xl font-semibold">{formatCurrency(balance)}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/deposito">Ir para depósito</Link>
        </Button>
      </div>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Solicitar saque via PIX</h2>
        <WithdrawPanel
          minWithdrawal={Number(settings.min_withdrawal ?? 30)}
          enabled={settings.withdrawals_enabled !== false}
          rolloverPending={rolloverPending}
          profile={profile}
          onRequested={load}
        />
      </section>

      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Meus saques</h2>
        {withdrawals.length ? (
          <div className="space-y-1.5">
            {withdrawals.map((withdrawal) => {
              const status = WITHDRAWAL_STATUS[withdrawal.status] || WITHDRAWAL_STATUS.pending;
              return (
                <div key={withdrawal.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-xs">
                  <div className="min-w-0">
                    <p className="score-num text-base font-semibold">{formatCurrency(withdrawal.amount)}</p>
                    <p className="truncate text-muted-foreground">
                      {formatDateTime(withdrawal.created_date)}
                      {withdrawal.pix_key ? ` · PIX ${withdrawal.pix_key_type?.toUpperCase()} ${formatCpf(String(withdrawal.pix_key).replace(/\D/g, ""))}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={status.className}>{status.label}</Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum saque solicitado ainda.</p>
        )}
      </section>
    </div>
  );
}
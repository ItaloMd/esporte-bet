import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Info, Lock, RefreshCw, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import WalletHistory from "@/components/wallet/WalletHistory";
import { useWalletData } from "@/lib/useWalletData";
import { formatCurrency } from "@/lib/format";

export default function Wallet() {
  const { loading, wallet, deposits, withdrawals, transactions, load } = useWalletData();

  if (loading) return <CardListSkeleton count={2} />;

  const walletData = wallet || {};
  const balance = Number(walletData.balance || 0);
  const locked = Number(walletData.locked_balance || 0);
  const required = Number(walletData.rollover_required || 0);
  const completed = Number(walletData.rollover_completed || 0);
  const rolloverPending = Math.max(0, Math.round((required - completed) * 100) / 100);
  const rolloverProgress = required > 0 ? Math.min(100, (completed / required) * 100) : 100;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <WalletIcon className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Carteira</h1>
          <p className="text-xs text-muted-foreground">Depósitos e saques via PIX, com rollover configurado pela plataforma</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="card-surface px-4 py-3">
          <p className="score-num text-2xl font-semibold">{formatCurrency(balance)}</p>
          <p className="text-[11px] text-muted-foreground">Saldo disponível</p>
        </div>
        <div className="card-surface px-4 py-3">
          <p className="score-num flex items-center gap-1.5 text-2xl font-semibold">
            <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {formatCurrency(locked)}
          </p>
          <p className="text-[11px] text-muted-foreground">Reservado em saques</p>
        </div>
        <div className="card-surface px-4 py-3">
          <p className="score-num text-2xl font-semibold">{formatCurrency(Number(walletData.total_deposited || 0))}</p>
          <p className="text-[11px] text-muted-foreground">Total depositado</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/deposito" className="card-surface group flex items-center gap-4 p-4 transition-colors hover:border-primary/50">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ArrowDownToLine className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Depositar</span>
            <span className="block truncate text-xs text-muted-foreground">Gere o QR Code PIX e pague no banco</span>
          </span>
        </Link>
        <Link to="/saque" className="card-surface group flex items-center gap-4 p-4 transition-colors hover:border-primary/50">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ArrowUpFromLine className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Sacar</span>
            <span className="block truncate text-xs text-muted-foreground">Envio via PIX para o seu CPF cadastrado</span>
          </span>
        </Link>
      </div>

      <section className="card-surface space-y-2 px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Rollover para saque</span>
          <span className="text-xs text-muted-foreground">
            {formatCurrency(completed)} de {formatCurrency(required)}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${rolloverProgress}%` }} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {rolloverPending > 0
            ? `Faltam ${formatCurrency(rolloverPending)} em apostas liquidadas para liberar o saque.`
            : "Rollover cumprido — seu saque está liberado."}
        </p>
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          Depósitos entram no seu saldo pelo valor cheio. O rollover é contabilizado na liquidação das apostas.
          O envio do PIX e as taxas são processados pelo gateway de pagamentos.
        </p>
      </div>

      <WalletHistory
        deposits={deposits}
        withdrawals={withdrawals}
        transactions={transactions}
      />
    </div>
  );
}
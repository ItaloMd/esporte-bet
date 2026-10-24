import React, { useCallback, useEffect, useState } from "react";
import { Info, Lock, RefreshCw, Wallet as WalletIcon } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import DepositPanel from "@/components/wallet/DepositPanel";
import WithdrawPanel from "@/components/wallet/WithdrawPanel";
import WalletHistory from "@/components/wallet/WalletHistory";
import { formatCurrency } from "@/lib/format";

export default function Wallet() {
  const { user, isAuthenticated, isLoadingAuth, authChecked, navigateToLogin } = useAuth();
  const [state, setState] = useState({ loading: true, wallet: null, deposits: [], withdrawals: [], settings: {} });

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [walletPage, depositPage, withdrawalPage, settingsPage] = await Promise.all([
      base44.entities.Wallet.filter({ user_id: user.id }, { limit: 1 }),
      base44.entities.Deposit.filter({ user_id: user.id }, { sort: "-created_date", limit: 8 }),
      base44.entities.Withdrawal.filter({ user_id: user.id }, { sort: "-created_date", limit: 8 }),
      base44.entities.AppSettings.list({ limit: 1 }),
    ]);
    setState({
      loading: false,
      wallet: walletPage.items?.[0] || null,
      deposits: depositPage.items || [],
      withdrawals: withdrawalPage.items || [],
      settings: settingsPage.items?.[0] || {},
    });
  }, [user?.id]);

  useEffect(() => {
    if (!authChecked || isLoadingAuth) return;
    if (!isAuthenticated) {
      navigateToLogin();
      return;
    }
    load().catch(() => setState((current) => ({ ...current, loading: false })));
  }, [authChecked, isLoadingAuth, isAuthenticated, load, navigateToLogin]);

  if (state.loading) return <CardListSkeleton count={2} />;

  const wallet = state.wallet || {};
  const settings = state.settings || {};
  const balance = Number(wallet.balance || 0);
  const locked = Number(wallet.locked_balance || 0);
  const required = Number(wallet.rollover_required || 0);
  const completed = Number(wallet.rollover_completed || 0);
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
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => load()}>
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
          <p className="score-num text-2xl font-semibold">{formatCurrency(Number(wallet.total_deposited || 0))}</p>
          <p className="text-[11px] text-muted-foreground">Total depositado</p>
        </div>
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
            ? `Faltam ${formatCurrency(rolloverPending)} em apostas para liberar o saque.`
            : "Rollover cumprido — seu saque está liberado."}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-semibold">Depositar via PIX</h2>
          <DepositPanel
            minDeposit={Number(settings.min_deposit ?? 10)}
            enabled={settings.deposits_enabled !== false}
            onCredited={load}
          />
        </section>

        <section className="card-surface space-y-3 p-4">
          <h2 className="text-sm font-semibold">Sacar via PIX</h2>
          <WithdrawPanel
            minWithdrawal={Number(settings.min_withdrawal ?? 30)}
            enabled={settings.withdrawals_enabled !== false}
            rolloverPending={rolloverPending}
            onRequested={load}
          />
        </section>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          Depósitos entram no seu saldo pelo valor cheio. Cada simulação confirmada conta como aposta para o rollover.
          A taxa do saque e o envio do PIX são processados pela TichuPay.
        </p>
      </div>

      <WalletHistory deposits={state.deposits} withdrawals={state.withdrawals} />
    </div>
  );
}
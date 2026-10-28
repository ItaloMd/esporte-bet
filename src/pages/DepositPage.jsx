import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, Info, QrCode, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DepositPanel from "@/components/wallet/DepositPanel";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { useWalletData } from "@/lib/useWalletData";
import { formatCurrency, formatDateTime } from "@/lib/format";

const DEPOSIT_STATUS = {
  pending: { label: "Aguardando pagamento", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  paid: { label: "Confirmado", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  expired: { label: "Expirado", className: "border-border bg-secondary text-muted-foreground" },
  cancelled: { label: "Cancelado", className: "border-border bg-secondary text-muted-foreground" },
};

export default function DepositPage() {
  const { loading, wallet, deposits, settings, profile, load } = useWalletData();

  if (loading) return <CardListSkeleton count={2} />;

  const balance = Number(wallet?.balance || 0);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <ArrowDownToLine className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Depositar</h1>
          <p className="text-xs text-muted-foreground">Gere o QR Code PIX, pague e o saldo cai automaticamente</p>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
        </Button>
      </header>

      <div className="card-surface flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Saldo atual</p>
          <p className="score-num text-2xl font-semibold">{formatCurrency(balance)}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/saque">Ir para saque</Link>
        </Button>
      </div>

      <section className="card-surface space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <QrCode className="h-4 w-4 text-primary" aria-hidden="true" /> Depósito via PIX
        </h2>
        <DepositPanel
          minDeposit={Number(settings.min_deposit ?? 10)}
          enabled={settings.deposits_enabled !== false}
          profile={profile}
          onCredited={load}
        />
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          O valor entra no seu saldo integral, sem desconto. A confirmação é automática pelo webhook do gateway.
        </p>
      </div>

      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Meus depósitos</h2>
        {deposits.length ? (
          <div className="space-y-1.5">
            {deposits.map((deposit) => {
              const status = DEPOSIT_STATUS[deposit.status] || DEPOSIT_STATUS.pending;
              return (
                <div key={deposit.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-xs">
                  <div className="min-w-0">
                    <p className="score-num text-base font-semibold">{formatCurrency(deposit.amount)}</p>
                    <p className="text-muted-foreground">{formatDateTime(deposit.created_date)}</p>
                  </div>
                  <Badge variant="outline" className={status.className}>{status.label}</Badge>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum depósito registrado ainda.</p>
        )}
      </section>
    </div>
  );
}
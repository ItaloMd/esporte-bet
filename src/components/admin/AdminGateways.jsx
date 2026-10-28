import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/format";

const PURPOSES = [
  { key: "deposit", label: "Depósitos" },
  { key: "withdrawal", label: "Saques" },
];

function BalanceRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="score-num font-semibold">{formatCurrency(value || 0)}</span>
    </div>
  );
}

export default function AdminGateways() {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await base44.functions.invoke("adminGateways", { action: "overview" });
    setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar os gateways.");
      setLoading(false);
    });
  }, [load]);

  const toggle = async (gateway, purpose, enabled) => {
    const toggleId = `${gateway}_${purpose}`;
    setBusy(toggleId);
    try {
      const res = await base44.functions.invoke("adminGateways", { action: "toggle", gateway, purpose, enabled });
      setData((prev) => ({ ...prev, settings: res.data.settings, active: res.data.active }));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível atualizar o gateway",
        description: err?.response?.data?.error || err.message || "Tente novamente.",
      });
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="card-surface h-64 animate-pulse" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return null;

  const info = data.gateways.payshark;
  const enabled = {
    deposit: data.settings.payshark_deposit,
    withdrawal: data.settings.payshark_withdrawal,
  };

  return (
    <div className="space-y-4">
      <section className="card-surface space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" /> Gateways de pagamento
          </h2>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O Payshark é o único gateway da plataforma. Ligue ou desligue por função: com o gateway desligado para uma
          função, os depósitos ou saques dela ficam desativados por completo.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Roteamento atual — depósitos: <strong>{data.active.deposit === "payshark" ? "Payshark" : "desativado"}</strong> · saques:{" "}
          <strong>{data.active.withdrawal === "payshark" ? "Payshark" : "desativado"}</strong>
        </p>
      </section>

      <section className="card-surface space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
            Payshark
            {info?.store?.name ? <span className="text-xs font-normal text-muted-foreground">· {info.store.name}</span> : null}
          </h3>
          {info?.configured ? (
            <span className="flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> conectado
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-0.5 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> sem credenciais
            </span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Entrada: R$ 1,00 fixo · Saque: 2% + R$ 1,00 (debitadas do valor enviado) — custo da casa; o jogador recebe o
          valor integral do depósito.
        </p>

        <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 px-3 py-2">
          {info?.balance ? (
            <>
              <BalanceRow label="Disponível para transferir" value={info.balance.available} />
              <BalanceRow label="Transferências pendentes" value={info.balance.transfers_pending} />
              <BalanceRow label="Reserva pendente" value={info.balance.reserve_pending} />
              <BalanceRow label="Entradas hoje" value={info.balance.today_payments} />
              <BalanceRow label="Saques hoje" value={info.balance.today_transfers} />
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">Saldo indisponível{info?.error ? `: ${info.error}` : "."}</p>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {PURPOSES.map((purpose) => {
            const toggleId = `payshark_${purpose.key}`;
            return (
              <div
                key={purpose.key}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                  data.active[purpose.key] === "payshark" ? "border-primary/50 bg-primary/10" : "border-border"
                }`}
              >
                <div>
                  <p className="text-xs font-medium">{purpose.label}</p>
                  {data.active[purpose.key] === "payshark" ? (
                    <p className="text-[10px] text-primary">ativo</p>
                  ) : enabled[purpose.key] ? (
                    <p className="text-[10px] text-muted-foreground">ligado</p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">desligado</p>
                  )}
                </div>
                <Switch
                  checked={enabled[purpose.key]}
                  disabled={busy === toggleId}
                  onCheckedChange={(checked) => toggle("payshark", purpose.key, checked)}
                  aria-label={`Payshark — ${purpose.label}`}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, Landmark, Loader2, RefreshCw } from "lucide-react";
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

function GatewayCard({ gateway, info, settings, active, fees, onToggle, busy }) {
  const enabled = {
    deposit: settings[`${gateway}_deposit`],
    withdrawal: settings[`${gateway}_withdrawal`],
  };
  const isLiqfy = gateway === "liqfy";

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {isLiqfy ? (
            <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <CreditCard className="h-4 w-4 text-primary" aria-hidden="true" />
          )}
          {isLiqfy ? "Liqfy" : "Payshark"}
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
        Entrada: {isLiqfy ? "R$ 1,00 + 3,5% do valor" : "R$ 1,00 fixo"} · Saque: {isLiqfy ? "R$ 1,00 + 3,5% (por cima)" : "2% + R$ 3,00 (por cima)"} — custo da casa; o jogador recebe o valor integral.
      </p>

      <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 px-3 py-2">
        {info?.balance ? (
          isLiqfy ? (
            <>
              <BalanceRow label="Disponível para sacar" value={info.balance.available} />
              <BalanceRow label="Reservado" value={info.balance.held} />
              <BalanceRow label="Pendente" value={info.balance.pending} />
            </>
          ) : (
            <>
              <BalanceRow label="Disponível para transferir" value={info.balance.available} />
              <BalanceRow label="Transferências pendentes" value={info.balance.transfers_pending} />
              <BalanceRow label="Reserva pendente" value={info.balance.reserve_pending} />
              <BalanceRow label="Entradas hoje" value={info.balance.today_payments} />
              <BalanceRow label="Saques hoje" value={info.balance.today_transfers} />
            </>
          )
        ) : (
          <p className="text-[11px] text-muted-foreground">Saldo indisponível{info?.error ? `: ${info.error}` : "."}</p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {PURPOSES.map((purpose) => {
          const isActive = active?.[purpose.key] === gateway;
          const toggleId = `${gateway}_${purpose.key}`;
          return (
            <div
              key={purpose.key}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                isActive ? "border-primary/50 bg-primary/10" : "border-border"
              }`}
            >
              <div>
                <p className="text-xs font-medium">{purpose.label}</p>
                {isActive ? (
                  <p className="text-[10px] text-primary">ativo para esta função</p>
                ) : enabled[purpose.key] ? (
                  <p className="text-[10px] text-muted-foreground">ligado (o outro gateway é o principal)</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">desligado</p>
                )}
              </div>
              <Switch
                checked={enabled[purpose.key]}
                disabled={busy === toggleId}
                onCheckedChange={(checked) => onToggle(gateway, purpose.key, checked)}
                aria-label={`${isLiqfy ? "Liqfy" : "Payshark"} — ${purpose.label}`}
              />
            </div>
          );
        })}
      </div>
    </section>
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
          Ligue ou desligue cada gateway por função. Com ambos ligados para a mesma função, a Liqfy é a principal e a
          Payshark assume quando a Liqfy estiver desligada. Nenhum ligado para uma função a desativa por completo.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Roteamento atual — depósitos: <strong>{data.active.deposit === "liqfy" ? "Liqfy" : data.active.deposit === "payshark" ? "Payshark" : "desativado"}</strong> · saques:{" "}
          <strong>{data.active.withdrawal === "liqfy" ? "Liqfy" : data.active.withdrawal === "payshark" ? "Payshark" : "desativado"}</strong>
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {["liqfy", "payshark"].map((gateway) => (
          <GatewayCard
            key={gateway}
            gateway={gateway}
            info={data.gateways[gateway]}
            settings={data.settings}
            active={data.active}
            fees={data.fees[gateway]}
            onToggle={toggle}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}
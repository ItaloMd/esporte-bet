import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, Check, Loader2, RefreshCw, Save, Send, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { formatCurrency, formatDateTime } from "@/lib/format";

const EMPTY = {
  min_deposit: 10,
  min_withdrawal: 30,
  rollover_multiplier: 1,
  withdrawal_fee: 3,
  admin_pix_key: "",
  admin_pix_key_type: "cpf",
  deposits_enabled: true,
  withdrawals_enabled: true,
};

const KEY_TYPES = ["cpf", "cnpj", "email", "phone", "random"];

const STATUS_LABEL = {
  pending: "Aguardando",
  processing: "Processando",
  completed: "Concluído",
  failed: "Falhou",
  rejected: "Recusado",
};

const KIND_LABEL = { player: "Jogador", affiliate: "Afiliado", admin: "Caixa" };

const invoke = async (payload) => {
  const response = await base44.functions.invoke("adminFinance", payload);
  return response.data;
};

function Stat({ label, value, hint, highlight }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-primary/40 bg-primary/10" : "border-border"}`}>
      <p className="score-num text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export default function AdminFinance() {
  const [overview, setOverview] = useState({ loading: true, cash: null, cashError: "", deposits: [], withdrawals: [] });
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setOverview((current) => ({ ...current, loading: true }));
    const data = await invoke({ action: "overview" });
    setSettings({ ...EMPTY, ...(data.settings || {}) });
    setOverview({
      loading: false,
      cash: data.cash || null,
      cashError: data.cash_error || "",
      deposits: data.deposits || [],
      withdrawals: data.withdrawals || [],
    });
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar o financeiro.");
      setOverview((current) => ({ ...current, loading: false }));
    });
  }, [load]);

  const run = async (key, payload) => {
    setBusy(key);
    setError("");
    try {
      const data = await invoke(payload);
      await load();
      return data;
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Falha na operação.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const saveSettings = async () => {
    setSaving(true);
    setError("");
    try {
      const data = await invoke({ action: "save_settings", settings });
      setSettings({ ...EMPTY, ...(data.settings || {}) });
      toast({ title: "Configuração de depósitos e saques salva" });
    } catch (err) {
      toast({
        title: "Não foi possível salvar",
        description: err?.response?.data?.error || err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const withdrawCash = async () => {
    const data = await run("cash", { action: "withdraw_cash", amount: Number(cashAmount) });
    if (data && !data.error) {
      toast({
        title: "Saque do caixa enviado",
        description:
          data.dev_split?.ok === false
            ? "Há um reenvio pendente — confira a seção Reenvios pendentes."
            : undefined,
      });
      setCashAmount("");
    }
  };

  const processWithdrawal = (id, approve) => run(`wd-${id}`, { action: "process_withdrawal", id, approve });
  const retryDev = (id) => run(`dev-${id}`, { action: "retry_dev_split", id });

  if (!settings) return <div className="card-surface h-40 animate-pulse" />;

  const pendingWithdrawals = overview.withdrawals.filter((item) => item.status === "pending");
  const visibleWithdrawals = overview.withdrawals.filter((item) => item.kind !== "dev_split");
  const pendingDev = overview.withdrawals.filter(
    (item) => item.kind === "admin" && item.dev_split_status === "pending" && item.dev_split_amount > 0,
  );

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Banknote className="h-4 w-4 text-primary" aria-hidden="true" /> Caixa disponível (TichuPay)
          </h2>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={overview.loading}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
        {overview.cash ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Líquido disponível para saque" value={formatCurrency(overview.cash.available)} highlight />
            <Stat label="Bloqueado em saques" value={formatCurrency(overview.cash.blocked)} />
            <Stat label="A receber (PIX pendentes)" value={formatCurrency(overview.cash.pending)} />
            <Stat
              label="Líquido no mês"
              value={formatCurrency(overview.cash.month_net)}
              hint={`${overview.cash.month_transactions} depósitos pagos`}
            />
          </div>
        ) : (
          <p className="text-xs text-destructive">
            {overview.cashError || "Não foi possível consultar o saldo na TichuPay."}
          </p>
        )}
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Sacar caixa</h2>
        <p className="text-xs text-muted-foreground">
          A TichuPay cobra a taxa de {formatCurrency(settings.withdrawal_fee)} por saque.
        </p>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="cash-amount">Valor do saque</Label>
          <Input
            id="cash-amount"
            type="number"
            step="0.01"
            value={cashAmount}
            onChange={(event) => setCashAmount(event.target.value)}
          />
        </div>
        {error && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        <Button onClick={withdrawCash} disabled={busy === "cash" || !cashAmount}>
          {busy === "cash" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Sacar do caixa
        </Button>
      </section>

      {pendingDev.length > 0 && (
        <section className="card-surface space-y-2 p-4">
          <h2 className="text-sm font-semibold">Reenvios pendentes</h2>
          <p className="text-xs text-muted-foreground">
            A TichuPay aceita apenas um saque a cada 5 minutos. Reenvie os valores abaixo após esse intervalo.
          </p>
          {pendingDev.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
              <div>
                <p className="font-medium">{formatCurrency(item.dev_split_amount)} pendente</p>
                <p className="text-muted-foreground">Referente ao saque de {formatCurrency(item.amount)} · {formatDateTime(item.created_date)}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => retryDev(item.id)} disabled={busy === `dev-${item.id}`}>
                {busy === `dev-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reenviar"}
              </Button>
            </div>
          ))}
        </section>
      )}

      <section className="card-surface space-y-4 p-4">
        <h2 className="text-sm font-semibold">Configuração de depósitos e saques</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="min-deposit">Depósito mínimo (R$)</Label>
            <Input id="min-deposit" type="number" value={settings.min_deposit} onChange={(e) => update({ min_deposit: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min-withdrawal">Saque mínimo (R$)</Label>
            <Input id="min-withdrawal" type="number" value={settings.min_withdrawal} onChange={(e) => update({ min_withdrawal: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rollover">Rollover (x o valor depositado)</Label>
            <Input id="rollover" type="number" step="0.1" value={settings.rollover_multiplier} onChange={(e) => update({ rollover_multiplier: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fee">Taxa por saque (R$)</Label>
            <Input id="fee" type="number" step="0.01" value={settings.withdrawal_fee} onChange={(e) => update({ withdrawal_fee: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-key">Chave PIX do caixa</Label>
            <Input id="admin-key" value={settings.admin_pix_key} onChange={(e) => update({ admin_pix_key: e.target.value })} placeholder="Chave que recebe o saque" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-key-type">Tipo da chave do caixa</Label>
            <select id="admin-key-type" value={settings.admin_pix_key_type} onChange={(e) => update({ admin_pix_key_type: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {KEY_TYPES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Depósitos habilitados
            <Switch checked={Boolean(settings.deposits_enabled)} onCheckedChange={(value) => update({ deposits_enabled: value })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Saques habilitados
            <Switch checked={Boolean(settings.withdrawals_enabled)} onCheckedChange={(value) => update({ withdrawals_enabled: value })} />
          </label>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar configuração financeira
        </Button>
      </section>

      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Saques ({pendingWithdrawals.length} aguardando liberação)</h2>
        {visibleWithdrawals.length ? (
          visibleWithdrawals.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-medium">
                  {KIND_LABEL[item.kind] || item.kind} · {formatCurrency(item.amount)}
                </p>
                <p className="text-muted-foreground">
                  {item.user_email || "—"} · {formatDateTime(item.created_date)} · {STATUS_LABEL[item.status] || item.status}
                  {item.fee > 0 && ` · taxa ${formatCurrency(item.fee)}`}
                </p>
                {item.failure_reason && <p className="text-destructive">{item.failure_reason}</p>}
              </div>
              {item.status === "pending" && ["player", "affiliate"].includes(item.kind) && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => processWithdrawal(item.id, false)} disabled={busy === `wd-${item.id}`}>
                    <X className="mr-1 h-3.5 w-3.5" /> Recusar
                  </Button>
                  <Button size="sm" onClick={() => processWithdrawal(item.id, true)} disabled={busy === `wd-${item.id}`}>
                    {busy === `wd-${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="mr-1 h-3.5 w-3.5" /> Pagar PIX</>}
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum saque registrado.</p>
        )}
      </section>

      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Depósitos recentes</h2>
        {overview.deposits.length ? (
          overview.deposits.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-medium">{formatCurrency(item.amount)}</p>
                <p className="text-muted-foreground">{formatDateTime(item.created_date)} · {item.payer_name || "sem pagador"}</p>
              </div>
              <div className="text-right">
                <p className="score-num font-semibold">{STATUS_LABEL[item.status] || item.status}</p>
                <p className="text-muted-foreground">taxa {formatCurrency(item.fee)}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum depósito registrado.</p>
        )}
      </section>
    </div>
  );
}
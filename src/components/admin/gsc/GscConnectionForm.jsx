import React, { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function GscConnectionForm({ settings, saving, onSave }) {
  const [draft, setDraft] = useState(settings || {});

  useEffect(() => {
    setDraft(settings || {});
  }, [settings]);

  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const setBool = (key) => (checked) => setDraft((current) => ({ ...current, [key]: checked }));

  const submit = (event) => {
    event.preventDefault();
    onSave({
      operator_code: draft.operator_code?.trim() || "",
      operator_name: draft.operator_name?.trim() || "",
      environment: draft.environment || "staging",
      api_base_url: draft.api_base_url?.trim() || "",
      currency: draft.currency?.trim() || "BRL",
      locale: draft.locale?.trim() || "pt-BR",
      return_url: draft.return_url?.trim() || "",
      secret_name: draft.secret_name?.trim() || "GSC_SECRET_KEY",
      secret_configured: Boolean(draft.secret_configured),
      allowed_ips: draft.allowed_ips?.trim() || "",
      min_bet: Number(draft.min_bet) || 1,
      max_bet: Number(draft.max_bet) || 500,
      enabled: Boolean(draft.enabled),
      demo_enabled: Boolean(draft.demo_enabled),
      real_enabled: Boolean(draft.real_enabled),
      note: draft.note?.trim() || "",
    });
  };

  return (
    <form onSubmit={submit} className="card-surface space-y-3 p-4">
      <h2 className="text-sm font-semibold">Credenciais e ambiente</h2>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Código do operador" hint="Fornecido pela GamingSoft na liberação da conta.">
          <Input value={draft.operator_code || ""} onChange={set("operator_code")} placeholder="ex.: ESPORTEBET" />
        </Field>
        <Field label="Nome do operador">
          <Input value={draft.operator_name || ""} onChange={set("operator_name")} placeholder="Esporte Bet" />
        </Field>
        <Field label="Ambiente">
          <select className={SELECT_CLASS} value={draft.environment || "staging"} onChange={set("environment")}>
            <option value="staging">Staging (testes)</option>
            <option value="production">Produção (saldo real)</option>
          </select>
        </Field>
        <Field label="Endereço da API">
          <Input value={draft.api_base_url || ""} onChange={set("api_base_url")} placeholder="https://api.gscplus.com" />
        </Field>
        <Field label="Moeda">
          <Input value={draft.currency || ""} onChange={set("currency")} placeholder="BRL" />
        </Field>
        <Field label="Idioma">
          <Input value={draft.locale || ""} onChange={set("locale")} placeholder="pt-BR" />
        </Field>
        <Field label="Página de retorno" hint="Destino do jogador ao sair do jogo.">
          <Input value={draft.return_url || ""} onChange={set("return_url")} placeholder="https://esportebet.base44.app/cassino" />
        </Field>
        <Field label="Nome do segredo da chave" hint="Cadastre a chave secreta na página Secrets com este nome.">
          <Input value={draft.secret_name || ""} onChange={set("secret_name")} placeholder="GSC_SECRET_KEY" />
        </Field>
        <Field label="IPs de origem do provedor" hint="Separados por vírgula. Usados para validar as chamadas de carteira.">
          <Input value={draft.allowed_ips || ""} onChange={set("allowed_ips")} placeholder="203.0.113.10, 203.0.113.11" />
        </Field>
        <Field label="Aposta mínima / máxima">
          <div className="flex gap-2">
            <Input type="number" min="0" step="0.01" value={draft.min_bet ?? ""} onChange={set("min_bet")} placeholder="1" />
            <Input type="number" min="0" step="0.01" value={draft.max_bet ?? ""} onChange={set("max_bet")} placeholder="500" />
          </div>
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { key: "enabled", label: "Integração ligada" },
          { key: "demo_enabled", label: "Permitir demonstração" },
          { key: "real_enabled", label: "Permitir saldo real" },
        ].map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span className="text-xs">{item.label}</span>
            <Switch checked={Boolean(draft[item.key])} onCheckedChange={setBool(item.key)} aria-label={item.label} />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          A chave secreta existe apenas no servidor. Nada de credencial fica no navegador.
        </p>
        <Button type="submit" size="sm" disabled={saving}>
          <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";
import { formatDateTime, timeAgo } from "@/lib/format";

const PROVIDERS = [
  { value: "demo", label: "Sem provedor externo (dados internos)" },
  { value: "the_odds_api", label: "The Odds API" },
  { value: "api_football", label: "API-Football" },
  { value: "sportradar", label: "Sportradar" },
  { value: "custom", label: "Provedor próprio" },
];

export default function AdminProvider({ actor }) {
  const [settings, setSettings] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [page, syncJobs] = await Promise.all([
      base44.entities.ProviderSettings.list({ limit: 1 }),
      base44.entities.SyncJob.filter({}, { sort: "-created_date", limit: 5 }),
    ]);
    const existing = page.items?.[0] || null;
    setRecordId(existing?.id || null);
    setSettings(
      existing || {
        provider: "demo",
        enabled: false,
        refresh_live_seconds: 60,
        refresh_upcoming_seconds: 900,
        refresh_finished_seconds: 1800,
        cache_ttl_seconds: 300,
        batch_odds: true,
        webhook_enabled: false,
        daily_request_limit: 1000,
        credentials_configured: false,
        notes: "",
      },
    );
    setJobs(syncJobs.items || []);
  };

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...settings };
      delete payload.id;
      delete payload.created_date;
      delete payload.updated_date;
      delete payload.created_by_id;
      if (recordId) await base44.entities.ProviderSettings.update(recordId, payload);
      else {
        const created = await base44.entities.ProviderSettings.create(payload);
        setRecordId(created.id);
      }
      await logAdminAction({
        actor,
        action: "provider.settings_updated",
        targetType: "ProviderSettings",
        targetId: recordId || "novo",
        details: `Provedor ${payload.provider} · atualização ao vivo ${payload.refresh_live_seconds}s · cache ${payload.cache_ttl_seconds}s`,
        severity: "warning",
      });
      toast({ title: "Configurações salvas" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Provedor de dados e odds</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            As credenciais do provedor são armazenadas exclusivamente como segredos do backend, nunca em tabelas
            acessíveis ao jogador nem no código do navegador. A conexão real deve ser validada com credenciais válidas
            antes de ser considerada concluída.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="provider">Provedor</Label>
            <select
              id="provider"
              value={settings.provider}
              onChange={(event) => update({ provider: event.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.value} value={provider.value}>{provider.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="base_url">URL base da API</Label>
            <Input id="base_url" value={settings.base_url || ""} onChange={(event) => update({ base_url: event.target.value })} placeholder="https://api.provedor.com/v4" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refresh_live">Atualização de partidas ao vivo (segundos)</Label>
            <Input id="refresh_live" type="number" value={settings.refresh_live_seconds} onChange={(event) => update({ refresh_live_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refresh_upcoming">Atualização de eventos futuros (segundos)</Label>
            <Input id="refresh_upcoming" type="number" value={settings.refresh_upcoming_seconds} onChange={(event) => update({ refresh_upcoming_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cache_ttl">Validade do cache (segundos)</Label>
            <Input id="cache_ttl" type="number" value={settings.cache_ttl_seconds} onChange={(event) => update({ cache_ttl_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="limit">Limite diário de requisições</Label>
            <Input id="limit" type="number" value={settings.daily_request_limit} onChange={(event) => update({ daily_request_limit: Number(event.target.value) })} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { key: "enabled", label: "Integração habilitada" },
            { key: "batch_odds", label: "Usar consultas de odds em lote" },
            { key: "webhook_enabled", label: "Usar webhooks do provedor, quando disponíveis" },
            { key: "credentials_configured", label: "Credenciais já configuradas como segredo" },
          ].map((item) => (
            <label key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              {item.label}
              <Switch
                checked={Boolean(settings[item.key])}
                onCheckedChange={(value) => update({ [item.key]: value })}
                aria-label={item.label}
              />
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Observações operacionais</Label>
          <Textarea id="notes" rows={3} value={settings.notes || ""} onChange={(event) => update({ notes: event.target.value })} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar configurações
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Última alteração: {settings.updated_date ? formatDateTime(settings.updated_date) : "—"}
          </span>
        </div>
      </section>

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Diagnóstico</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>• Modo atual: {settings.provider === "demo" || !settings.enabled ? "sem provedor externo (dados internos)" : "provedor externo habilitado"}</li>
          <li>• Credenciais de API: {settings.credentials_configured ? "declaradas como configuradas" : "não configuradas — nenhuma chamada externa é feita"}</li>
          <li>• Última sincronização: {settings.last_sync_at ? timeAgo(settings.last_sync_at) : "nunca"}</li>
          <li>• Falhas recentes: {jobs.filter((job) => job.status === "error").length}</li>
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Teste de conexão real será disponibilizado junto com a chave do provedor: sem credenciais válidas, a
          plataforma informa que a integração ainda não está concluída.
        </p>
      </section>
    </div>
  );
}
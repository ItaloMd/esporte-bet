import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import AdminProviderStats from "@/components/admin/AdminProviderStats";
import { logAdminAction } from "@/lib/adminAudit";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { value: "demo", label: "Sem provedor externo (dados internos)" },
  { value: "the_odds_api", label: "The Odds API" },
  { value: "api_football", label: "API-Football" },
  { value: "sportradar", label: "Sportradar" },
  { value: "custom", label: "Provedor próprio" },
];

const REGIONS = [
  { value: "eu", label: "Europa (eu)" },
  { value: "uk", label: "Reino Unido (uk)" },
  { value: "us", label: "Estados Unidos (us)" },
  { value: "au", label: "Austrália (au)" },
];

const MARKETS = [
  { value: "h2h", label: "Resultado (h2h)" },
  { value: "spreads", label: "Handicap (spreads)" },
  { value: "totals", label: "Totais (totals)" },
];

const DEFAULTS = {
  provider: "demo",
  enabled: false,
  base_url: "https://api.the-odds-api.com/v4",
  regions: ["eu"],
  markets: ["h2h", "spreads", "totals"],
  sports: [],
  max_sports_per_run: 6,
  max_bookmakers: 8,
  budget_credits: 0,
  daily_request_limit: 150,
  refresh_upcoming_seconds: 3600,
  refresh_finished_seconds: 86400,
  cache_ttl_seconds: 600,
  batch_odds: true,
  credentials_configured: false,
  notes: "",
};

function ToggleChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-secondary/40 text-muted-foreground hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

export default function AdminProvider({ actor }) {
  const [settings, setSettings] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [sports, setSports] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [page, syncJobs, sportsPage] = await Promise.all([
      base44.entities.ProviderSettings.list({ limit: 1 }),
      base44.entities.SyncJob.filter({}, { sort: "-created_date", limit: 5 }),
      base44.entities.Sport.list({ sort: "name", limit: 200 }),
    ]);
    const existing = page.items?.[0] || null;
    setRecordId(existing?.id || null);
    setSettings({ ...DEFAULTS, ...(existing || {}) });
    setJobs(syncJobs.items || []);
    setSports(sportsPage.items || []);
  };

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const toggleIn = (key, value) =>
    setSettings((current) => {
      const list = current[key] || [];
      return {
        ...current,
        [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      };
    });

  const save = async () => {
    if (!settings.regions?.length) {
      toast({ title: "Selecione pelo menos uma região", variant: "destructive" });
      return;
    }
    if (!settings.markets?.length) {
      toast({ title: "Selecione pelo menos um mercado", variant: "destructive" });
      return;
    }
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
        details: `Provedor ${payload.provider} · regiões ${(payload.regions || []).join("/")} · mercados ${(payload.markets || []).join("/")} · limite diário ${payload.daily_request_limit}`,
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

  const enabledSports = settings.sports || [];

  return (
    <div className="space-y-5">
      <AdminProviderStats actor={actor} />

      <section className="card-surface space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Provedor de dados e odds</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A chave da API fica guardada como segredo do backend, nunca no navegador nem em tabelas acessíveis ao
            jogador. Odds ao vivo não são coletadas: apenas pré-jogo dos jogos de hoje e dos próximos sete dias.
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
            <Input id="base_url" value={settings.base_url || ""} onChange={(event) => update({ base_url: event.target.value })} placeholder="https://api.provider.com/v4" />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Regiões consultadas</Label>
          <p className="text-[11px] text-muted-foreground">
            Cada região multiplica o custo da consulta. Ative apenas as que trazem casas relevantes para o seu
            público.
          </p>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((region) => (
              <ToggleChip
                key={region.value}
                active={(settings.regions || []).includes(region.value)}
                onClick={() => toggleIn("regions", region.value)}
              >
                {region.label}
              </ToggleChip>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Mercados solicitados</Label>
          <p className="text-[11px] text-muted-foreground">
            Cada mercado multiplica o custo da consulta. Os mercados indisponíveis em uma modalidade são registrados
            como indisponíveis, sem gerar chamadas repetidas.
          </p>
          <div className="flex flex-wrap gap-2">
            {MARKETS.map((market) => (
              <ToggleChip
                key={market.value}
                active={(settings.markets || []).includes(market.value)}
                onClick={() => toggleIn("markets", market.value)}
              >
                {market.label}
              </ToggleChip>
            ))}
          </div>
        </div>

        {sports.length ? (
          <div className="space-y-2">
            <Label>Modalidades habilitadas</Label>
            <p className="text-[11px] text-muted-foreground">
              Sem nenhuma selecionada, todas as modalidades com jogos são consultadas.
            </p>
            <div className="flex flex-wrap gap-2">
              {sports.map((sport) => (
                <ToggleChip
                  key={sport.id}
                  active={enabledSports.includes(sport.slug)}
                  onClick={() => toggleIn("sports", sport.slug)}
                >
                  {sport.name}
                  {sport.in_season ? "" : " (fora de temporada)"}
                </ToggleChip>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="max_sports">Máximo de ligas por execução</Label>
            <Input id="max_sports" type="number" value={settings.max_sports_per_run} onChange={(event) => update({ max_sports_per_run: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_bookmakers">Máximo de casas por mercado</Label>
            <Input id="max_bookmakers" type="number" value={settings.max_bookmakers} onChange={(event) => update({ max_bookmakers: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="limit">Limite diário de créditos</Label>
            <Input id="limit" type="number" value={settings.daily_request_limit} onChange={(event) => update({ daily_request_limit: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="budget">Orçamento do período (créditos)</Label>
            <Input id="budget" type="number" value={settings.budget_credits} onChange={(event) => update({ budget_credits: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">Alertas em 70%, 85% e 95% do valor informado.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="refresh_today">Atualização das odds de hoje (segundos)</Label>
            <Input id="refresh_today" type="number" value={settings.refresh_upcoming_seconds} onChange={(event) => update({ refresh_upcoming_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="refresh_upcoming">Atualização das odds futuras (segundos)</Label>
            <Input id="refresh_upcoming" type="number" value={settings.refresh_finished_seconds} onChange={(event) => update({ refresh_finished_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cache_ttl">Validade mínima do cache (segundos)</Label>
            <Input id="cache_ttl" type="number" value={settings.cache_ttl_seconds} onChange={(event) => update({ cache_ttl_seconds: Number(event.target.value) })} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { key: "enabled", label: "Integração habilitada" },
            { key: "batch_odds", label: "Consultas de odds agrupadas por liga" },
            { key: "credentials_configured", label: "Chave configurada como segredo" },
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
          <li>• Modo atual: {settings.provider === "demo" || !settings.enabled ? "sem provedor externo (dados internos)" : `${settings.provider} habilitado`}</li>
          <li>• Chave da API: {settings.credentials_configured ? "guardada como segredo do backend" : "não configurada — nenhuma chamada externa é feita"}</li>
          <li>• Última sincronização: {settings.last_sync_at ? timeAgo(settings.last_sync_at) : "nunca"}</li>
          <li>• Situação: {settings.last_status || "—"}</li>
          <li>• Falhas recentes: {jobs.filter((job) => job.status === "error").length}</li>
        </ul>
      </section>
    </div>
  );
}
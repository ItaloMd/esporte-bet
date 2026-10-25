import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, Loader2, RefreshCw, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";
import { formatDateTime, timeAgo } from "@/lib/format";

const FOOTBALL_DEFAULTS = {
  football_enabled: false,
  football_base_url: "https://v3.football.api-sports.io",
  football_daily_limit: 100,
  football_window_days: 7,
  football_calendar_refresh_seconds: 21600,
  football_live_refresh_seconds: 300,
  football_live_idle_seconds: 900,
  football_live_discover_seconds: 1800,
  football_create_events: true,
};

const LEVEL_LABEL = {
  0: "Operação normal",
  1: "Reduzindo atualizações não essenciais",
  2: "Somente apostas pendentes e resultados finais",
  3: "Contingência: consultas não essenciais bloqueadas",
};

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="score-num text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Dia operacional no calendário brasileiro, igual ao usado no backend. */
function quotaDay() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export default function AdminFootball({ actor }) {
  const [settings, setSettings] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [quota, setQuota] = useState(null);
  const [cache, setCache] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [counts, setCounts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const [settingsPage, quotaPage, cachePage, jobPage, logPage, ticketCounts, selectionOpen, reviewEvents] =
      await Promise.all([
        base44.entities.ProviderSettings.list({ limit: 1 }),
        base44.entities.ApiQuota.filter({ provider: "api_football", day: quotaDay() }, { limit: 1 }),
        base44.entities.ApiCache.filter({ provider: "api_football" }, { sort: "-fetched_at", limit: 8 }),
        base44.entities.SyncJob.filter({ provider: "api_football" }, { sort: "-created_date", limit: 6 }),
        base44.entities.ApiUsageLog.filter({ provider: "api_football" }, { sort: "-created_date", limit: 8 }),
        Promise.all([
          base44.entities.SimulationTicket.count({ status: "won" }),
          base44.entities.SimulationTicket.count({ status: "lost" }),
          base44.entities.SimulationTicket.count({ status: "void" }),
          base44.entities.SimulationTicket.count({ status: "open" }),
          base44.entities.SimulationTicket.count({ settlement_state: "review" }),
        ]),
        base44.entities.SimulationSelection.count({ status: "open" }),
        base44.entities.Event.count({ settlement_state: "review" }),
      ]);

    const existing = settingsPage.items?.[0] || null;
    setRecordId(existing?.id || null);
    setSettings({ ...FOOTBALL_DEFAULTS, ...(existing || {}) });
    setQuota(quotaPage.items?.[0] || null);
    setCache(cachePage.items || []);
    setJobs(jobPage.items || []);
    setLogs(logPage.items || []);
    setCounts({
      won: ticketCounts[0],
      lost: ticketCounts[1],
      void: ticketCounts[2],
      open: ticketCounts[3],
      review: ticketCounts[4],
      selectionsOpen: selectionOpen,
      eventsReview: reviewEvents,
    });
  };

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const patch = { ...FOOTBALL_DEFAULTS };
      Object.keys(FOOTBALL_DEFAULTS).forEach((key) => {
        patch[key] = settings[key];
      });
      if (recordId) await base44.entities.ProviderSettings.update(recordId, patch);
      else {
        const created = await base44.entities.ProviderSettings.create({ provider: "api_football", ...patch });
        setRecordId(created.id);
      }
      await logAdminAction({
        actor,
        action: "provider.football_settings_updated",
        targetType: "ProviderSettings",
        targetId: recordId || "novo",
        details: `API-Football ${patch.football_enabled ? "habilitada" : "desabilitada"} · limite diário ${patch.football_daily_limit} · janela ${patch.football_window_days} dia(s)`,
        severity: "warning",
      });
      toast({ title: "Configurações salvas" });
      await load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const runSync = async (mode) => {
    setRunning(true);
    try {
      const response = await base44.functions.invoke("syncFootball", { mode, trigger: "manual" });
      const data = response.data || {};
      if (data.error) toast({ title: "Falha na sincronização", description: data.error, variant: "destructive" });
      else if (data.skipped) toast({ title: "Nada a sincronizar", description: data.reason });
      else toast({ title: "Sincronização concluída", description: data.summary });
      await load();
    } catch (error) {
      toast({ title: "Falha na sincronização", description: error.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  if (!settings) return <div className="card-surface h-40 animate-pulse" />;

  const used = Number(quota?.used || 0);
  const limit = Number(settings.football_daily_limit || 100);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;
  const level = Number(quota?.level || 0);
  const errors = logs.filter((row) => row.error_message || (row.status_code && row.status_code >= 400));

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Integração API-Football v3</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Calendário, placares ao vivo e resultados oficiais. A chave fica guardada como segredo do backend; o
              navegador nunca fala com a API-Football. O frontend consome apenas os dados armazenados.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => runSync("calendar")} disabled={running}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              Calendário
            </Button>
            <Button size="sm" onClick={() => runSync("auto")} disabled={running}>
              <Activity className="mr-2 h-3.5 w-3.5" />
              Sincronizar agora
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Orçamento de hoje"
            value={`${used}/${limit}`}
            hint={`${percent}% utilizado · ${LEVEL_LABEL[level] || LEVEL_LABEL[0]}`}
          />
          <Stat
            label="Quota do provedor"
            value={quota?.provider_remaining ?? settings.football_account_remaining ?? "—"}
            hint={`restantes · limite ${quota?.provider_limit ?? settings.football_account_limit ?? "—"}`}
          />
          <Stat
            label="Última sincronização"
            value={settings.football_last_sync_at ? timeAgo(settings.football_last_sync_at) : "nunca"}
            hint={settings.football_last_status || "—"}
          />
          <Stat
            label="Estado"
            value={settings.football_enabled ? "Ativa" : "Desligada"}
            hint={settings.football_plan ? `plano ${settings.football_plan}` : "plano não informado"}
          />
        </div>

        <Progress value={percent} />

        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>• Última leitura de placares: {settings.football_last_live_at ? timeAgo(settings.football_last_live_at) : "nunca"}</li>
          <li>• Último calendário completo: {settings.football_last_calendar_at ? timeAgo(settings.football_last_calendar_at) : "nunca"}</li>
          <li>• Próxima execução prevista: {settings.football_next_run_at ? formatDateTime(settings.football_next_run_at) : "—"}</li>
          <li>• Resumo: {settings.football_last_summary || "—"}</li>
          <li>• Alertas de consumo: {quota?.alerts?.length ? quota.alerts.join(", ") : "nenhum"}</li>
          <li>• Alcance do calendário: {settings.football_plan_note || "sem restrição registrada para o plano atual"}</li>
        </ul>

        {settings.football_last_error ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {settings.football_last_error}
          </p>
        ) : null}
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Parâmetros de sincronização</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="fb_limit">Limite diário interno</Label>
            <Input id="fb_limit" type="number" value={settings.football_daily_limit} onChange={(event) => update({ football_daily_limit: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">Alertas em 60%, 80% e 95%. Não é o limite oficial do provedor.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_days">Dias do calendário</Label>
            <Input id="fb_days" type="number" min="1" max="7" value={settings.football_window_days} onChange={(event) => update({ football_window_days: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_cal">Calendário (horas)</Label>
            <Input id="fb_cal" type="number" value={Math.round(Number(settings.football_calendar_refresh_seconds || 0) / 3600)} onChange={(event) => update({ football_calendar_refresh_seconds: Number(event.target.value) * 3600 })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_live">Placar com apostas pendentes (segundos)</Label>
            <Input id="fb_live" type="number" value={settings.football_live_refresh_seconds} onChange={(event) => update({ football_live_refresh_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_idle">Placar sem apostas (segundos)</Label>
            <Input id="fb_idle" type="number" value={settings.football_live_idle_seconds} onChange={(event) => update({ football_live_idle_seconds: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_discover">Busca de novos jogos (segundos)</Label>
            <Input id="fb_discover" type="number" value={settings.football_live_discover_seconds} onChange={(event) => update({ football_live_discover_seconds: Number(event.target.value) })} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Integração API-Football habilitada
            <Switch checked={Boolean(settings.football_enabled)} onCheckedChange={(value) => update({ football_enabled: value })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Criar partidas das competições ativas
            <Switch checked={Boolean(settings.football_create_events)} onCheckedChange={(value) => update({ football_create_events: value })} />
          </label>
        </div>

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar configurações
        </Button>
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Consolidação das apostas</h2>
        {counts ? (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Ganhas" value={counts.won} />
            <Stat label="Perdidas" value={counts.lost} />
            <Stat label="Anuladas" value={counts.void} />
            <Stat label="Em aberto" value={counts.open} hint={`${counts.selectionsOpen} seleção(ões) pendente(s)`} />
            <Stat label="Revisão manual" value={counts.review} hint={`${counts.eventsReview} partida(s)`} />
          </div>
        ) : (
          <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />
        )}
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Cache compartilhado</h2>
        {cache.length ? (
          <ul className="space-y-1.5 text-xs">
            {cache.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5">
                <span className="font-medium">{row.key}</span>
                <span className="text-muted-foreground">
                  {row.records} registro(s) · coletado {timeAgo(row.fetched_at)}
                  {row.expires_at ? ` · válido por ${Math.max(0, Math.round((Date.parse(row.expires_at) - Date.now()) / 60000))} min` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhuma resposta armazenada ainda.</p>
        )}
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Execuções e erros recentes</h2>
        <ul className="space-y-1.5 text-xs">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-1.5">
              <span>
                {job.status} · {job.job_type} · {job.requests_used} chamada(s) · {job.records_upserted} registro(s)
              </span>
              <span className="text-muted-foreground">{timeAgo(job.started_at || job.created_date)}</span>
            </li>
          ))}
          {!jobs.length ? <li className="text-muted-foreground">Nenhuma execução registrada.</li> : null}
        </ul>
        {errors.length ? (
          <ul className="space-y-1 text-xs text-amber-300">
            {errors.map((row) => (
              <li key={row.id}>
                {row.endpoint} · {timeAgo(row.created_date)} · {row.error_message || `HTTP ${row.status_code}`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sem erros recentes.</p>
        )}
      </section>
    </div>
  );
}
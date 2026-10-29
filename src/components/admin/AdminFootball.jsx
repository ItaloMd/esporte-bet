import React, { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, RefreshCw, Save, SearchCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime, timeAgo } from "@/lib/format";

const FOOTBALL_DEFAULTS = {
  football_enabled: false,
  football_base_url: "https://v3.football.api-sports.io",
  football_daily_limit: 100,
  football_minute_limit: 60,
  football_window_days: 2,
  football_calendar_refresh_seconds: 21600,
  football_create_events: true,
  football_audit_offset_hours: 2,
  football_audit_recheck_minutes: 30,
  football_audit_fast_minutes: 15,
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
        base44.entities.ApiUsageLog.filter({ provider: "api_football" }, { sort: "-created_date", limit: 12 }),
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
      if (!recordId) {
        const created = await base44.entities.ProviderSettings.create({ provider: "api_football" });
        setRecordId(created.id);
      }
      const response = await base44.functions.invoke("apiFootballCentral", { action: "update_settings", patch });
      const payload = response.data || {};
      if (payload.error) throw new Error(payload.error);
      toast({
        title: "Configurações salvas",
        description: payload.rejected?.length
          ? `Fora da faixa e ignorados: ${payload.rejected.map((row) => row.field).join(", ")}`
          : "Validadas e aplicadas em todas as rotinas.",
      });
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

  /** Ciclo completo em um clique: importação, auditoria, cotações e liquidação. */
  const runAuditNow = async () => {
    setRunning(true);
    try {
      const steps = [
        { fn: "syncFootball", args: { mode: "calendar", trigger: "manual" }, label: "Calendário importado" },
        { fn: "syncFootball", args: { mode: "audit", trigger: "manual" }, label: "Partidas auditadas" },
        { fn: "syncFootballOdds", args: { mode: "auto", trigger: "manual" }, label: "Cotações atualizadas" },
        { fn: "settleMatches", args: { trigger: "manual" }, label: "Bilhetes liquidados" },
      ];
      for (const step of steps) {
        const response = await base44.functions.invoke(step.fn, step.args);
        const data = response.data || {};
        if (data.error) {
          toast({ title: "Falha na etapa", description: `${step.fn}: ${data.error}`, variant: "destructive" });
          break;
        }
        toast({ title: step.label, description: data.summary || data.reason || "" });
      }
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
              Calendário e resultados oficiais com economia de créditos: importação diária em lote e auditoria de
              encerramento. A chave fica guardada como segredo do backend; o navegador nunca fala com a API-Football.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => runSync("calendar")} disabled={running}>
              <CalendarClock className={`mr-2 h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              Importar calendário
            </Button>
            <Button size="sm" onClick={runAuditNow} disabled={running}>
              <SearchCheck className="mr-2 h-3.5 w-3.5" />
              Auditar agora
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
            label="Última execução"
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
          <li>• Importação automática: todo dia às 00:10, buscando {Number(settings.football_window_days || 2)} dia(s), sempre incluindo o dia atual e o seguinte.</li>
          <li>• Última importação completa: {settings.football_last_calendar_at ? timeAgo(settings.football_last_calendar_at) : "nunca"}</li>
          <li>• Próxima auditoria prevista: {settings.football_next_run_at ? formatDateTime(settings.football_next_run_at) : "nenhuma partida agendada"}</li>
          <li>• Resumo da última execução: {settings.football_last_summary || "—"}</li>
          <li>• Alertas de consumo: {quota?.alerts?.length ? quota.alerts.join(", ") : "nenhum"}</li>
        </ul>

        {settings.football_last_error ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {settings.football_last_error}
          </p>
        ) : null}
      </section>

      <section className="card-surface space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Como os créditos são economizados</h2>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            <li>• Uma chamada por data na importação: todo dia às 00:10, a rotina busca o dia e o dia seguinte em lote (1 crédito por data).</li>
            <li>• Nenhuma consulta durante o jogo: a primeira auditoria de cada partida acontece 2 horas depois do horário de início previsto.</li>
            <li>• Se a partida ainda estiver em andamento, nova verificação em 30 minutos; a partir da segunda verificação, a cada 15 minutos até encerrar.</li>
            <li>• Encerrada (tempo normal, prorrogação ou pênaltis), o resultado é gravado e a partida nunca mais é consultada.</li>
            <li>• As auditorias consultam até 20 partidas em uma única chamada.</li>
          </ul>
        </div>
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Parâmetros de sincronização</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="fb_limit">Limite diário interno</Label>
            <Input id="fb_limit" type="number" value={settings.football_daily_limit} onChange={(event) => update({ football_daily_limit: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Teto de créditos que as rotinas podem gastar por dia. Alertas em 60%, 80% e 95%. Não é o limite real do
              provedor — o valor oficial aparece no cartão "Quota do provedor".
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_minute">Limite por minuto</Label>
            <Input id="fb_minute" type="number" min="3" max="300" value={settings.football_minute_limit} onChange={(event) => update({ football_minute_limit: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Teto compartilhado de requisições por minuto entre todas as rotinas — sempre abaixo do limite do plano
              (300/min). Ao atingir, as rotinas esperam o próximo minuto em vez de receber 429 do provedor; o dado
              confirmado permanece e a revalidação retoma sozinha.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_days">Dias importados por dia</Label>
            <Input id="fb_days" type="number" min="1" max="7" value={settings.football_window_days} onChange={(event) => update({ football_window_days: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Quantos dias a importação das 00:10 busca, sempre incluindo o dia atual. Padrão 2: hoje e amanhã.
              O botão "Auditar agora" faz o ciclo completo — importação, auditoria, cotações e liquidação — na hora.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_cal">Validade do cache (horas)</Label>
            <Input id="fb_cal" type="number" value={Math.round(Number(settings.football_calendar_refresh_seconds || 0) / 3600)} onChange={(event) => update({ football_calendar_refresh_seconds: Number(event.target.value) * 3600 })} />
            <p className="text-[11px] text-muted-foreground">
              Depois de importar uma data, ela não é consultada de novo enquanto o cache estiver válido — evita gastar
              crédito reimportando o mesmo dia em execuções seguidas.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_audit_offset">Primeira auditoria (horas após o início)</Label>
            <Input id="fb_audit_offset" type="number" min="1" max="6" value={settings.football_audit_offset_hours} onChange={(event) => update({ football_audit_offset_hours: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Nenhuma consulta é feita antes desse horário. A primeira auditoria acontece no início previsto da partida
              mais essas horas — o momento em que a maioria dos jogos já encerrou (padrão 2).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_recheck">Reavaliação (minutos)</Label>
            <Input id="fb_recheck" type="number" value={settings.football_audit_recheck_minutes} onChange={(event) => update({ football_audit_recheck_minutes: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Se na primeira auditoria a partida ainda estiver em andamento, uma nova verificação é agendada em X
              minutos (padrão 30).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_fast">Verificações seguintes (minutos)</Label>
            <Input id="fb_fast" type="number" value={settings.football_audit_fast_minutes} onChange={(event) => update({ football_audit_fast_minutes: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              A partir da segunda verificação sem encerramento, novas consultas a cada X minutos até a partida terminar
              (padrão 15). Ao encerrar, a partida nunca mais é consultada.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Integração API-Football habilitada
            <Switch checked={Boolean(settings.football_enabled)} onCheckedChange={(value) => update({ football_enabled: value })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Criar partidas dos dias importados
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
        <h2 className="text-sm font-semibold">Execuções e logs de auditoria</h2>
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
        {logs.length ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {logs.map((row) => (
              <li key={row.id} className="border-b border-border/40 pb-1">
                {row.endpoint} · {row.params || "—"} · {timeAgo(row.created_date)}
                {row.note ? ` · ${row.note}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Sem consultas registradas ainda.</p>
        )}
        {errors.length ? (
          <ul className="space-y-1 text-xs text-amber-300">
            {errors.map((row) => (
              <li key={row.id}>
                {row.endpoint} · {timeAgo(row.created_date)} · {row.error_message || `HTTP ${row.status_code}`}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
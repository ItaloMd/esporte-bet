import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, RefreshCw, Signal } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { logAdminAction } from "@/lib/adminAudit";

const TIME_ZONE = "America/Bahia";

function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function Stat({ label, value, hint }) {
  return (
    <div className="card-surface px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold leading-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function AdminProviderStats({ actor }) {
  const [state, setState] = useState(null);
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const now = new Date();
    const today = localToday();
    const [
      settingsPage,
      sportsPage,
      upcoming,
      todayEvents,
      withOdds,
      withoutOdds,
      staleOdds,
      competitions,
      bookmakers,
      marketUsage,
      jobs,
      usagePage,
      quotaPage,
      offeredOdds,
    ] = await Promise.all([
      base44.entities.ProviderSettings.list({ limit: 1 }),
      base44.entities.Sport.list({ limit: 200 }),
      base44.entities.Event.count({ source: "provider", start_time: { $gte: now.toISOString() } }),
      base44.entities.Event.count({ source: "provider", local_date: today }),
      base44.entities.Event.count({ source: "provider", odds_status: "available" }),
      base44.entities.Event.count({ source: "provider", odds_status: "unavailable" }),
      base44.entities.Event.count({ source: "provider", odds_status: "stale" }),
      base44.entities.Competition.count({ active: true }),
      base44.entities.Odd.list({ distinct: "bookmaker" }),
      base44.entities.Odd.aggregate({ query: {}, groupBy: "market_key" }),
      base44.entities.SyncJob.filter({ provider: "api_football", job_type: "odds" }, { sort: "-created_date", limit: 8 }),
      base44.entities.ApiUsageLog.filter({ provider: "api_football" }, { sort: "-created_date", limit: 40 }),
      base44.entities.ApiQuota.filter({ provider: "api_football", day: today }, { limit: 1 }),
      base44.entities.Odd.count({ quote_state: "offered" }),
    ]);

    setState({
      settings: settingsPage.items?.[0] || null,
      sports: sportsPage.items || [],
      upcoming,
      todayEvents,
      withOdds,
      withoutOdds,
      staleOdds,
      competitions,
      bookmakers: (bookmakers.items || []).length,
      marketUsage: marketUsage.rows || [],
      jobs: jobs.items || [],
      usage: (usagePage.items || []).filter((row) => String(row.endpoint || "").includes("/odds")),
      quota: quotaPage.items?.[0] || null,
      offeredOdds,
      today,
    });
  }, []);

  useEffect(() => {
    load().catch((loadError) => setError(loadError.message || "Falha ao carregar métricas."));
  }, [load]);

  const runNow = async (mode, label) => {
    setRunning(mode);
    try {
      const response = await base44.functions.invoke("syncFootballOdds", { mode, trigger: "manual", force: true });
      const result = response.data || {};
      await logAdminAction({
        actor,
        action: "provider.odds_sync_manual",
        targetType: "ProviderSettings",
        details: `modo ${mode} · ${result.odds || 0} cotações · ${result.calls || 0} chamada(s)`,
      });
      if (result.skipped) {
        toast({ title: "Execução ignorada", description: result.reason });
      } else if (result.error) {
        toast({ title: "Falha na sincronização", description: result.error, variant: "destructive" });
      } else {
        toast({
          title: `${label} concluído`,
          description: `${result.events_with_odds || 0} partidas · ${result.odds || 0} cotações · ${result.calls || 0} chamada(s)`,
        });
      }
      await load();
    } catch (runError) {
      toast({
        title: "Falha na sincronização",
        description: runError.response?.data?.error || runError.message,
        variant: "destructive",
      });
    } finally {
      setRunning("");
    }
  };

  if (error) {
    return (
      <section className="card-surface px-4 py-4">
        <p className="text-sm text-destructive">{error}</p>
      </section>
    );
  }

  if (!state) return <div className="card-surface h-56 animate-pulse" />;

  const { settings } = state;
  const used = Number(state.quota?.used || 0);
  const limit = Number(settings?.football_daily_limit || 100);
  const quotaPercent = limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;
  const lastJob = state.jobs[0] || null;
  const failures = state.jobs.filter((job) => job.status === "error");

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Cotações via API-Football</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Uma coleta por hora para os jogos de hoje e de amanhã, sempre antes do início das partidas. A margem da
              casa é aplicada sobre o mercado completo e o orçamento é compartilhado com a leitura de placares.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => runNow("today", "Odds de hoje")} disabled={Boolean(running)}>
              {running === "today" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Coletar hoje
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runNow("upcoming", "Odds de hoje e amanhã")}
              disabled={Boolean(running)}
            >
              {running === "upcoming" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Hoje e amanhã
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Modalidades"
            value={formatNumber(state.sports.length)}
            hint={`${state.sports.filter((sport) => sport.odds_available).length} com odds coletadas`}
          />
          <Stat
            label="Competições ativas"
            value={formatNumber(state.competitions)}
            hint="futebol da API-Football"
          />
          <Stat label="Eventos futuros" value={formatNumber(state.upcoming)} hint="pré-jogo armazenados" />
          <Stat label="Eventos de hoje" value={formatNumber(state.todayEvents)} hint={`dia local ${state.today}`} />
          <Stat
            label="Com cotações"
            value={formatNumber(state.withOdds)}
            hint={`${formatNumber(state.staleOdds)} desatualizado(s)`}
          />
          <Stat label="Sem cotações" value={formatNumber(state.withoutOdds)} hint="sem preço válido na fonte" />
          <Stat
            label="Cotações oferecidas"
            value={formatNumber(state.offeredOdds)}
            hint={`${formatNumber(state.bookmakers)} casa(s) de referência`}
          />
          <Stat
            label="Falhas recentes"
            value={formatNumber(failures.length)}
            hint={`${formatNumber(settings?.skipped_queries || 0)} consulta(s) adiada(s)`}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Última coleta de odds"
            value={lastJob?.finished_at ? timeAgo(lastJob.finished_at) : "nunca"}
            hint={lastJob ? `${formatNumber(lastJob.records_upserted || 0)} cotação(ões) gravada(s)` : ""}
          />
          <Stat
            label="Orçamento de hoje"
            value={`${formatNumber(used)}/${formatNumber(limit)}`}
            hint={`${quotaPercent}% utilizado · nível ${Number(state.quota?.level || 0)}`}
          />
          <Stat
            label="Quota do provedor"
            value={
              state.quota?.provider_remaining === undefined || state.quota?.provider_remaining === null
                ? "—"
                : formatNumber(state.quota.provider_remaining)
            }
            hint="chamadas restantes informadas pela fonte"
          />
        </div>

        <div className="rounded-lg border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Como o orçamento é usado</p>
          <p className="mt-1">
            Cada coleta consome uma chamada por página e fica válida por uma hora. O plano atual libera até três
            páginas por data, o que cobre cerca de 30 partidas por dia. Dez chamadas por execução ficam reservadas
            para a leitura de placares ao vivo; quando o consumo passa de 80%, as cotações são suspensas antes dos
            placares.
          </p>
          {settings?.skipped_reason ? <p className="mt-1 text-amber-400">{settings.skipped_reason}</p> : null}
        </div>

        {lastJob ? (
          <p className="text-[11px] text-muted-foreground">
            <Signal className="mr-1 inline h-3 w-3" aria-hidden="true" />
            Última execução: {lastJob.status} · {formatNumber(lastJob.requests_used || 0)} chamada(s) ·{" "}
            {formatDateTime(lastJob.started_at || lastJob.created_date)}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="card-surface p-4">
          <h3 className="text-sm font-semibold">Mercados disponíveis por modalidade</h3>
          <div className="mt-2 space-y-1.5">
            {state.sports.filter((sport) => sport.markets_available?.length).length ? (
              state.sports
                .filter((sport) => sport.markets_available?.length)
                .map((sport) => (
                  <div key={sport.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium">{sport.name}</span>
                    <span className="text-muted-foreground">
                      {sport.markets_available.join(", ")} · {sport.in_season ? "em temporada" : "fora de temporada"}
                    </span>
                  </div>
                ))
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma cotação coletada ainda. Rode uma coleta para mapear os mercados reais de cada modalidade.
              </p>
            )}
          </div>
        </div>

        <div className="card-surface p-4">
          <h3 className="text-sm font-semibold">Cotações armazenadas por mercado</h3>
          <div className="mt-2 space-y-1.5">
            {state.marketUsage.length ? (
              state.marketUsage.map((row) => (
                <div key={row.market_key || "outro"} className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">{row.market_key || "sem mercado"}</span>
                  <span className="text-muted-foreground">{formatNumber(row.count)} cotações</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma cotação armazenada.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="card-surface p-4">
          <h3 className="text-sm font-semibold">Coletas recentes</h3>
          <div className="mt-2 space-y-2">
            {state.jobs.length ? (
              state.jobs.map((job) => (
                <div key={job.id} className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    <span className="font-medium">odds</span> · {job.trigger} ·{" "}
                    {formatDateTime(job.started_at || job.created_date)}
                  </span>
                  <span
                    className={
                      job.status === "error"
                        ? "text-destructive"
                        : job.status === "running"
                          ? "text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {job.status} · {formatNumber(job.records_upserted || 0)} cotações
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma coleta registrada.</p>
            )}
          </div>
        </div>

        <div className="card-surface p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Chamadas recentes e falhas
          </h3>
          <div className="mt-2 space-y-2">
            {state.usage.length ? (
              state.usage.map((log) => (
                <div key={log.id} className="text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-muted-foreground">{log.endpoint}</span>
                    <span>{formatNumber(log.records_returned || 0)} partida(s)</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(log.created_date)} · {log.params || "parâmetros não registrados"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma chamada registrada.</p>
            )}
            {lastJob?.error_message ? (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {lastJob.error_message}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Coins, Loader2, RefreshCw, Signal } from "lucide-react";
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
      base44.entities.SyncJob.filter({}, { sort: "-created_date", limit: 8 }),
      base44.entities.ApiUsageLog.filter({}, { sort: "-created_date", limit: 6 }),
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
      usage: usagePage.items || [],
      today,
    });
  }, []);

  useEffect(() => {
    load().catch((loadError) => setError(loadError.message || "Falha ao carregar métricas."));
  }, [load]);

  const runNow = async (mode, label) => {
    setRunning(mode);
    try {
      const response = await base44.functions.invoke("syncOdds", { mode, trigger: "manual", force: true });
      const result = response.data || {};
      await logAdminAction({
        actor,
        action: "provider.sync_manual",
        targetType: "ProviderSettings",
        details: `modo ${mode} · ${result.odds || 0} cotações · ${result.usage?.cost || 0} créditos`,
      });
      if (result.skipped) {
        toast({ title: "Execução ignorada", description: result.reason });
      } else if (result.error) {
        toast({ title: "Falha na sincronização", description: result.error, variant: "destructive" });
      } else {
        toast({
          title: `${label} concluído`,
          description: `${result.events || 0} eventos · ${result.odds || 0} cotações · ${result.usage?.cost || 0} créditos`,
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
  const markets = settings?.markets?.length || 3;
  const regions = settings?.regions?.length || 1;
  const leaguesPerRun = settings?.max_sports_per_run || 6;
  const perRun = leaguesPerRun * markets * regions;
  const estimatedDaily = perRun * 25;
  const budget = Number(settings?.budget_credits) || 0;
  const used = Number(settings?.credits_used) || 0;
  const percent = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const enabledSports = state.sports.filter((sport) => (settings?.sports || []).includes(sport.slug));
  const failures = state.jobs.filter((job) => job.status === "error");

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Sincronização The Odds API</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Rotina horária para os jogos de hoje e rotina diária para os próximos sete dias. Odds ao vivo não são
              coletadas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => runNow("today", "Jogos de hoje")} disabled={Boolean(running)}>
              {running === "today" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sincronizar hoje
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runNow("upcoming", "Próximos 7 dias")}
              disabled={Boolean(running)}
            >
              {running === "upcoming" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sincronizar 7 dias
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runNow("catalog", "Catálogo")}
              disabled={Boolean(running)}
            >
              {running === "catalog" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Atualizar catálogo
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
            label="Ligas em temporada"
            value={formatNumber(state.competitions)}
            hint={enabledSports.length ? `${enabledSports.length} habilitadas` : "todas habilitadas"}
          />
          <Stat label="Eventos futuros" value={formatNumber(state.upcoming)} hint="pré-jogo armazenados" />
          <Stat label="Eventos de hoje" value={formatNumber(state.todayEvents)} hint={`dia local ${state.today}`} />
          <Stat
            label="Com odds"
            value={formatNumber(state.withOdds)}
            hint={`${formatNumber(state.staleOdds)} desatualizado(s)`}
          />
          <Stat label="Sem odds" value={formatNumber(state.withoutOdds)} hint="sem cotação na fonte" />
          <Stat label="Casas de apostas" value={formatNumber(state.bookmakers)} hint="representadas no banco" />
          <Stat
            label="Erros recentes"
            value={formatNumber(failures.length)}
            hint={`${formatNumber(settings?.skipped_queries || 0)} consulta(s) adiada(s)`}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Última coleta de hoje"
            value={settings?.today_sync_at ? timeAgo(settings.today_sync_at) : "nunca"}
            hint={settings?.next_today_run_at ? `próxima ${formatDateTime(settings.next_today_run_at)}` : ""}
          />
          <Stat
            label="Última coleta futura"
            value={settings?.upcoming_sync_at ? timeAgo(settings.upcoming_sync_at) : "nunca"}
            hint={settings?.next_upcoming_run_at ? `próxima ${formatDateTime(settings.next_upcoming_run_at)}` : ""}
          />
          <Stat
            label="Catálogo"
            value={settings?.catalog_sync_at ? timeAgo(settings.catalog_sync_at) : "nunca"}
            hint="revalidado a cada 24 horas"
          />
          <Stat
            label="Créditos usados (período)"
            value={formatNumber(used)}
            hint={budget > 0 ? `${percent.toFixed(1)}% do orçamento de ${formatNumber(budget)}` : "sem orçamento definido"}
          />
          <Stat
            label="Créditos restantes (fonte)"
            value={settings?.credits_remaining === undefined || settings?.credits_remaining === null ? "—" : formatNumber(settings.credits_remaining)}
            hint="informado pela própria API"
          />
          <Stat
            label="Custo por execução"
            value={`${formatNumber(perRun)} créditos`}
            hint={`${leaguesPerRun} ligas × ${markets} mercados × ${regions} região(ões)`}
          />
        </div>

        <div className="rounded-lg border border-border px-3 py-2.5 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Coins className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Estimativa de consumo
          </p>
          <p className="mt-1">
            Até {formatNumber(estimatedDaily)} créditos por dia se todas as execuções encontrarem o número máximo de
            ligas com jogos (24 execuções horárias + 1 diária). O limite diário configurado é de{" "}
            {formatNumber(settings?.daily_request_limit || 0)} créditos — acima disso, as consultas não essenciais são
            suspensas e os dados já armazenados permanecem no ar.
          </p>
          {settings?.skipped_reason ? <p className="mt-1 text-amber-400">{settings.skipped_reason}</p> : null}
        </div>

        {settings?.last_run_summary ? (
          <p className="text-[11px] text-muted-foreground">
            <Signal className="mr-1 inline h-3 w-3" aria-hidden="true" />
            Última execução: {settings.last_run_summary}
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
                Nenhuma cotação coletada ainda. Rode uma sincronização para mapear os mercados reais de cada
                modalidade.
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
          <h3 className="text-sm font-semibold">Execuções recentes</h3>
          <div className="mt-2 space-y-2">
            {state.jobs.length ? (
              state.jobs.map((job) => (
                <div key={job.id} className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    <span className="font-medium">{job.job_type}</span> · {job.trigger} ·{" "}
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
                    {job.status} · {formatNumber(job.requests_used || 0)} créditos
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma execução registrada.</p>
            )}
          </div>
        </div>

        <div className="card-surface p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Coletas recentes e falhas
          </h3>
          <div className="mt-2 space-y-2">
            {state.usage.length ? (
              state.usage.map((log) => (
                <div key={log.id} className="text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-muted-foreground">{log.endpoint}</span>
                    <span>{formatNumber(log.credits_used || 0)} créditos</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(log.created_date)} · {log.params || "parâmetros não registrados"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma chamada registrada.</p>
            )}
            {settings?.last_error ? (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {settings.last_error}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
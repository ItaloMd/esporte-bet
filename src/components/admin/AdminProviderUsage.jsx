import React, { useEffect, useState } from "react";
import { AlertTriangle, Radio, TrendingUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";

const LEVEL_LABEL = {
  0: "Operação normal",
  1: "Reduzindo atualizações não essenciais",
  2: "Somente apostas pendentes e resultados finais",
  3: "Contingência: consultas não essenciais bloqueadas",
};

/** Início do dia operacional no calendário brasileiro, igual ao usado no backend. */
function startOfDaySaoPaulo() {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="score-num text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function StatusPill({ status }) {
  const tone =
    status === "success"
      ? "border-emerald-500/40 text-emerald-400"
      : status === "partial"
        ? "border-amber-500/40 text-amber-300"
        : status === "error"
          ? "border-destructive/50 text-destructive"
          : "border-border text-muted-foreground";
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>
      {status || "—"}
    </span>
  );
}

export default function AdminProviderUsage() {
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const since = startOfDaySaoPaulo();
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    Promise.all([
      base44.entities.ProviderSettings.list({ limit: 1 }),
      base44.entities.ApiQuota.filter({ provider: "api_football", day }, { limit: 1 }),
      base44.entities.ApiCache.filter({ provider: "api_football" }, { sort: "-fetched_at", limit: 20 }),
      base44.entities.ApiUsageLog.filter({ provider: "api_football" }, { sort: "-created_date", limit: 40 }),
      base44.entities.SyncJob.filter({ provider: "api_football" }, { sort: "-created_date", limit: 8 }),
      base44.entities.Event.count({ source: "provider", odds_status: "available" }),
      base44.entities.Odd.count({ quote_state: "offered" }),
      base44.entities.Market.count({ status: "open" }),
    ])
      .then(([settingsPage, quotaPage, cachePage, logPage, jobPage, eventsWithOdds, offeredOdds, openMarkets]) => {
        if (!active) return;
        setState({
          settings: settingsPage.items?.[0] || {},
          quota: quotaPage.items?.[0] || null,
          cache: cachePage.items || [],
          logs: logPage.items || [],
          jobs: jobPage.items || [],
          eventsWithOdds,
          offeredOdds,
          openMarkets,
          since,
        });
      })
      .catch(() => active && setFailed(true));

    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="card-surface px-4 py-3 text-xs text-muted-foreground">
        Não foi possível carregar o uso dos provedores agora.
      </p>
    );
  }

  if (!state) return <div className="card-surface h-40 animate-pulse" />;

  const { settings, quota } = state;
  const used = Number(quota?.used || 0);
  const limit = Number(settings.football_daily_limit || 100);
  const percent = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
  const level = Number(quota?.level || 0);

  const dataCache = state.cache.filter((row) => String(row.key || "").startsWith("fixtures:"));
  const oddsCache = state.cache.filter((row) => String(row.key || "").startsWith("odds:date:"));
  const oddsJob = state.jobs.find((job) => job.job_type === "odds") || null;
  const dataJob = state.jobs.find((job) => job.job_type === "results") || null;
  const callsToday = state.logs.filter((row) => Date.parse(row.created_date) >= Date.parse(state.since));
  const oddsCallsToday = callsToday.filter((row) => String(row.endpoint || "").includes("/odds"));
  const nextOdds = oddsCache
    .map((row) => Date.parse(row.expires_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const error = settings.football_last_error || state.logs.find((row) => row.error_message)?.error_message || "";

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="card-surface space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Radio className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              API-Football · jogos e placares
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Calendário, placares e resultados oficiais.{" "}
              {settings.football_enabled
                ? `Plano ${settings.football_plan || "não informado"} · chave guardada como segredo do backend`
                : "Integração desligada."}
            </p>
          </div>
          <StatusPill status={settings.football_last_status} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Metric
            label="Orçamento de hoje"
            value={`${formatNumber(used)}/${formatNumber(limit)}`}
            hint={`${percent}% · ${LEVEL_LABEL[level] || LEVEL_LABEL[0]}`}
          />
          <Metric
            label="Quota do provedor"
            value={quota?.provider_remaining ?? settings.football_account_remaining ?? "—"}
            hint={`restantes · limite ${quota?.provider_limit ?? settings.football_account_limit ?? "—"}`}
          />
          <Metric
            label="Chamadas hoje"
            value={formatNumber(callsToday.length)}
            hint={`${formatNumber(dataCache.length)} resposta(s) em cache`}
          />
          <Metric
            label="Última leitura de placares"
            value={settings.football_last_sync_at ? timeAgo(settings.football_last_sync_at) : "nunca"}
            hint={
              dataJob
                ? `${formatNumber(dataJob.requests_used || 0)} chamada(s) · ${formatNumber(dataJob.records_upserted || 0)} registro(s)`
                : "sem execução registrada"
            }
          />
        </div>

        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>
            • Próxima execução: {settings.football_next_run_at ? formatDateTime(settings.football_next_run_at) : "—"}
          </li>
          <li>• Último resumo: {settings.football_last_summary || "—"}</li>
          <li>• Alertas de consumo: {quota?.alerts?.length ? quota.alerts.join(", ") : "nenhum"}</li>
        </ul>

        {error ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
      </section>

      <section className="card-surface space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              API-Football · cotações
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Cotações pré-jogo dos jogos do dia e de amanhã, com a margem da casa aplicada sobre o mercado
              completo.
            </p>
          </div>
          <StatusPill status={oddsJob?.status} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Metric
            label="Partidas com cotações"
            value={formatNumber(state.eventsWithOdds)}
            hint={`${formatNumber(state.openMarkets)} mercado(s) aberto(s)`}
          />
          <Metric
            label="Cotações oferecidas"
            value={formatNumber(state.offeredOdds)}
            hint="seleções com preço válido"
          />
          <Metric
            label="Coletas de hoje"
            value={formatNumber(oddsCallsToday.length)}
            hint={`${formatNumber(oddsCache.length)} dia(s) em cache`}
          />
          <Metric
            label="Última coleta"
            value={oddsJob?.finished_at ? timeAgo(oddsJob.finished_at) : "nunca"}
            hint={
              oddsJob
                ? `${formatNumber(oddsJob.requests_used || 0)} chamada(s) · ${formatNumber(oddsJob.records_upserted || 0)} cotação(ões)`
                : "sem execução registrada"
            }
          />
        </div>

        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>• Próxima coleta prevista: {nextOdds ? formatDateTime(new Date(nextOdds).toISOString()) : "—"}</li>
          <li>
            • Dias em cache:{" "}
            {oddsCache.length
              ? oddsCache.map((row) => String(row.key).replace("odds:date:", "")).join(", ")
              : "nenhum"}
          </li>
          <li>• Chamadas reservadas para placares ao vivo: 10 por execução</li>
        </ul>

        {oddsJob?.error_message ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{oddsJob.error_message}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
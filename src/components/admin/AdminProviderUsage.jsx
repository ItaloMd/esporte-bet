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
      base44.entities.ApiCache.count({ provider: "api_football" }),
      base44.entities.ApiUsageLog.count({ provider: "api_football", created_date: { $gte: since } }),
      base44.entities.ApiUsageLog.count({ provider: "the_odds_api", created_date: { $gte: since } }),
      base44.entities.SyncJob.filter({ provider: "api_football" }, { sort: "-created_date", limit: 2 }),
      base44.entities.SyncJob.filter({ provider: "the_odds_api" }, { sort: "-created_date", limit: 2 }),
      base44.entities.ApiUsageLog.filter(
        { provider: "api_football", status_code: { $gte: 400 } },
        { sort: "-created_date", limit: 2 },
      ),
    ])
      .then(([settingsPage, quotaPage, cacheRows, footballCalls, oddsCalls, footballJobs, oddsJobs, footballErrors]) => {
        if (!active) return;
        setState({
          settings: settingsPage.items?.[0] || {},
          quota: quotaPage.items?.[0] || null,
          cacheRows,
          footballCalls,
          oddsCalls,
          footballJobs: footballJobs.items || [],
          oddsJobs: oddsJobs.items || [],
          footballErrors: footballErrors.items || [],
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
  const lastFootball = state.footballJobs[0] || null;
  const lastOdds = state.oddsJobs[0] || null;
  const footballError = settings.football_last_error || state.footballErrors[0]?.endpoint || "";

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="card-surface space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Radio className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              API-Football · dados de jogos
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
            value={formatNumber(state.footballCalls)}
            hint={`${formatNumber(state.cacheRows)} resposta(s) em cache`}
          />
          <Metric
            label="Última sincronização"
            value={settings.football_last_sync_at ? timeAgo(settings.football_last_sync_at) : "nunca"}
            hint={
              lastFootball
                ? `${formatNumber(lastFootball.requests_used || 0)} chamada(s) · ${formatNumber(lastFootball.records_upserted || 0)} registro(s)`
                : "sem execução registrada"
            }
          />
        </div>

        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>
            • Próxima execução: {settings.football_next_run_at ? formatDateTime(settings.football_next_run_at) : "—"}
          </li>
          <li>• Último resumo: {settings.football_last_summary || "—"}</li>
          <li>
            • Alertas de consumo: {quota?.alerts?.length ? quota.alerts.join(", ") : "nenhum"}
          </li>
        </ul>

        {footballError ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{footballError}</span>
          </p>
        ) : null}
      </section>

      <section className="card-surface space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              The Odds API · cotações
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {settings.provider === "the_odds_api" && settings.enabled
                ? "Mercados pré-jogo e placares das demais modalidades."
                : "Provedor de odds não habilitado."}
            </p>
          </div>
          <StatusPill status={settings.last_status} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Metric
            label="Créditos usados (período)"
            value={formatNumber(Number(settings.credits_used) || 0)}
            hint={
              Number(settings.budget_credits) > 0
                ? `${((Number(settings.credits_used) / Number(settings.budget_credits)) * 100).toFixed(1)}% do orçamento`
                : "sem orçamento definido"
            }
          />
          <Metric
            label="Créditos restantes (fonte)"
            value={
              settings.credits_remaining === undefined || settings.credits_remaining === null
                ? "—"
                : formatNumber(settings.credits_remaining)
            }
            hint="informado pela própria API"
          />
          <Metric
            label="Chamadas hoje"
            value={formatNumber(state.oddsCalls)}
            hint={`${formatNumber(settings.skipped_queries || 0)} consulta(s) adiada(s)`}
          />
          <Metric
            label="Última sincronização"
            value={settings.last_sync_at ? timeAgo(settings.last_sync_at) : "nunca"}
            hint={
              lastOdds
                ? `${formatNumber(lastOdds.requests_used || 0)} crédito(s) · ${formatNumber(lastOdds.records_upserted || 0)} registro(s)`
                : "sem execução registrada"
            }
          />
        </div>

        <ul className="space-y-1 text-[11px] text-muted-foreground">
          <li>
            • Próxima coleta de hoje:{" "}
            {settings.next_today_run_at ? formatDateTime(settings.next_today_run_at) : "—"}
          </li>
          <li>• Última execução: {settings.last_run_summary || "—"}</li>
          <li>• Situação do cache: validade de {formatNumber(settings.cache_ttl_seconds || 0)} s por resposta</li>
        </ul>

        {settings.last_error ? (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{settings.last_error}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
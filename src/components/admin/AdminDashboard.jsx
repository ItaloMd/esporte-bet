import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, Database, Link2, Radio, RefreshCw, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatDateTime, formatNumber, timeAgo } from "@/lib/format";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="card-surface px-4 py-3">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      <p className="score-num mt-2 text-2xl font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [state, setState] = useState({ loading: true, stats: null, logs: [], sync: [], errors: 0 });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [
        users, events, live, competitions, clicks, referrals, pendingReferrals,
        audit, syncJobs, usage, usageCached, privacyPending,
      ] = await Promise.all([
        base44.entities.User.list(),
        base44.entities.Event.count({}),
        base44.entities.Event.count({ status: "live" }),
        base44.entities.Competition.count({}),
        base44.entities.AffiliateClick.count({}),
        base44.entities.AffiliateReferral.count({}),
        base44.entities.AffiliateReferral.count({ status: "pending" }),
        base44.entities.AdminAuditLog.filter({}, { sort: "-created_date", limit: 6 }),
        base44.entities.SyncJob.filter({}, { sort: "-created_date", limit: 5 }),
        base44.entities.ApiUsageLog.count({}),
        base44.entities.ApiUsageLog.count({ cache_hit: true }),
        base44.entities.PrivacyRequest.count({ status: "pending" }),
      ]);
      if (!active) return;
      const errorCount = (syncJobs.items || []).filter((job) => job.status === "error").length;
      setState({
        loading: false,
        stats: {
          users: users.length,
          events,
          live,
          competitions,
          clicks,
          referrals,
          pendingReferrals,
          usage,
          usageCached,
          privacyPending,
          lastSync: syncJobs.items?.[0]?.finished_at || syncJobs.items?.[0]?.started_at || null,
        },
        logs: audit.items || [],
        sync: syncJobs.items || [],
        errors: errorCount,
      });
    };
    load().catch(() => setState((current) => ({ ...current, loading: false })));
    return () => {
      active = false;
    };
  }, []);

  if (state.loading) return <CardListSkeleton count={3} />;

  const stats = state.stats || {};
  const conversion = stats.clicks ? (stats.referrals / stats.clicks) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat icon={Users} label="Usuários cadastrados" value={formatNumber(stats.users)} />
        <Stat icon={Activity} label="Eventos disponíveis" value={formatNumber(stats.events)} hint={`${formatNumber(stats.live)} ao vivo`} />
        <Stat icon={Database} label="Competições monitoradas" value={formatNumber(stats.competitions)} />
        <Stat icon={RefreshCw} label="Última sincronização" value={stats.lastSync ? timeAgo(stats.lastSync) : "nunca"} />
        <Stat icon={Link2} label="Cliques em links de indicação" value={formatNumber(stats.clicks)} />
        <Stat icon={Users} label="Indicações atribuídas" value={formatNumber(stats.referrals)} hint={`${formatNumber(stats.pendingReferrals)} aguardando aprovação`} />
        <Stat icon={Activity} label="Taxa de conversão" value={`${conversion.toFixed(1)}%`} />
        <Stat icon={AlertTriangle} label="Erros de integração" value={formatNumber(state.errors)} hint={`${formatNumber(stats.usage)} requisições registradas`} />
      </div>

      <section className="card-surface px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Radio className="h-4 w-4 text-primary" aria-hidden="true" /> Status da integração de dados
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Provedor em modo demonstrativo. Os eventos exibidos são dados de simulação identificados na interface, e
          nenhuma credencial de provedor está armazenada em tabelas acessíveis ao jogador.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Consumo de requisições: {formatNumber(stats.usage)} · respostas em cache: {formatNumber(stats.usageCached)} ·
          solicitações de privacidade pendentes: {formatNumber(stats.privacyPending)}
        </p>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card-surface px-4 py-3">
          <h2 className="text-sm font-semibold">Atividades administrativas recentes</h2>
          <div className="mt-2 space-y-2">
            {state.logs.length ? (
              state.logs.map((log) => (
                <div key={log.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                  <p className="font-medium">{log.action}</p>
                  <p className="text-muted-foreground">
                    {log.actor_email || "sistema"} · {formatDateTime(log.created_date)}
                  </p>
                  {log.details && <p className="mt-0.5 text-muted-foreground">{log.details}</p>}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma atividade registrada.</p>
            )}
          </div>
        </section>

        <section className="card-surface px-4 py-3">
          <h2 className="text-sm font-semibold">Últimas sincronizações</h2>
          <div className="mt-2 space-y-2">
            {state.sync.length ? (
              state.sync.map((job) => (
                <div key={job.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                  <p className="font-medium">
                    {job.job_type} · {job.status}
                  </p>
                  <p className="text-muted-foreground">
                    {job.trigger} · {formatDateTime(job.started_at || job.created_date)}
                  </p>
                  {job.error_message && <p className="mt-0.5 text-destructive">{job.error_message}</p>}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma sincronização executada. Em modo demonstrativo, os dados são cadastrados manualmente.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
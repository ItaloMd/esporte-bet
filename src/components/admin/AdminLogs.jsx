import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime, formatNumber } from "@/lib/format";
import { logAdminAction } from "@/lib/adminAudit";

const REQUEST_LABEL = {
  access: "Acesso aos dados",
  correction: "Correção cadastral",
  deletion: "Exclusão de dados",
  consent: "Consentimentos",
  support: "Atendimento",
};

export default function AdminLogs({ actor }) {
  const [state, setState] = useState({ loading: true, audit: [], sync: [], usage: [], privacy: [] });
  const [responses, setResponses] = useState({});

  const load = async () => {
    setState((current) => ({ ...current, loading: true }));
    const [audit, sync, usage, privacy] = await Promise.all([
      base44.entities.AdminAuditLog.filter({}, { sort: "-created_date", limit: 40 }),
      base44.entities.SyncJob.filter({}, { sort: "-created_date", limit: 20 }),
      base44.entities.ApiUsageLog.filter({}, { sort: "-created_date", limit: 20 }),
      base44.entities.PrivacyRequest.filter({}, { sort: "-created_date", limit: 40 }),
    ]);
    setState({
      loading: false,
      audit: audit.items || [],
      sync: sync.items || [],
      usage: usage.items || [],
      privacy: privacy.items || [],
    });
  };

  useEffect(() => {
    load().catch(() => setState((current) => ({ ...current, loading: false })));
  }, []);

  const resolveRequest = async (request, status) => {
    try {
      await base44.entities.PrivacyRequest.update(request.id, {
        status,
        response: responses[request.id] || "",
        resolved_at: new Date().toISOString(),
      });
      await logAdminAction({
        actor,
        action: `privacy_request.${status}`,
        targetType: "PrivacyRequest",
        targetId: request.id,
        details: `Solicitação de ${request.type} atualizada.`,
        severity: "warning",
      });
      toast({ title: "Solicitação atualizada" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    }
  };

  if (state.loading) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Solicitações de privacidade e atendimento</h2>
        {state.privacy.length ? (
          state.privacy.map((request) => (
            <div key={request.id} className="card-surface space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">{REQUEST_LABEL[request.type] || request.type}</span>
                <span className="text-muted-foreground">
                  {formatDateTime(request.created_date)} · {request.status}
                </span>
              </div>
              {request.message && <p className="text-xs text-muted-foreground">{request.message}</p>}
              <Input
                placeholder="Resposta registrada para o jogador"
                value={responses[request.id] || ""}
                onChange={(event) => setResponses({ ...responses, [request.id]: event.target.value })}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => resolveRequest(request, "in_review")}>
                  Em análise
                </Button>
                <Button size="sm" onClick={() => resolveRequest(request, "completed")}>
                  Concluir
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => resolveRequest(request, "rejected")}>
                  Recusar
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma solicitação registrada.</p>
        )}
      </section>

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Logs técnicos de integração</h2>
        {state.sync.length || state.usage.length ? (
          <div className="mt-2 space-y-2">
            {state.sync.map((job) => (
              <p key={job.id} className="text-xs text-muted-foreground">
                [{job.status}] {job.job_type} · {job.provider} · {job.requests_used} requisições ·{" "}
                {formatNumber(job.records_upserted)} registros · {formatDateTime(job.started_at || job.created_date)}
              </p>
            ))}
            {state.usage.map((log) => (
              <p key={log.id} className="text-xs text-muted-foreground">
                {log.endpoint} · HTTP {log.status_code || "—"} · {log.duration_ms || 0}ms ·{" "}
                {log.cache_hit ? "cache" : "origem"} · {formatDateTime(log.created_date)}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Nenhuma chamada externa registrada. Em modo demonstrativo, nenhum provedor é consultado e nenhum crédito
            de integração é consumido.
          </p>
        )}
      </section>

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Registro de ações administrativas</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Registros protegidos: administradores comuns não alteram nem excluem entradas de auditoria.
        </p>
        <div className="mt-2 space-y-2">
          {state.audit.length ? (
            state.audit.map((log) => (
              <div key={log.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                <p className="font-medium">
                  {log.action} <span className="text-muted-foreground">· {log.severity}</span>
                </p>
                <p className="text-muted-foreground">
                  {log.actor_email || "sistema"} · {formatDateTime(log.created_date)}
                </p>
                {log.details && <p className="mt-0.5 text-muted-foreground">{log.details}</p>}
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma ação administrativa registrada.</p>
          )}
        </div>
      </section>
    </div>
  );
}
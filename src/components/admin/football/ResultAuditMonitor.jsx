import React from "react";
import { AlertTriangle, CheckCircle2, Clock3, Flag, Hourglass, ListChecks, MapPin, Ticket } from "lucide-react";
import { formatDateTime } from "@/lib/format";

function Stat({ label, value, hint, icon: Icon, tone = "default" }) {
  const border = tone === "alert" ? "border-destructive/40 bg-destructive/10" : "border-border bg-secondary/30";
  return (
    <div className={`rounded-lg border px-3 py-2 ${border}`}>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
        {label}
      </p>
      <p className="score-num mt-0.5 text-xl font-semibold">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

/**
 * Monitoramento da auditoria de resultados: consumo, fila de partidas com
 * apostas pendentes, resultados confirmados e indisponíveis. Todos os números
 * vêm dos registros internos da rotina — nenhuma consulta à API-Football é
 * feita para montar este painel.
 */
export default function ResultAuditMonitor({ audit, consumption }) {
  if (!audit) return <div className="card-surface h-32 animate-pulse" />;

  const statusLabel =
    audit.last_run_status === "success"
      ? "Concluída"
      : audit.last_run_status === "partial"
        ? "Concluída com pendências"
        : audit.last_run_status === "error"
          ? "Falhou"
          : "Sem execução registrada";

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Auditoria de resultados pendentes</h2>
        <span className="text-[11px] text-muted-foreground">
          {audit.last_run_at ? `Última execução ${formatDateTime(audit.last_run_at)} · ${statusLabel}` : statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Brasileiras ao vivo"
          value={audit.brazilian_live}
          icon={MapPin}
          hint="alimentam a seção Ao Vivo"
        />
        <Stat label="Fila de auditoria" value={audit.queue_pending} icon={ListChecks} hint="partidas com resultado pendente" />
        <Stat label="Apostas pendentes" value={audit.pending_selections} icon={Ticket} hint="todas agrupadas por partida" />
        <Stat label="Bilhetes pendentes" value={audit.pending_tickets} icon={Hourglass} />
        <Stat label="Resultados confirmados" value={audit.results_confirmed} icon={CheckCircle2} hint="guardados e reutilizados" />
        <Stat
          label="Ainda indisponíveis"
          value={audit.results_unavailable}
          icon={Clock3}
          hint="nova tentativa progressiva"
          tone={audit.results_unavailable > 0 ? "alert" : "default"}
        />
        <Stat
          label="Em revisão"
          value={audit.review_events}
          icon={Flag}
          hint="decisão administrativa"
          tone={audit.review_events > 0 ? "alert" : "default"}
        />
        <Stat
          label="Requisições hoje"
          value={consumption ? `${consumption.used}/${consumption.limit ?? "—"}` : audit.last_run_requests}
          icon={Clock3}
          hint={consumption ? `${consumption.remaining ?? "—"} restantes` : "última execução"}
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Próxima tentativa: {audit.next_attempt_at ? formatDateTime(audit.next_attempt_at) : "sem pendência"}</span>
        {audit.last_run_summary && <span className="truncate">{audit.last_run_summary}</span>}
      </div>

      {audit.last_run_error && (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {audit.last_run_error}
        </p>
      )}
    </section>
  );
}
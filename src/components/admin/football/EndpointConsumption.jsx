import React from "react";
import { Activity } from "lucide-react";
import { formatDateTime, timeAgo } from "@/lib/format";

const LABELS = {
  "/fixtures": "Calendário e placares",
  "/fixtures?live=all": "Placar ao vivo",
  "/fixtures?ids": "Confirmação em lote",
  "/odds": "Cotações",
  "/fixtures/statistics": "Estatísticas",
  "/fixtures/events": "Eventos",
  "/fixtures/headtohead": "Confrontos diretos",
  "/status": "Status da conta",
};

/** Consumo real do dia por endpoint, com as respostas 429 e a próxima execução. */
export default function EndpointConsumption({ connection }) {
  const rows = connection?.by_endpoint || [];
  const rateLimited = connection?.rate_limited_today ?? 0;

  // Próxima execução é sempre no futuro: o rótulo é contado a partir de agora.
  const nextRunIn = (() => {
    const diff = Date.parse(connection?.next_run_at || "") - Date.now();
    if (!Number.isFinite(diff)) return null;
    const mins = Math.max(0, Math.round(diff / 60000));
    return mins < 60 ? `em ${mins} min` : `em ${Math.round(mins / 60)} h`;
  })();

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex items-start gap-2">
        <Activity className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold">Consumo por endpoint</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Somente as chamadas realmente enviadas hoje, por endpoint. Duplicidades de log não entram na conta.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Próxima execução</p>
          <p className="score-num text-lg font-semibold">{nextRunIn || "—"}</p>
          <p className="text-[11px] text-muted-foreground">
            {connection?.next_run_at ? formatDateTime(connection.next_run_at) : "sem ciclo agendado"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Calendário importado</p>
          <p className="score-num text-lg font-semibold">
            {connection?.last_calendar_at ? timeAgo(connection.last_calendar_at) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">uma vez ao dia · 7 dias à frente</p>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 ${
            rateLimited > 0
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          <p className="text-[11px] uppercase tracking-wide opacity-80">Respostas 429 hoje</p>
          <p className="score-num text-lg font-semibold">{rateLimited}</p>
          <p className="text-[11px] opacity-80">limite por minuto do provedor</p>
        </div>
      </div>

      {rows.length ? (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.endpoint} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{row.endpoint}</span>
                {LABELS[row.endpoint] ? ` · ${LABELS[row.endpoint]}` : ""}
              </span>
              <span className="score-num shrink-0 text-foreground">
                {row.calls} chamada(s) · {row.credits} crédito(s)
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Nenhuma chamada registrada hoje.</p>
      )}
    </section>
  );
}
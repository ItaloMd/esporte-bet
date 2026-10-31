import React from "react";
import { AlertTriangle, CheckCircle2, Wifi, WifiOff } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatDateTime, timeAgo } from "@/lib/format";

/** Cor do indicador por faixa de consumo do plano. */
function percentTone(percent) {
  if (percent >= 95) return "border-red-500/50 bg-red-500/10 text-red-400";
  if (percent >= 90) return "border-orange-500/50 bg-orange-500/10 text-orange-400";
  if (percent >= 75) return "border-amber-500/50 bg-amber-500/10 text-amber-400";
  if (percent >= 50) return "border-yellow-400/40 bg-yellow-400/10 text-yellow-300";
  return "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="score-num text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Módulo 1: status da conexão, plano, consumo e alertas da API-Football. */
export default function CentralStatus({ data }) {
  const { connection, plan, consumption, alerts } = data;
  const pause = data.pause || {};
  const percent = Number(consumption.percent || 0);

  return (
    <section className="card-surface space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Central API-Football</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Conta, plano e consumo em tempo real, consultados em <span className="font-medium">/status</span> (não
            consome cota). A chave fica guardada como segredo do backend.
          </p>
        </div>
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${percentTone(percent)}`}>
          {connection.status === "connected" ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {connection.status === "connected" ? "Conectado" : "Sem conexão"}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="API Key"
          value={connection.key_configured ? "Configurada" : "Ausente"}
          hint={connection.key_configured ? "Secrets do backend" : "Cadastre o secret API_FOOTBALL_KEY"}
        />
        <Stat
          label="Plano contratado"
          value={plan.name || "—"}
          hint={`limite diário ${plan.limit ?? "—"} · interno ${plan.internal_limit ?? "—"}`}
        />
        <Stat
          label="Consumo atual"
          value={`${consumption.used}/${plan.limit ?? "—"}`}
          hint={`${percent}% do plano · ${consumption.remaining} restante(s)`}
        />
        <Stat
          label="Consumo médio"
          value={`${consumption.avg_recent}/dia`}
          hint={`30 dias: ${consumption.avg_daily}/dia · pico ${consumption.max_day}`}
        />
        <Stat
          label="Mensal estimado"
          value={`${consumption.monthly_estimate}`}
          hint="média diária dos últimos 30 dias × 30"
        />
        <Stat
          label="Última sincronização"
          value={connection.last_sync_at ? timeAgo(connection.last_sync_at) : "nunca"}
          hint={connection.last_sync_status || "—"}
        />
        <Stat
          label="Coleta"
          value={data.monitor.enabled ? "Ativo" : "Desligado"}
          hint={`calendário a cada ${data.monitor.calendar_refresh_hours ?? 24} h · janela de ${data.monitor.window_days ?? 7} dias`}
        />
        <Stat label="Partidas em revisão" value={data.widgets?.review_events ?? 0} hint="aguardando decisão administrativa" />
        <Stat
          label="Fila por minuto"
          value={`${pause.minute_used ?? 0}/${pause.minute_limit ?? "—"}`}
          hint={`teto compartilhado · ${connection.rate_limited_today ?? 0} resposta(s) 429 hoje`}
        />
        <Stat
          label="Saldo no provedor"
          value={pause.minute_remaining_provider ?? "—"}
          hint="X-RateLimit-Remaining · abaixo de 50 a fila espera o próximo minuto"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Consumo do dia</span>
          <span>{percent}%</span>
        </div>
        <Progress value={Math.min(100, percent)} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(alerts || []).map((alert) => (
          <span
            key={alert.threshold}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              alert.reached ? percentTone(alert.threshold) : "border-border bg-secondary/40 text-muted-foreground"
            }`}
          >
            {alert.reached ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            Alerta {alert.threshold}%{alert.reached ? " atingido" : ""}
          </span>
        ))}
      </div>

      {connection.status_error ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {connection.status_error}
        </p>
      ) : null}

      {pause.active ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium">Coleta pausada até {formatDateTime(pause.until)}.</span>{" "}
              {pause.scope === "daily"
                ? pause.last_error_scope === "throttle"
                  ? "O provedor está recusando novas chamadas por excesso de tráfego, mesmo com saldo disponível. A espera é escalonada (30 min, 1 h, 2 h, 4 h e 6 h) e a coleta retoma sozinha no horário acima."
                  : "O saldo diário da conta foi esgotado. A coleta retoma sozinha na virada do dia da conta (00:00 UTC)."
                : "A janela de requisições do minuto foi fechada. A coleta retoma sozinha no minuto seguinte."}
              {pause.strikes ? ` (${pause.strikes} ocorrência(s))` : ""} Nenhum dado foi perdido: o que já está salvo
              continua no ar.
            </span>
          </p>
          {pause.last_error ? <p className="mt-1 pl-5 text-[11px] text-red-300/80">Motivo: {pause.last_error}</p> : null}
        </div>
      ) : pause.last_rate_limited_at ? (
        <p className="text-[11px] text-muted-foreground">
          Último bloqueio de limite: {timeAgo(pause.last_rate_limited_at)} · pausa cumprida, rotinas operando normalmente.
        </p>
      ) : null}

      {connection.last_summary ? (
        <p className="text-[11px] text-muted-foreground">Última execução: {connection.last_summary}</p>
      ) : null}
    </section>
  );
}
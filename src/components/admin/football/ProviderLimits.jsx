import React from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Gauge, Loader2, Play, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";

const TONE = {
  ok: { Icon: CheckCircle2, className: "text-emerald-400" },
  warn: { Icon: AlertTriangle, className: "text-amber-400" },
  error: { Icon: CircleAlert, className: "text-red-400" },
};

const number = (value) =>
  value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("pt-BR");

const clock = (value) => {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function Metric({ icon: Icon, label, value, hint, tone = "text-foreground" }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold score-num ${tone}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/**
 * Limites oficiais da API-Football: saldo diário (`x-ratelimit-requests-*`),
 * limite por minuto (`X-RateLimit-*`), fila compartilhada e diagnóstico de
 * conciliação entre o contador interno e a conta do provedor.
 */
export default function ProviderLimits({ provider, diagnostics, pause, onTest, testing = false }) {
  if (!provider) return null;
  const daily = provider.daily || {};
  const minute = provider.minute || {};
  const windowState = provider.window || {};
  const pacing = provider.pacing || {};
  const checks = diagnostics?.checks || [];
  const dailyTone = daily.remaining === 0 || pause?.scope === "daily" ? "text-red-400" : "text-foreground";
  const minuteTone = pause?.scope === "minute" ? "text-amber-400" : "text-foreground";

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Limites do provedor</h3>
          <p className="text-[11px] text-muted-foreground">
            Saldo do dia e janela do minuto lidos dos cabeçalhos oficiais a cada resposta.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            daily.fresh ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"
          }`}
        >
          {daily.source === "provedor" ? (daily.fresh ? "saldo oficial" : "saldo de ontem") : "contador interno"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          icon={Gauge}
          label="Saldo do dia"
          value={number(daily.remaining)}
          hint={`${number(daily.used)} de ${number(daily.limit)} usados`}
          tone={dailyTone}
        />
        <Metric
          icon={Timer}
          label="Minuto"
          value={`${number(minute.remaining)}`}
          hint={`teto ${number(minute.limit)}/min · janela ${number(windowState.used)}`}
          tone={minuteTone}
        />
        <Metric
          icon={Gauge}
          label="Fila"
          value={`${number(pacing.gap_ms)} ms`}
          hint={pacing.learned ? "espaçamento aprendido" : "espaçamento nominal"}
        />
        <Metric
          icon={Timer}
          label="Próximo slot"
          value={clock(pacing.next_slot_at)}
          hint={diagnostics?.last_call_at ? `última chamada ${clock(diagnostics.last_call_at)}` : "sem chamadas hoje"}
        />
      </div>

      {provider.breaker?.open ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Disjuntor aberto até {clock(provider.breaker.until)}: o provedor falhou {provider.breaker.threshold} vezes
          seguidas ({provider.breaker.reason || "indisponibilidade"}). Nenhuma rotina chama a API até lá e nada é
          duplicado — a coleta retoma sozinha depois do cooldown, que dobra a cada abertura seguida.
        </p>
      ) : null}

      {pause?.active ? (
        <div className="space-y-2">
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {pause.scope === "daily"
              ? pause.last_error_scope === "throttle"
                ? `O provedor bloqueou o tráfego temporariamente por excesso de requisições. Coleta retoma sozinha em ${clock(pause.until)} — o saldo do dia continua intacto.`
                : `Cota diária do provedor esgotada. Nenhuma rotina chama a API-Football até ${clock(pause.until)}, na virada do dia da conta.`
              : `Fila fechada pelo limite por minuto até ${clock(pause.until)}. Reabre sozinha no próximo minuto, sem repetir chamadas.`}
          </p>
          {onTest ? (
            <Button size="sm" variant="outline" onClick={onTest} disabled={testing}>
              {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
              Testar conexão agora
            </Button>
          ) : null}
        </div>
      ) : null}

      {checks.length ? (
        <ul className="space-y-1.5">
          {checks.map((check) => {
            const tone = TONE[check.status] || TONE.ok;
            return (
              <li key={check.id} className="flex items-start gap-2 text-[11px] leading-snug">
                <tone.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone.className}`} />
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{check.label}:</span> {check.detail}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
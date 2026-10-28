import React from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const RISK_LABEL = {
  low: "Risco baixo",
  medium: "Atenção",
  high: "Risco alto",
  critical: "Risco crítico de atingir o limite",
};

const RISK_TONE = {
  low: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
  medium: "border-amber-500/50 bg-amber-500/10 text-amber-400",
  high: "border-orange-500/50 bg-orange-500/10 text-orange-400",
  critical: "border-red-500/50 bg-red-500/10 text-red-400",
};

function Card({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="score-num text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Módulo 9: previsão de consumo baseada no histórico real dos últimos 30 dias. */
export default function ForecastPanel({ forecast, history }) {
  if (!forecast) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <section className="card-surface space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Previsão de consumo</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Motor de previsão a partir do histórico dos últimos 30 dias, jogos monitorados, apostas registradas e
          frequência de atualização.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Amanhã (1 dia)" value={forecast.d1} hint="consumo projetado" />
        <Card label="7 dias" value={forecast.d7} hint="consumo projetado" />
        <Card label="15 dias" value={forecast.d15} hint="consumo projetado" />
        <Card label="30 dias" value={forecast.d30} hint="consumo projetado" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card label="Percentual utilizado" value={`${forecast.percent}%`} hint="projeção mensal sobre o plano" />
        <Card label="Margem de segurança" value={`${forecast.safety_margin}%`} hint="folga até o limite do plano" />
        <div className={`rounded-lg border px-3 py-2 ${RISK_TONE[forecast.risk]}`}>
          <p className="text-[11px] uppercase tracking-wide opacity-80">Risco de atingir o limite</p>
          <p className="score-num text-lg font-semibold">{RISK_LABEL[forecast.risk]}</p>
        </div>
      </div>

      {history?.length ? (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(value) => [`${value} crédito(s)`, "Consumo"]}
              />
              <Line type="monotone" dataKey="used" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Sem histórico suficiente: a previsão fica precisa a partir do primeiro dia de uso registrado.
        </p>
      )}
    </section>
  );
}
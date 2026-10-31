import React from "react";
import { AlertTriangle, Timer, TrendingUp } from "lucide-react";
import { timeAgo } from "@/lib/format";

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="score-num text-lg font-semibold">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Módulo: motor de cotações pré-jogo — curadoria, fila e última execução. */
export default function OddsEngine({ engine }) {
  if (!engine) return null;
  const { last_run: lastRun } = engine;
  const priorityMap = new Map((engine.cadence || []).map((row) => [row.priority, row.minutes]));

  return (
    <section className="card-surface space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" />
            Cotações pré-jogo (curadoria)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Só recebe preço a partida curada dentro da janela de {engine.window_days} dia(s): competição ou time de
            relevância {engine.min_relevance}+, favorita do jogador ou com aposta aberta. A coleta vai em lotes de
            competição + data, com margem de {engine.house_margin}% aplicada na gravação.
          </p>
        </div>
        <span
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${
            engine.running
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : "border-border bg-secondary/40 text-muted-foreground"
          }`}
        >
          <Timer className="h-3.5 w-3.5" />
          {engine.running ? "Motor ativo" : "Coleta pausada"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Partidas curadas" value={engine.curated_matches} hint={`relevância ≥ ${engine.min_relevance}`} />
        <Stat label="Na fila" value={engine.queue_total} hint="partidas aguardando preço" />
        <Stat label="Vencidas agora" value={engine.due_now} hint="prontas para a próxima execução" />
        <Stat label="Lotes por execução" value={engine.max_lots} hint={`até ${engine.max_pages} página(s) por lote`} />
      </div>

      {engine.by_priority?.length ? (
        <div className="flex flex-wrap gap-2">
          {engine.by_priority.map((row) => (
            <span
              key={row.priority}
              className="rounded-full border border-border bg-secondary/40 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <span className="font-medium text-foreground">{row.priority}</span> · {row.count} · a cada{" "}
              {priorityMap.get(row.priority) ?? "—"} min
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          A fila está vazia — ela é montada na próxima execução do motor, a partir da curadoria.
        </p>
      )}

      {lastRun ? (
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Última execução:</span>{" "}
            {lastRun.at ? timeAgo(lastRun.at) : "—"} · {lastRun.status || "—"} · {lastRun.requests} chamada(s) ·{" "}
            {lastRun.odds} cotação(ões)
          </p>
          {lastRun.summary ? <p className="mt-1">{lastRun.summary}</p> : null}
          {lastRun.error ? (
            <p className="mt-1 flex items-start gap-1.5 text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {lastRun.error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Nenhuma coleta de cotações registrada ainda. Use “Atualizar cotações” nas ações manuais para a primeira carga.
        </p>
      )}
    </section>
  );
}
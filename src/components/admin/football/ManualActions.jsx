import React from "react";
import { Activity, BadgeCheck, CalendarDays, ClipboardCheck, Layers, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Ações manuais da coleta. Cada botão executa uma rotina específica — nada de
 * lote disparado de uma vez: a fila global espaça as chamadas e respeita o teto
 * por minuto, a pausa de segurança e o cache (nada é reprocessado).
 */
export const MANUAL_ACTIONS = [
  {
    key: "calendar",
    label: "Carregar calendário",
    hint: "Importa as partidas dos próximos dias que ainda não estão no sistema.",
    icon: CalendarDays,
    steps: [["syncFootball", { mode: "calendar", trigger: "manual" }, "Calendário importado"]],
  },
  {
    key: "live",
    label: "Atualizar ao vivo",
    hint: "Lê placar, minuto e situação das partidas em andamento.",
    icon: Activity,
    steps: [["syncFootballLive", { trigger: "manual" }, "Detector ao vivo"]],
  },
  {
    key: "odds",
    label: "Atualizar cotações",
    hint: "Busca as cotações das partidas da fila de prioridade.",
    icon: TrendingUp,
    steps: [["syncFootballOdds", { mode: "auto", trigger: "manual", force: true }, "Cotações atualizadas"]],
  },
  {
    key: "audit",
    label: "Auditar resultados",
    hint: "Confirma o resultado final das partidas com apostas pendentes.",
    icon: ClipboardCheck,
    steps: [["auditarResultadosPendentes", { trigger: "manual" }, "Resultados pendentes"]],
  },
  {
    key: "settle",
    label: "Liquidar bilhetes",
    hint: "Fecha as apostas cujo resultado já foi confirmado.",
    icon: BadgeCheck,
    steps: [["settleMatches", { trigger: "manual" }, "Bilhetes liquidados"]],
  },
];

const FULL_CYCLE_STEPS = MANUAL_ACTIONS.flatMap((action) => action.steps);

export default function ManualActions({ busy, onRun }) {
  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Ações manuais</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cada ação faz chamadas à API-Football respeitando a fila compartilhada: no máximo o teto de requisições por
          minuto, com pausa automática quando o provedor sinaliza limite.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {MANUAL_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <div key={action.key} className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{action.label}</p>
                  <p className="text-[11px] leading-snug text-muted-foreground">{action.hint}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                disabled={busy}
                onClick={() => onRun(action.steps)}
              >
                Executar
              </Button>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <div className="flex items-start gap-2">
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs font-medium">Ciclo completo</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Executa as cinco ações acima em sequência, com espera entre as etapas. Se o provedor sinalizar limite, o
              ciclo para e as etapas restantes ficam para a próxima execução.
            </p>
          </div>
        </div>
        <Button size="sm" className="mt-2 w-full" disabled={busy} onClick={() => onRun(FULL_CYCLE_STEPS)}>
          Executar ciclo completo
        </Button>
      </div>
    </section>
  );
}
import React from "react";
import { Activity, CalendarDays, CheckCircle2, Coins, Database, FileSearch, Gauge, Ticket } from "lucide-react";

const WIDGETS = [
  { key: "games_today", label: "Jogos hoje", icon: CalendarDays },
  { key: "live_games", label: "Jogos ao vivo", icon: Activity },
  { key: "finished_today", label: "Jogos finalizados", icon: CheckCircle2 },
  { key: "pending_bets", label: "Apostas pendentes", icon: Ticket },
  { key: "audited_today", label: "Apostas auditadas", icon: FileSearch },
  { key: "consumption", label: "Consumo da API", icon: Database },
  { key: "remaining", label: "Créditos restantes", icon: Coins },
  { key: "audit_queue", label: "Fila de auditoria", icon: Gauge },
];

/** Módulo 8: painel operacional com widgets de monitoramento e apostas. */
export default function OpsWidgets({ widgets }) {
  if (!widgets) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <section className="card-surface p-4">
      <h2 className="text-sm font-semibold">Painel operacional</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {WIDGETS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {label}
            </p>
            <p className="score-num mt-0.5 text-xl font-semibold">{widgets[key] ?? 0}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
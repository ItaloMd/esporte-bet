import React from "react";

const STAT_LABELS = {
  "Shots on Goal": "Chutes no gol",
  "Total Shots": "Finalizações",
  "Shots insidebox": "Finalizações na área",
  "Shots outsidebox": "Finalizações de fora da área",
  "Corner Kicks": "Escanteios",
  "Ball Possession": "Posse de bola",
  "Yellow Cards": "Cartões amarelos",
  "Red Cards": "Cartões vermelhos",
  "Fouls": "Faltas",
  "Offsides": "Impedimentos",
  "Goalkeeper Saves": "Defesas do goleiro",
  "Total Passes": "Passes",
  "Passes Accurate": "Passes certos",
};

function labelFor(type) {
  return STAT_LABELS[type] || type;
}

/** Comparativo de estatísticas das duas equipes, alinhado por tipo. */
export default function StatsTable({ rows }) {
  if (!rows || rows.length < 2) return null;
  const [home, away] = rows;
  const awayByType = new Map((away.stats || []).map((item) => [item.type, item.value]));
  const lines = (home.stats || []).map((item) => ({
    label: labelFor(item.type),
    home: item.value,
    away: awayByType.has(item.type) ? awayByType.get(item.type) : null,
  }));

  return (
    <section className="card-surface overflow-hidden">
      <h2 className="border-b border-border px-3.5 py-2.5 text-sm font-semibold">Estatísticas da partida</h2>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border/60 px-3.5 py-2 text-[11px] font-medium text-muted-foreground">
        <span className="truncate text-left">{home.team_name}</span>
        <span className="text-center uppercase tracking-wide">Comparativo</span>
        <span className="truncate text-right">{away.team_name}</span>
      </div>
      <div className="divide-y divide-border/40">
        {lines.map((line) => (
          <div key={line.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 py-2">
            <span className="score-num text-sm font-semibold">{line.home ?? "—"}</span>
            <span className="text-[11px] text-muted-foreground">{line.label}</span>
            <span className="score-num text-right text-sm font-semibold">{line.away ?? "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
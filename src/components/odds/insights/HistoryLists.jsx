import React from "react";
import TeamCrest from "@/components/sports/TeamCrest";
import { formatDateShort } from "@/lib/format";

function resultBadge(row, teamName) {
  const home = Number(row.home_goals);
  const away = Number(row.away_goals);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return "—";
  const isHome = row.home === teamName;
  const goalsFor = isHome ? home : away;
  const goalsAgainst = isHome ? away : home;
  if (goalsFor > goalsAgainst) return "V";
  if (goalsFor === goalsAgainst) return "E";
  return "D";
}

const BADGE_STYLES = {
  V: "bg-primary/20 text-primary",
  E: "bg-secondary text-muted-foreground",
  D: "bg-destructive/15 text-destructive",
};

function RecentList({ title, rows, teamName }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="min-w-0">
      <h3 className="mb-2 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const badge = resultBadge(row, teamName);
          return (
            <li key={row.fixture_id} className="flex items-center gap-2 text-xs">
              <span className={`score-num w-5 shrink-0 rounded-full py-0.5 text-center text-[10px] font-bold ${BADGE_STYLES[badge]}`}>
                {badge}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {row.home} {row.home_goals} x {row.away_goals} {row.away}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateShort(row.date)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Confrontos diretos e últimos jogos de cada equipe, somente partidas encerradas. */
export default function HistoryLists({ h2h, homeRecent, awayRecent, homeName, awayName }) {
  if (!h2h?.length && !homeRecent?.length && !awayRecent?.length) return null;
  return (
    <section className="card-surface overflow-hidden">
      <h2 className="border-b border-border px-3.5 py-2.5 text-sm font-semibold">Resultados anteriores</h2>
      {h2h?.length ? (
        <div className="border-b border-border/60 px-3.5 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Confrontos diretos
          </h3>
          <ul className="space-y-1.5">
            {h2h.map((row) => (
              <li key={row.fixture_id} className="flex items-center gap-2 text-xs">
                <TeamCrest name={row.home} crest={row.home_logo} className="h-4 w-4" />
                <TeamCrest name={row.away} crest={row.away_logo} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">
                  {row.home} <span className="score-num font-semibold">{row.home_goals} x {row.away_goals}</span> {row.away}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatDateShort(row.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-4 px-3.5 py-3 sm:grid-cols-2">
        <RecentList title={`Últimos jogos · ${homeName}`} rows={homeRecent} teamName={homeName} />
        <RecentList title={`Últimos jogos · ${awayName}`} rows={awayRecent} teamName={awayName} />
      </div>
    </section>
  );
}
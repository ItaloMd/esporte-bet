import React from "react";
import { Link } from "react-router-dom";
import TeamCrest from "@/components/sports/TeamCrest";
import { formatDateShort } from "@/lib/format";

export default function ResultRow({ event }) {
  return (
    <Link
      to={`/partida/${event.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{event.competition_name}</p>
        <div className="mt-1 flex items-center gap-2">
          <TeamCrest name={event.home_team_name} crest={event.home_team_crest} className="h-6 w-6" />
          <span className="truncate text-sm font-medium">{event.home_team_name}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <TeamCrest name={event.away_team_name} crest={event.away_team_crest} className="h-6 w-6" />
          <span className="truncate text-sm font-medium">{event.away_team_name}</span>
        </div>
      </div>
      <div className="text-right">
        <p className="score-num text-xl font-semibold leading-tight">{event.home_score ?? "-"}</p>
        <p className="score-num text-xl font-semibold leading-tight">{event.away_score ?? "-"}</p>
      </div>
      <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">{formatDateShort(event.start_time)}</span>
    </Link>
  );
}
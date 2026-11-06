import React from "react";
import { Link } from "react-router-dom";
import { formatDay, formatTime } from "@/lib/format";
import TeamCrest from "@/components/sports/TeamCrest";
import OddsButton from "@/components/odds/OddsButton";

function TeamLine({ name, crest }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TeamCrest name={name} crest={crest} className="h-5 w-5" />
      <span className="truncate text-[13px] font-medium">{name}</span>
    </div>
  );
}

/** Linha de partida: horário, equipes e as três cotações principais. */
export default function EventRow({ event, odds = [] }) {
  return (
    <div className="grid gap-2 px-3 py-2.5 transition-colors hover:bg-secondary/30 sm:grid-cols-[76px_1fr_252px] sm:items-center sm:gap-3">
      <div className="flex items-baseline gap-1.5 sm:flex-col sm:gap-0">
        <span className="score-num text-sm font-semibold leading-none">{formatTime(event.start_time)}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {formatDay(event.start_time)}
        </span>
      </div>

      <Link to={`/partida/${event.id}`} className="min-w-0 space-y-1">
        <TeamLine name={event.home_team_name} crest={event.home_team_crest} />
        <TeamLine name={event.away_team_name} crest={event.away_team_crest} />
      </Link>

      {odds.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {odds.map((odd) => (
            <OddsButton key={odd.id} odd={odd} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5" title="Cotações ainda não publicadas para esta partida">
          {["1", "X", "2"].map((label) => (
            <div
              key={label}
              className="flex min-h-[2.9rem] flex-col items-center justify-center gap-0.5 rounded-md border border-border/70 bg-secondary/40 px-2 py-1.5"
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
              <span className="score-num text-[15px] font-semibold leading-none text-muted-foreground">—</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
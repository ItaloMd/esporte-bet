import React from "react";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { formatTime } from "@/lib/format";
import TeamCrest from "@/components/sports/TeamCrest";
import EventMeta from "@/components/odds/EventMeta";
import OddsButton from "@/components/odds/OddsButton";
import { LiveBadge } from "@/components/odds/Badges";

function TeamLine({ name, crest, score, highlight }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 py-1">
      <TeamCrest name={name} crest={crest} />
      <span className={`truncate text-sm ${highlight ? "font-semibold" : "font-medium"}`}>{name}</span>
      {score !== null && score !== undefined && (
        <span className="ml-auto score-num text-xl font-semibold leading-none">{score}</span>
      )}
    </div>
  );
}

export default function EventCard({ event, odds = [], showCompetition = true }) {
  const hasScore = event.home_score !== null && event.home_score !== undefined;
  return (
    <article className="card-surface overflow-hidden transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-3.5 py-2.5">
        <div className="min-w-0">
          {showCompetition && (
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {event.competition_name || "Competição não informada"}
            </p>
          )}
          <EventMeta event={event} />
          {event.venue && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {event.venue}
            </p>
          )}
        </div>
        {event.status === "live" ? (
          <LiveBadge minute={event.minute} label={event.phase_label} />
        ) : (
          <span className="score-num shrink-0 text-lg font-semibold text-muted-foreground">
            {formatTime(event.start_time)}
          </span>
        )}
      </div>

      <Link to={`/partida/${event.id}`} className="block px-3.5 py-2.5">
        <TeamLine
          name={event.home_team_name}
          crest={event.home_team_crest}
          score={hasScore ? event.home_score : undefined}
          highlight={hasScore && Number(event.home_score) > Number(event.away_score || 0)}
        />
        <TeamLine
          name={event.away_team_name}
          crest={event.away_team_crest}
          score={hasScore ? event.away_score : undefined}
          highlight={hasScore && Number(event.away_score) > Number(event.home_score || 0)}
        />
      </Link>

      <div className="flex flex-col gap-1.5 border-t border-border/70 px-3.5 py-2.5">
        {event.status === "live" ? (
          <p className="py-1 text-xs text-muted-foreground">
            Apostas encerradas — partida em andamento.
          </p>
        ) : odds.length ? (
          <div className={`grid gap-1.5 ${odds.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {odds.map((odd) => (
              <OddsButton key={odd.id} odd={odd} />
            ))}
          </div>
        ) : (
          <p className="py-1 text-xs text-muted-foreground">
            Mercados não disponíveis na fonte de dados para este evento.
          </p>
        )}
      </div>
    </article>
  );
}
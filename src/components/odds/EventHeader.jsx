import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MapPin, Radio } from "lucide-react";
import TeamCrest from "@/components/sports/TeamCrest";
import { LiveBadge, StatusBadge } from "@/components/odds/Badges";
import { formatDay, formatTime, timeAgo } from "@/lib/format";

export default function EventHeader({ event }) {
  const hasScore = event.home_score !== null && event.home_score !== undefined;
  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Link to="/" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Voltar
          </Link>
          <p className="truncate text-sm font-medium">{event.competition_name || "Competição não informada"}</p>
          <p className="text-[11px] text-muted-foreground">{event.country || "Internacional"}</p>
        </div>
        {event.status === "live" ? <LiveBadge minute={event.minute} /> : <StatusBadge status={event.status} />}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamCrest name={event.home_team_name} crest={event.home_team_crest} className="h-12 w-12" />
          <span className="text-sm font-medium">{event.home_team_name}</span>
        </div>
        <div className="text-center">
          {hasScore ? (
            <p className="score-num text-3xl font-bold">
              {event.home_score} <span className="text-muted-foreground">x</span> {event.away_score}
            </p>
          ) : (
            <p className="score-num text-2xl font-semibold text-muted-foreground">
              {formatTime(event.start_time)}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">{formatDay(event.start_time)} · Brasília</p>
          {event.status === "live" && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive"><Radio className="h-3 w-3" aria-hidden="true" /> em andamento</p>}
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamCrest name={event.away_team_name} crest={event.away_team_crest} className="h-12 w-12" />
          <span className="text-sm font-medium">{event.away_team_name}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        {event.venue && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" /> {event.venue}
          </span>
        )}
        <span>Última atualização dos dados: {timeAgo(event.last_sync_at)}</span>
        {event.external_id && <span className="font-mono">ID externo: {event.external_id}</span>}
      </div>
    </div>
  );
}
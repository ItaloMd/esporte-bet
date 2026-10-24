import React from "react";
import { Clock } from "lucide-react";
import { formatDay, formatTime, timeAgo } from "@/lib/format";
import { StatusBadge } from "@/components/odds/Badges";

export default function EventMeta({ event, compact = false }) {
  const timeLabel = `${formatDay(event.start_time)} · ${formatTime(event.start_time)}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden="true" />
        {timeLabel}
      </span>
      <span aria-hidden="true">·</span>
      <span title="Horário de Brasília">Brasília</span>
      {event.status !== "live" && (
        <>
          <span aria-hidden="true">·</span>
          <StatusBadge status={event.status} />
        </>
      )}
      {!compact && (event.live_updated_at || event.last_sync_at) && (
        <>
          <span aria-hidden="true">·</span>
          <span>Atualizado {timeAgo(event.live_updated_at || event.last_sync_at)}</span>
        </>
      )}
    </div>
  );
}
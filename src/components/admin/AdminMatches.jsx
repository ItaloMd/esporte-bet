import React, { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, Radio, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildEventFilter, loadEventFeed } from "@/lib/eventQueries";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { formatDateTime, formatNumber } from "@/lib/format";
import { statusLabel } from "@/lib/sports";

function dayRangeToday() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

function MatchRow({ event }) {
  const homeCrest = event.home_team_crest;
  const awayCrest = event.away_team_crest;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {homeCrest && <img src={homeCrest} alt="" className="h-5 w-5 shrink-0 object-contain" loading="lazy" />}
          <span className="truncate font-medium">{event.home_team_name}</span>
        </div>
        <span className="score-num shrink-0 rounded bg-secondary px-2 py-0.5 text-base font-semibold">
          {event.status === "live" || event.status === "finished"
            ? `${event.home_score ?? 0} x ${event.away_score ?? 0}`
            : "x"}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{event.away_team_name}</span>
          {awayCrest && <img src={awayCrest} alt="" className="h-5 w-5 shrink-0 object-contain" loading="lazy" />}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {event.status === "live" && (
          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
            {event.minute ? `${Math.round(event.minute)}'` : "Ao vivo"}
          </Badge>
        )}
        <span className="truncate">{event.competition_name}</span>
        <span className="shrink-0">{formatDateTime(event.start_time)}</span>
      </div>
    </div>
  );
}

export default function AdminMatches({ mode = "live" }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const filter =
        mode === "live"
          ? buildEventFilter({ status: "live" })
          : buildEventFilter({ dayRange: dayRangeToday() });
      const feed = await loadEventFeed(filter, { limit: 30, sort: mode === "live" ? "-start_time" : "start_time" });
      setEvents(feed.events || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar as partidas.");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    load();
  }, [load]);

  const title = mode === "live" ? "Jogos Ao Vivo" : "Jogos Hoje";

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {mode === "live" ? <Radio className="h-5 w-5 text-emerald-400" aria-hidden="true" /> : <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />}
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {mode === "live"
              ? "Placares atualizados pelo monitor ao vivo da API-Football"
              : "Partidas de hoje disponíveis para aposta (apenas com cotação publicada)"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </header>

      {loading && !events.length ? (
        <CardListSkeleton count={4} />
      ) : error ? (
        <div className="card-surface px-4 py-6 text-center text-sm text-destructive">{error}</div>
      ) : events.length ? (
        <div className="space-y-1.5">
          {events.map((event) => <MatchRow key={event.id} event={event} />)}
        </div>
      ) : (
        <p className="card-surface px-4 py-6 text-center text-xs text-muted-foreground">
          {mode === "live" ? "Nenhuma partida ao vivo agora." : "Nenhuma partida publicada para hoje."}
        </p>
      )}

      {mode !== "live" && (
        <p className="text-[11px] text-muted-foreground">
          Partidas encerradas aparecem na Auditoria de Jogos com o resultado confirmado pela API.
        </p>
      )}
    </div>
  );
}
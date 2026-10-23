import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import EventGrid from "@/components/odds/EventGrid";
import useEventFeed from "@/lib/useEventFeed";
import useCompetitions from "@/lib/useCompetitions";
import { buildEventFilter } from "@/lib/eventQueries";
import { SPORTS, sportName } from "@/lib/sports";

export default function Competitions() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("competition") || "";
  const [sport, setSport] = useState("");
  const { competitions, loading } = useCompetitions({ sportSlug: sport, limit: 60 });

  const filter = useMemo(
    () => buildEventFilter({ competitionId: selected, sportSlug: sport, status: "scheduled" }),
    [selected, sport],
  );
  const feed = useEventFeed(filter, { limit: 10, enabled: Boolean(selected) });

  const selectedCompetition = competitions.find((item) => item.id === selected);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card">
          <Trophy className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Competições</h1>
          <p className="text-xs text-muted-foreground">Ligas, campeonatos e torneios monitorados</p>
        </div>
      </header>

      <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSport("")}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm ${sport === "" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
        >
          Todos
        </button>
        {SPORTS.map((item) => (
          <button
            key={item.slug}
            type="button"
            onClick={() => setSport(item.slug)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm ${sport === item.slug ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            {item.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="card-surface h-16 animate-pulse" />
          <div className="card-surface h-16 animate-pulse" />
        </div>
      ) : competitions.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {competitions.map((competition) => {
            const active = competition.id === selected;
            return (
              <button
                key={competition.id}
                type="button"
                onClick={() => setParams(active ? {} : { competition: competition.id })}
                className={`card-surface px-4 py-3 text-left transition-colors ${active ? "border-primary" : "hover:border-primary/40"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{competition.name}</span>
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {sportName(competition.sport_slug)}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {competition.country || "Internacional"} · {competition.season || "temporada atual"}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma competição cadastrada para este filtro.</p>
      )}

      {selected && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Próximos eventos {selectedCompetition ? `· ${selectedCompetition.name}` : ""}
          </h2>
          <EventGrid
            events={feed.events}
            oddsByEvent={feed.oddsByEvent}
            loading={feed.loading}
            error={feed.error}
            onRetry={feed.reload}
            showCompetition={false}
            emptyTitle="Sem eventos agendados"
            emptyDescription="Esta competição não possui partidas futuras na fonte de dados."
          />
          {feed.hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={feed.loadMore} disabled={feed.loading}>
                Carregar mais partidas
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
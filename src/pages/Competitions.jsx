import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Trophy } from "lucide-react";
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

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const filter = useMemo(
    () => buildEventFilter({ competitionId: selected, sportSlug: sport, status: "scheduled", from: nowIso }),
    [selected, sport, nowIso],
  );
  const feed = useEventFeed(filter, { limit: 10, enabled: Boolean(selected) });

  const selectedCompetition = competitions.find((item) => item.id === selected);

  const chooseSport = (slug) => {
    setSport(slug);
    setParams({});
  };

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

      {selected ? (
        <section className="space-y-3">
          <div className="card-surface flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {selectedCompetition?.name || "Competição selecionada"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {sportName(selectedCompetition?.sport_slug)} ·{" "}
                {selectedCompetition?.country || "Internacional"} ·{" "}
                {selectedCompetition?.season || "temporada atual"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setParams({})}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Trocar
            </Button>
          </div>

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
      ) : (
        <>
          <div className="hide-scrollbar flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => chooseSport("")}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm ${sport === "" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
            >
              Todos
            </button>
            {SPORTS.map((item) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => chooseSport(item.slug)}
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
              {competitions.map((competition) => (
                <button
                  key={competition.id}
                  type="button"
                  onClick={() => setParams({ competition: competition.id })}
                  className="card-surface px-4 py-3 text-left transition-colors hover:border-primary/40"
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
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma competição cadastrada para este filtro.</p>
          )}
        </>
      )}
    </div>
  );
}
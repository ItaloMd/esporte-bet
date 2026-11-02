import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EventGrid from "@/components/odds/EventGrid";
import useEventFeed from "@/lib/useEventFeed";
import useFootballCompetitions from "@/lib/useFootballCompetitions";
import { buildEventFilter } from "@/lib/eventQueries";
import { formatNumber } from "@/lib/format";

/**
 * Competições realmente presentes na base de eventos (somente futebol).
 * A lista e o filtro usam o mesmo campo gravado no jogo (competition_name),
 * então toda competição listada tem jogos para mostrar.
 */
export default function Competitions() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("competition") || "";
  const [term, setTerm] = useState("");
  const { competitions, loading } = useFootballCompetitions({ limit: 150 });

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const filter = useMemo(
    () => buildEventFilter({ sportSlug: "futebol", competitionName: selected, status: "scheduled", from: nowIso }),
    [selected, nowIso],
  );
  const feed = useEventFeed(filter, { limit: 12, enabled: Boolean(selected) });

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return competitions;
    return competitions.filter((item) => item.name.toLowerCase().includes(needle));
  }, [competitions, term]);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card">
          <Trophy className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Competições</h1>
          <p className="text-xs text-muted-foreground">
            {formatNumber(competitions.length)} competições de futebol com jogos na base
          </p>
        </div>
      </header>

      {selected ? (
        <section className="space-y-3">
          <div className="card-surface flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{selected}</p>
              <p className="truncate text-[11px] text-muted-foreground">Próximos jogos desta competição</p>
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
            emptyTitle="Sem jogos futuros"
            emptyDescription="Esta competição não tem partidas futuras na base."
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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Filtrar competição (ex.: Brasileirão)"
              className="h-10 pl-9"
              aria-label="Filtrar competição"
            />
          </div>

          {loading ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="card-surface h-16 animate-pulse" />
              <div className="card-surface h-16 animate-pulse" />
            </div>
          ) : filtered.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered.map((competition) => (
                <button
                  key={competition.name}
                  type="button"
                  onClick={() => setParams({ competition: competition.name })}
                  className="card-surface flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:border-primary/50"
                >
                  <span className="min-w-0 truncate text-sm font-medium">{competition.name}</span>
                  <span className="score-num shrink-0 rounded-lg bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                    {competition.count}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma competição encontrada para este filtro.</p>
          )}
        </>
      )}
    </div>
  );
}
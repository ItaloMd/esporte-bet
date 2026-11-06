import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import EventFilters from "@/components/odds/EventFilters";
import DateStrip from "@/components/odds/DateStrip";
import EventRows from "@/components/odds/EventRows";
import useEventFeed from "@/lib/useEventFeed";
import useFootballCompetitions from "@/lib/useFootballCompetitions";
import { buildEventFilter, groupEventsByCompetition } from "@/lib/eventQueries";
import { dayRangeFromInput } from "@/lib/format";

export default function SportPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", country: "", competition: "", date: "" });
  const { competitions, countries } = useFootballCompetitions({ limit: 150 });

  const feedFilter = useMemo(
    () =>
      buildEventFilter({
        sportSlug: "futebol",
        competitionName: filters.competition,
        country: filters.country,
        dayRange: dayRangeFromInput(filters.date),
        status: "scheduled",
      }),
    [filters.competition, filters.country, filters.date],
  );
  const feed = useEventFeed(feedFilter, { limit: 12 });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold uppercase tracking-tight">Futebol</h1>
          <p className="text-xs text-muted-foreground">Próximos jogos e mercados da base</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/competicoes">Competições</Link>
        </Button>
      </header>

      <EventFilters
        filters={filters}
        onChange={(next) =>
          setFilters({
            country: next.country,
            competition: next.competition,
            date: next.date,
            search: next.search,
          })
        }
        competitions={competitions}
        countries={countries}
        onSubmitSearch={(term) => navigate(term ? `/busca?q=${encodeURIComponent(term)}` : "/busca")}
      />

      <DateStrip value={filters.date} onChange={(date) => setFilters((current) => ({ ...current, date }))} />

      <section className="panel">
        <EventRows
          groups={groupEventsByCompetition(feed.events)}
          oddsByEvent={feed.oddsByEvent}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          emptyTitle="Nenhum jogo agendado"
          emptyDescription="Não há partidas para os filtros escolhidos."
        />
        {feed.hasMore && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="outline" size="sm" onClick={feed.loadMore} disabled={feed.loading}>
              Carregar mais partidas
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
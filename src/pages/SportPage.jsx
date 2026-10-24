import React, { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import EventFilters from "@/components/odds/EventFilters";
import EventGrid from "@/components/odds/EventGrid";
import SportIcon from "@/components/sports/SportIcon";
import useEventFeed from "@/lib/useEventFeed";
import useCompetitions from "@/lib/useCompetitions";
import { buildEventFilter } from "@/lib/eventQueries";
import { SPORTS, sportName } from "@/lib/sports";
import { dayRangeFromInput } from "@/lib/format";

export default function SportPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", sport: slug, country: "", competition: "", date: "" });
  const { competitions } = useCompetitions({ limit: 60 });

  const feedFilter = useMemo(
    () =>
      buildEventFilter({
        sportSlug: slug,
        competitionId: filters.competition,
        country: filters.country,
        dayRange: dayRangeFromInput(filters.date),
        status: "scheduled",
      }),
    [slug, filters.competition, filters.country, filters.date],
  );
  const feed = useEventFeed(feedFilter, { limit: 10 });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card">
            <SportIcon slug={slug} className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">{sportName(slug)}</h1>
            <p className="text-xs text-muted-foreground">Próximos eventos, mercados e odds informativas</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/esportes")}>
          Todos os esportes
        </Button>
      </header>

      <EventFilters
        filters={{ ...filters, sport: "" }}
        onChange={(next) => {
          if (next.sport && next.sport !== slug) navigate(`/esporte/${next.sport}`);
          else
            setFilters({
              ...filters,
              country: next.country,
              competition: next.competition,
              date: next.date,
              search: next.search,
            });
        }}
        sports={SPORTS}
        competitions={competitions}
        onSubmitSearch={(term) => navigate(term ? `/busca?q=${encodeURIComponent(term)}` : "/busca")}
      />

      <EventGrid
        events={feed.events}
        oddsByEvent={feed.oddsByEvent}
        loading={feed.loading}
        error={feed.error}
        onRetry={feed.reload}
        emptyTitle="Nenhum evento deste esporte"
        emptyDescription="Não há partidas agendadas para os filtros escolhidos."
      />

      {feed.hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={feed.loadMore} disabled={feed.loading}>
            Carregar mais partidas
          </Button>
        </div>
      )}
    </div>
  );
}
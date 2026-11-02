import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Flame, History, Search, Star, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EventFilters from "@/components/odds/EventFilters";
import DateStrip from "@/components/odds/DateStrip";
import EventGrid from "@/components/odds/EventGrid";
import ResultRow from "@/components/odds/ResultRow";
import SectionHeading from "@/components/common/SectionHeading";
import PixActions from "@/components/wallet/PixActions";
import BannerCarousel from "@/components/banners/BannerCarousel";
import AppDownloadPrompt from "@/components/common/AppDownloadPrompt";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import useEventFeed from "@/lib/useEventFeed";
import useFootballCompetitions from "@/lib/useFootballCompetitions";
import { useAppSettings } from "@/lib/appSettings";
import { buildEventFilter, sortEventsByRelevance } from "@/lib/eventQueries";
import { dayRangeFromInput } from "@/lib/format";

const PAST = { status: "finished" };

function CompetitionChips({ competitions, loading }) {
  if (loading) return <div className="h-9 w-full animate-pulse rounded-xl bg-secondary" />;
  if (!competitions.length) {
    return <p className="text-xs text-muted-foreground">As competições aparecem aqui conforme os jogos são importados.</p>;
  }
  return (
    <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {competitions.map((competition) => (
        <Link
          key={competition.name}
          to={`/competicoes?competition=${encodeURIComponent(competition.name)}`}
          className="shrink-0 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm transition-colors hover:border-primary/50"
        >
          <span className="block max-w-[13rem] truncate font-medium">{competition.name}</span>
          <span className="text-[11px] text-muted-foreground">{competition.count} jogos</span>
        </Link>
      ))}
    </div>
  );
}

export default function Home() {
  const settings = useAppSettings();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", country: "", competition: "", date: "" });
  const { competitions, countries, loading: competitionsLoading } = useFootballCompetitions({ limit: 150 });

  // Marca o instante da montagem: a partir dele nenhuma partida já iniciada
  // entra nas listas de próximos jogos.
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const resultsFeed = useEventFeed(PAST, { limit: 4, sort: "-start_time" });

  const feedFilter = useMemo(
    () =>
      buildEventFilter({
        sportSlug: "futebol",
        competitionName: filters.competition,
        country: filters.country,
        dayRange: dayRangeFromInput(filters.date),
        status: "scheduled",
        from: nowIso,
      }),
    [filters.competition, filters.country, filters.date, nowIso],
  );
  const feed = useEventFeed(feedFilter, { limit: 12 });

  // Próximos jogos ordenados pela relevância calculada no backend.
  const upcoming = useMemo(() => sortEventsByRelevance(feed.events), [feed.events]);

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 py-6 md:px-7 md:py-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
        <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">
          Futebol · odds informativas
        </Badge>
        <h1 className="mt-3 max-w-2xl font-display text-3xl font-semibold uppercase leading-none tracking-tight md:text-4xl">
          {settings.brand_name}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {settings.tagline || "Calendário, mercados e cotações de futebol em um só lugar."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/competicoes">
              <Trophy className="mr-2 h-4 w-4" /> Competições
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/busca">
              <Search className="mr-2 h-4 w-4" /> Buscar time
            </Link>
          </Button>
        </div>
      </section>

      <BannerCarousel />

      <PixActions />

      <section>
        <EventFilters
          filters={filters}
          onChange={setFilters}
          competitions={competitions}
          countries={countries}
          onSubmitSearch={(term) => navigate(term ? `/busca?q=${encodeURIComponent(term)}` : "/busca")}
        />
      </section>

      <section>
        <SectionHeading icon={Star} title="Competições na base" to="/competicoes" actionLabel="Ver todas" />
        <CompetitionChips competitions={competitions.slice(0, 8)} loading={competitionsLoading} />
      </section>

      <section>
        <SectionHeading
          icon={Flame}
          title="Próximos jogos"
          subtitle="Horários de Brasília · escolha o dia para filtrar"
        />
        <div className="mb-3">
          <DateStrip value={filters.date} onChange={(date) => setFilters((current) => ({ ...current, date }))} />
        </div>
        <EventGrid
          events={upcoming}
          oddsByEvent={feed.oddsByEvent}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          emptyTitle="Nenhuma partida encontrada"
          emptyDescription="Ajuste competição, país ou data para ver outros jogos."
        />
        {feed.hasMore && (
          <div className="mt-3 flex justify-center">
            <Button variant="outline" onClick={feed.loadMore} disabled={feed.loading}>
              Carregar mais partidas
            </Button>
          </div>
        )}
      </section>

      <section>
        <SectionHeading icon={History} title="Últimos resultados" subtitle="Resultados confirmados pela fonte de dados" />
        {resultsFeed.loading ? (
          <CardListSkeleton count={2} />
        ) : resultsFeed.events.length ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {resultsFeed.events.map((event) => (
              <ResultRow key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum resultado registrado até agora.</p>
        )}
      </section>

      <AppDownloadPrompt />
    </div>
  );
}
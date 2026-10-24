import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, Flame, History, Radio, Star, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EventFilters from "@/components/odds/EventFilters";
import EventGrid from "@/components/odds/EventGrid";
import ResultRow from "@/components/odds/ResultRow";
import SectionHeading from "@/components/common/SectionHeading";
import PixActions from "@/components/wallet/PixActions";
import BannerCarousel from "@/components/banners/BannerCarousel";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import useEventFeed from "@/lib/useEventFeed";
import useCompetitions from "@/lib/useCompetitions";
import { useAppSettings } from "@/lib/appSettings";
import { buildEventFilter } from "@/lib/eventQueries";
import { SPORTS } from "@/lib/sports";
import { dayRangeFromInput } from "@/lib/format";

const PAST = { status: "finished" };

function CompetitionChips() {
  const { competitions, loading } = useCompetitions({ featured: true, limit: 8 });
  if (loading) return <div className="h-9 w-full animate-pulse rounded-lg bg-secondary" />;
  if (!competitions.length) {
    return <p className="text-xs text-muted-foreground">Competições em destaque aparecerão aqui quando cadastradas.</p>;
  }
  return (
    <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {competitions.map((competition) => (
        <Link
          key={competition.id}
          to={`/competicoes?competition=${competition.id}`}
          className="shrink-0 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/50"
        >
          <span className="block font-medium">{competition.name}</span>
          <span className="text-[11px] text-muted-foreground">
            {competition.country || "Internacional"} · {competition.season || "temporada atual"}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default function Home() {
  const settings = useAppSettings();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: "", sport: "", country: "", competition: "", date: "" });
  const { competitions } = useCompetitions({ limit: 50 });

  // Marca o instante da montagem: a partir dele nenhuma partida já iniciada
  // entra nas listas de próximos jogos.
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const featuredFilter = useMemo(
    () => ({ status: "scheduled", is_featured: true, start_time: { $gte: nowIso } }),
    [nowIso],
  );

  const liveFilter = useMemo(() => buildEventFilter({ status: "live" }), []);
  const liveFeed = useEventFeed(liveFilter, { limit: 6 });
  const featuredFeed = useEventFeed(featuredFilter, { limit: 4, sort: "start_time" });
  const resultsFeed = useEventFeed(PAST, { limit: 4, sort: "-start_time" });

  const feedFilter = useMemo(
    () =>
      buildEventFilter({
        sportSlug: filters.sport,
        competitionId: filters.competition,
        country: filters.country,
        dayRange: dayRangeFromInput(filters.date),
        status: "scheduled",
        from: nowIso,
      }),
    [filters.sport, filters.competition, filters.country, filters.date, nowIso],
  );
  const feed = useEventFeed(feedFilter, { limit: 10 });

  const featured = featuredFeed.events;
  const live = liveFeed.events;

  return (
    <div className="space-y-7">
      <section className="card-surface relative overflow-hidden px-4 py-5 md:px-6 md:py-7">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(35rem_18rem_at_85%_0%,hsl(var(--primary)/0.16),transparent)]" />
        <Badge variant="outline" className="border-primary/40 text-primary">
          Acompanhamento esportivo
        </Badge>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">
          {settings.brand_name} — odds informativas de vários esportes
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {settings.tagline ||
            "Acompanhe partidas, competições e mercados em um só lugar, com odds atualizadas."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/ao-vivo">
              <Radio className="mr-2 h-4 w-4" /> Partidas ao vivo
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/esportes">
              <BarChart3 className="mr-2 h-4 w-4" /> Todos os esportes
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
          sports={SPORTS}
          competitions={competitions}
          onSubmitSearch={(term) => navigate(term ? `/busca?q=${encodeURIComponent(term)}` : "/busca")}
        />
      </section>

      {live.length > 0 && (
        <section>
          <SectionHeading
            icon={Radio}
            title="Ao vivo agora"
            subtitle="Placar e status atualizados conforme a fonte de dados"
            to="/ao-vivo"
          />
          <EventGrid events={live} oddsByEvent={liveFeed.oddsByEvent} loading={liveFeed.loading} />
        </section>
      )}

      <section>
        <SectionHeading
          icon={Star}
          title="Eventos em destaque"
          subtitle="Principais ligas e torneios monitorados"
          to="/competicoes"
          actionLabel="Competições"
        />
        {featuredFeed.loading ? (
          <CardListSkeleton count={2} />
        ) : featured.length ? (
          <EventGrid events={featured} oddsByEvent={featuredFeed.oddsByEvent} />
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum evento em destaque disponível no momento.</p>
        )}
      </section>

      <section>
        <SectionHeading icon={TrendingUp} title="Principais ligas e competições" to="/competicoes" />
        <CompetitionChips />
      </section>

      <section>
        <SectionHeading
          icon={Flame}
          title="Próximos jogos"
          subtitle="Horários no fuso de Brasília · use os filtros para refinar"
        />
        <EventGrid
          events={feed.events}
          oddsByEvent={feed.oddsByEvent}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          emptyTitle="Nenhuma partida encontrada"
          emptyDescription="Ajuste esporte, competição ou data para ver outros eventos."
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
    </div>
  );
}
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import BannerCarousel from "@/components/banners/BannerCarousel";
import SuperOddsStrip from "@/components/odds/SuperOddsStrip";
import SuperMultiples from "@/components/odds/SuperMultiples";
import CompetitionPills from "@/components/odds/CompetitionPills";
import DateStrip from "@/components/odds/DateStrip";
import EventRows from "@/components/odds/EventRows";
import ResultRow from "@/components/odds/ResultRow";
import SectionHeading from "@/components/common/SectionHeading";
import AppDownloadPrompt from "@/components/common/AppDownloadPrompt";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import useEventFeed from "@/lib/useEventFeed";
import useFootballCompetitions from "@/lib/useFootballCompetitions";
import { buildEventFilter, groupEventsByCompetition, sortEventsByRelevance } from "@/lib/eventQueries";
import { dayRangeFromInput, formatNumber, toDateInputValue } from "@/lib/format";

const PAST = { status: "finished" };
const TABS = [
  { key: "proximos", label: "Próximos" },
  { key: "hoje", label: "Hoje" },
];

export default function Home() {
  const { competitions, loading: competitionsLoading } = useFootballCompetitions({ limit: 150 });
  const [tab, setTab] = useState("proximos");
  const [date, setDate] = useState("");
  const [competition, setCompetition] = useState("");

  const today = useMemo(() => toDateInputValue(new Date()), []);
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const activeDate = tab === "hoje" ? today : date;

  const resultsFeed = useEventFeed(PAST, { limit: 4, sort: "-start_time" });

  const feedFilter = useMemo(
    () =>
      buildEventFilter({
        sportSlug: "futebol",
        competitionName: competition,
        dayRange: dayRangeFromInput(activeDate),
        status: "scheduled",
        from: nowIso,
      }),
    [competition, activeDate, nowIso],
  );
  const feed = useEventFeed(feedFilter, { limit: 18 });
  const upcoming = useMemo(() => sortEventsByRelevance(feed.events), [feed.events]);

  const groups = useMemo(() => groupEventsByCompetition(upcoming), [upcoming]);

  const pickDate = (value) => {
    setDate(value);
    setTab(value && value === today ? "hoje" : "proximos");
  };

  return (
    <div className="space-y-5">
      <SuperOddsStrip />

      <SuperMultiples />

      <BannerCarousel />

      <section className="panel">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <div className="flex items-center gap-1">
            {TABS.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTab(item.key);
                    if (item.key === "proximos") setDate("");
                  }}
                  className={`relative px-3 py-3 text-sm font-semibold transition-colors ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                  {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] uppercase tracking-wide text-muted-foreground sm:inline">
              {formatNumber(upcoming.length)} jogos
            </span>
            <Link
              to="/competicoes"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Competições
            </Link>
          </div>
        </div>

        <div className="space-y-2.5 border-b border-border px-3 py-3">
          <CompetitionPills
            competitions={competitions}
            value={competition}
            onChange={setCompetition}
            loading={competitionsLoading}
          />
          <DateStrip value={activeDate} onChange={pickDate} />
        </div>

        <EventRows
          groups={groups}
          oddsByEvent={feed.oddsByEvent}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          emptyTitle="Nenhuma partida encontrada"
          emptyDescription="Ajuste a competição ou a data para ver outros jogos."
        />

        {feed.hasMore && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="outline" size="sm" onClick={feed.loadMore} disabled={feed.loading}>
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
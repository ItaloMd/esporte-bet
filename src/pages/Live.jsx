import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { PauseCircle, Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import EventFilters from "@/components/odds/EventFilters";
import EventGrid from "@/components/odds/EventGrid";
import SectionHeading from "@/components/common/SectionHeading";
import useEventFeed from "@/lib/useEventFeed";
import useCompetitions from "@/lib/useCompetitions";
import { buildEventFilter, liveSectionOf, sortEventsByRelevance } from "@/lib/eventQueries";
import { timeAgo } from "@/lib/format";
import { SPORTS } from "@/lib/sports";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { EmptyState } from "@/components/state/States";

const REFRESH_MS = 60000;

/** Momento mais recente em que a fonte atualizou algum placar desta lista. */
function latestSourceUpdate(events) {
  return events.reduce((latest, event) => {
    const stamp = event.live_updated_at || event.last_sync_at;
    if (!stamp) return latest;
    return !latest || Date.parse(stamp) > Date.parse(latest) ? stamp : latest;
  }, null);
}

function LiveSection({ title, subtitle, events, oddsByEvent, loading }) {
  if (!events.length) return null;
  return (
    <section>
      <SectionHeading icon={Radio} title={title} subtitle={subtitle} />
      <EventGrid events={events} oddsByEvent={oddsByEvent} loading={loading} />
    </section>
  );
}

export default function Live() {
  const [filters, setFilters] = useState({ search: "", sport: "", country: "", competition: "", date: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const { competitions } = useCompetitions({ limit: 50 });

  // A janela de horário é recalculada a cada recarga: nunca fica congelada no
  // instante em que a página foi aberta.
  // Somente partidas brasileiras: a lista é única para todos os visitantes e
  // vem do cache compartilhado alimentado pelo detector central.
  const liveFilter = useMemo(
    () =>
      buildEventFilter({
        status: "live",
        brazilian: true,
        search: filters.search,
        sportSlug: filters.sport,
        competitionId: filters.competition,
      }),
    [filters.search, filters.sport, filters.competition, reloadKey],
  );
  const feed = useEventFeed(liveFilter, { limit: 30 });
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString());
  const dataAt = latestSourceUpdate(feed.events || []);
  const dataAtRef = useRef(null);
  dataAtRef.current = dataAt;

  useEffect(() => {
    // Sincronização compartilhada: a tela só pede a atualização quando o placar
    // está defasado. O backend decide se executa (intervalo + trava + orçamento),
    // então todos os visitantes juntos geram no máximo uma chamada por minuto —
    // nunca uma chamada por pessoa.
    const timer = setInterval(async () => {
      const stamp = dataAtRef.current ? Date.parse(dataAtRef.current) : 0;
      if (stamp && Date.now() - stamp > 75000) {
        await base44.functions.invoke("syncFootballLive", { trigger: "page" }).catch(() => null);
      }
      feed.reload();
      setReloadKey((key) => key + 1);
      setLastRefresh(new Date().toISOString());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [feed.reload]);

  // Classificação pela fase oficial gravada pela fonte: só fases de jogo em
  // andamento ficam na lista ativa; suspensas/interrompidas ganham seção
  // própria; encerradas e não iniciadas saem da aba ao vivo.
  const groups = useMemo(() => {
    const active = [];
    const interrupted = [];
    (feed.events || []).forEach((event) => {
      const section = liveSectionOf(event);
      if (section === "interrupted") interrupted.push(event);
      else if (section === "active") active.push(event);
    });
    return {
      active: sortEventsByRelevance(active),
      interrupted: sortEventsByRelevance(interrupted),
    };
  }, [feed.events]);

  const hasAny = groups.active.length + groups.interrupted.length > 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-destructive/40 bg-destructive/10">
            <Radio className="h-5 w-5 text-destructive" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Partidas ao vivo</h1>
            <p className="text-xs text-muted-foreground">
              {dataAt ? `Placar atualizado ${timeAgo(dataAt)}` : "Aguardando a próxima sincronização de placares"} ·
              tela recarregada {timeAgo(lastRefresh)}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            feed.reload();
            setReloadKey((key) => key + 1);
            setLastRefresh(new Date().toISOString());
          }}
          disabled={feed.loading}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${feed.loading ? "animate-spin" : ""}`} />
          Atualizar agora
        </Button>
      </header>

      <EventFilters
        filters={filters}
        onChange={setFilters}
        sports={SPORTS}
        competitions={competitions}
        onSubmitSearch={(term) => setFilters((current) => ({ ...current, search: term }))}
      />

      {feed.loading && !hasAny ? (
        <CardListSkeleton count={4} />
      ) : !hasAny ? (
        <EmptyState
          title="Nenhuma partida brasileira ao vivo agora"
          description="Quando a fonte de dados informar partidas brasileiras em andamento, elas aparecem nesta página automaticamente — nenhuma partida encerrada permanece listada."
        />
      ) : (
        <>
          <LiveSection
            title="Partidas brasileiras ao vivo"
            subtitle="Competições nacionais, estaduais e regionais em andamento"
            events={groups.active}
            oddsByEvent={feed.oddsByEvent}
            loading={feed.loading}
          />
          {groups.interrupted.length > 0 && (
            <section>
              <SectionHeading
                icon={PauseCircle}
                title="Interrompidas ou suspensas"
                subtitle="Partidas paradas por suspensão ou interrupção, fora da lista de jogos normalmente ativos"
              />
              <EventGrid events={groups.interrupted} oddsByEvent={feed.oddsByEvent} loading={feed.loading} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
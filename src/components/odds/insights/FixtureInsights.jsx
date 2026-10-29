import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import StatsTable from "@/components/odds/insights/StatsTable";
import EventsTimeline from "@/components/odds/insights/EventsTimeline";
import HistoryLists from "@/components/odds/insights/HistoryLists";

/**
 * Acompanhamento da partida: placar e status vivem no cabeçalho; aqui entram
 * estatísticas, eventos e histórico, sempre com dados reais da API-Football.
 * Nada é inventado quando a competição não tem cobertura.
 */
export default function FixtureInsights({ event }) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const res = await base44.functions.invoke("fixtureInsights", { event_id: event.id });
      setState({ loading: false, data: res, error: "" });
    } catch (error) {
      setState({ loading: false, data: null, error: error?.message || "Falha ao carregar o acompanhamento." });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id]);

  if (!event.fixture_id) {
    return (
      <section className="card-surface px-4 py-4">
        <h2 className="text-sm font-semibold">Estatísticas e resultados anteriores</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Esta partida ainda não tem vínculo com a fonte de dados, por isso não há acompanhamento disponível.
        </p>
      </section>
    );
  }

  if (state.loading) {
    return (
      <div className="space-y-3">
        <div className="card-surface h-40 animate-pulse" />
        <div className="card-surface h-28 animate-pulse" />
      </div>
    );
  }

  if (state.error) {
    return (
      <section className="card-surface px-4 py-4">
        <h2 className="text-sm font-semibold">Estatísticas e resultados anteriores</h2>
        <p className="mt-1 text-xs text-muted-foreground">{state.error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary/50 hover:text-primary"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" /> Tentar novamente
        </button>
      </section>
    );
  }

  const data = state.data;
  const sections = data?.sections || {};
  const nothingAvailable = !data?.available;

  return (
    <div className="space-y-4">
      {nothingAvailable ? (
        <section className="card-surface px-4 py-4">
          <h2 className="text-sm font-semibold">Estatísticas e resultados anteriores</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data?.reason || "A fonte de dados ainda não trouxe acompanhamento para esta partida."}
          </p>
        </section>
      ) : (
        <>
          <StatsTable rows={sections.statistics} />
          <EventsTimeline items={sections.events} />
          <HistoryLists
            h2h={sections.h2h}
            homeRecent={sections.home_recent}
            awayRecent={sections.away_recent}
            homeName={event.home_team_name}
            awayName={event.away_team_name}
          />
          <p className="px-1 text-[11px] text-muted-foreground">
            Dados oficiais da API-Football · atualizados em {new Date(data.updated_at).toLocaleString("pt-BR")}
          </p>
        </>
      )}
    </div>
  );
}
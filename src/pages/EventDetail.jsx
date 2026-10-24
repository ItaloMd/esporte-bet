import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import EventHeader from "@/components/odds/EventHeader";
import MarketSection from "@/components/odds/MarketSection";
import SportIcon from "@/components/sports/SportIcon";
import { ErrorState } from "@/components/state/States";
import { marketGroupLabel, sportName } from "@/lib/sports";
import { decorateOdds } from "@/lib/eventQueries";

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: "", event: null, markets: [] });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const event = await base44.entities.Event.get(id);
        const [marketsPage, oddsPage] = await Promise.all([
          base44.entities.Market.filter({ event_id: id }, { sort: "sort_order", limit: 60 }),
          base44.entities.Odd.filter({ event_id: id }, { sort: "sort_order", limit: 200 }),
        ]);
        if (!active) return;
        const decorated = decorateOdds(oddsPage.items || [], event);
        const markets = (marketsPage.items || []).map((market) => ({
          ...market,
          odds: decorated.filter((odd) => odd.market_id === market.id),
        }));
        setState({ loading: false, error: "", event, markets });
      } catch (error) {
        if (!active) return;
        setState({ loading: false, error: error.message || "Evento não encontrado.", event: null, markets: [] });
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [id]);

  if (state.loading) {
    return (
      <div className="space-y-3">
        <div className="card-surface h-48 animate-pulse" />
        <div className="card-surface h-28 animate-pulse" />
        <div className="card-surface h-28 animate-pulse" />
      </div>
    );
  }

  if (state.error) {
    return <ErrorState message={state.error} onRetry={() => navigate("/")} />;
  }

  const grouped = state.markets.reduce((acc, market) => {
    const key = market.market_group || "estatisticas";
    if (!acc[key]) acc[key] = [];
    acc[key].push(market);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <EventHeader event={state.event} />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          to={state.event.sport_slug === "futebol" ? "/esporte/futebol" : `/esporte/${state.event.sport_slug}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 hover:border-primary/50 hover:text-primary"
        >
          <SportIcon slug={state.event.sport_slug} className="h-3.5 w-3.5" />
          {sportName(state.event.sport_slug)}
        </Link>
        <span>Mercados retornados pela fonte de dados</span>
      </div>

      {!state.markets.length && (
        <div className="card-surface px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum mercado disponível para esta partida na fonte de dados atual.
        </div>
      )}

      {Object.entries(grouped).map(([group, markets]) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {marketGroupLabel(group)}
          </h2>
          {markets.map((market) => (
            <MarketSection key={market.id} market={market} odds={market.odds} />
          ))}
        </section>
      ))}

      <section className="card-surface px-4 py-4">
        <h2 className="text-sm font-semibold">Estatísticas e resultados anteriores</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Não há fonte confiável de estatísticas configurada nesta fase, por isso nenhum dado histórico é exibido.
          Ao conectar um provedor, estas informações passam a aparecer aqui.
        </p>
      </section>
    </div>
  );
}
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import EventHeader from "@/components/odds/EventHeader";
import MarketSection from "@/components/odds/MarketSection";
import SportIcon from "@/components/sports/SportIcon";
import { ErrorState } from "@/components/state/States";
import FixtureInsights from "@/components/odds/insights/FixtureInsights";
import { marketGroupLabel, sportName } from "@/lib/sports";
import { bestBySelection, decorateOdds, orderMarketOdds } from "@/lib/eventQueries";

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: "", event: null, markets: [], bettable: false });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const event = await base44.entities.Event.get(id);
        const [marketsPage, oddsPage] = await Promise.all([
          base44.entities.Market.filter({ event_id: id }, { sort: "sort_order", limit: 60 }),
          base44.entities.Odd.filter({ event_id: id }, { sort: "sort_order", limit: 500 }),
        ]);
        if (!active) return;
        const decorated = decorateOdds(oddsPage.items || [], event);
        // Sem cotação publicada ou com a partida já iniciada, nenhuma seleção
        // pode ser adicionada ao bilhete.
        const bettable = Boolean(event.published) && Date.parse(event.start_time) > Date.now();
        // Somente cotações abertas são exibidas: suspensas saem da grade sem
        // aviso repetido, e o mercado inteiro desaparece quando nada resta aberto.
        const markets = (marketsPage.items || [])
          .map((market) => ({
            ...market,
            odds: orderMarketOdds(
              market,
              bestBySelection(decorated.filter((odd) => odd.market_id === market.id)),
            ),
          }))
          .filter((market) => market.odds.length > 0);
        setState({ loading: false, error: "", event, markets, bettable });
      } catch (error) {
        if (!active) return;
        setState({ loading: false, error: error.message || "Evento não encontrado.", event: null, markets: [], bettable: false });
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

      {!state.bettable && (
        <div className="card-surface border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          Esta partida não está disponível para novas apostas: as cotações ainda não foram
          publicadas ou o horário de início já passou.
        </div>
      )}

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

      <FixtureInsights event={state.event} />
    </div>
  );
}
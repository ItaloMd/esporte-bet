import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Competições e países realmente presentes na base de eventos (futebol).
 * A lista vem dos próprios jogos sincronizados, então só aparece o que existe
 * de fato — e o filtro casa pelo nome da competição gravado no evento.
 */
const CACHE_KEY = "football-competitions";
const TTL = 5 * 60 * 1000;
const cache = new Map();

export default function useFootballCompetitions({ limit = 150 } = {}) {
  const [state, setState] = useState(
    () => cache.get(CACHE_KEY)?.value || { competitions: [], countries: [], loading: true },
  );

  useEffect(() => {
    const entry = cache.get(CACHE_KEY);
    if (entry && Date.now() - entry.time < TTL) {
      setState(entry.value);
      return undefined;
    }
    let active = true;
    Promise.all([
      base44.entities.Event.aggregate({
        query: { sport_slug: "futebol", status: "scheduled" },
        groupBy: "competition_name",
      }),
      base44.entities.Event.aggregate({
        query: { sport_slug: "futebol", status: "scheduled" },
        groupBy: "country",
      }),
    ])
      .then(([competitionResult, countryResult]) => {
        const competitions = (competitionResult.rows || [])
          .filter((row) => row.competition_name)
          .map((row) => ({ name: row.competition_name, count: Number(row.count) || 0 }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"))
          .slice(0, limit);
        const countries = (countryResult.rows || [])
          .filter((row) => row.country)
          .map((row) => ({ name: row.country, count: Number(row.count) || 0 }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"))
          .slice(0, 60);
        const value = { competitions, countries, loading: false };
        cache.set(CACHE_KEY, { value, time: Date.now() });
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setState({ competitions: [], countries: [], loading: false });
      });
    return () => {
      active = false;
    };
  }, [limit]);

  return state;
}
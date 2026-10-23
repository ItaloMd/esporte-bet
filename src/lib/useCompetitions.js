import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

const cache = new Map();
const TTL = 5 * 60 * 1000;

export default function useCompetitions({ sportSlug, featured, limit = 50 } = {}) {
  const key = JSON.stringify({ sportSlug, featured, limit });
  const [state, setState] = useState(() => cache.get(key)?.value || { competitions: [], loading: true });

  useEffect(() => {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.time < TTL) {
      setState(entry.value);
      return;
    }
    let active = true;
    const filter = {};
    if (sportSlug && sportSlug !== "outros") filter.sport_slug = sportSlug;
    if (featured) filter.featured = true;
    base44.entities.Competition.filter(filter, { sort: "name", limit })
      .then((page) => {
        const value = { competitions: page.items || [], loading: false };
        cache.set(key, { value, time: Date.now() });
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setState({ competitions: [], loading: false });
      });
    return () => {
      active = false;
    };
  }, [key, sportSlug, featured, limit]);

  return state;
}
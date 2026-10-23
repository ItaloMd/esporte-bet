import { useCallback, useEffect, useRef, useState } from "react";
import { loadEventFeed } from "@/lib/eventQueries";

export default function useEventFeed(filter, options = {}) {
  const { sort = "start_time", limit = 12, enabled = true } = options;
  const filterKey = JSON.stringify(filter || {});
  const [state, setState] = useState({
    events: [],
    oddsByEvent: {},
    loading: Boolean(enabled),
    error: "",
    hasMore: false,
  });
  const cursorRef = useRef(null);
  const requestRef = useRef(0);

  const run = useCallback(
    async ({ cursor = null, append = false } = {}) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const result = await loadEventFeed(JSON.parse(filterKey), { sort, limit, cursor });
        if (requestRef.current !== requestId) return;
        cursorRef.current = result.nextCursor || null;
        setState((current) => ({
          events: append ? [...current.events, ...result.events] : result.events,
          oddsByEvent: append ? { ...current.oddsByEvent, ...result.oddsByEvent } : result.oddsByEvent,
          loading: false,
          error: "",
          hasMore: result.hasMore,
        }));
      } catch (error) {
        if (requestRef.current !== requestId) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error.message || "Falha ao carregar eventos.",
        }));
      }
    },
    [filterKey, sort, limit],
  );

  useEffect(() => {
    if (enabled) run();
    else setState((current) => ({ ...current, loading: false }));
  }, [run, enabled]);

  const reload = useCallback(() => run(), [run]);
  const loadMore = useCallback(() => run({ cursor: cursorRef.current, append: true }), [run]);

  return {
    ...state,
    reload,
    loadMore,
  };
}
import React, { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import EventRows from "@/components/odds/EventRows";
import useEventFeed from "@/lib/useEventFeed";
import { buildEventFilter, groupEventsByCompetition } from "@/lib/eventQueries";

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const term = params.get("q") || "";

  const filter = useMemo(() => buildEventFilter({ search: term }), [term]);
  const feed = useEventFeed(filter, { limit: 12, enabled: Boolean(term.trim()) });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Busca</h1>
        <p className="text-xs text-muted-foreground">Encontre partidas por equipe ou competição</p>
      </header>

      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          const value = event.target.elements.q.value.trim();
          setParams(value ? { q: value } : {});
        }}
      >
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          name="q"
          defaultValue={term}
          placeholder="Ex.: Flamengo, Champions League, Libertadores"
          className="h-11 pl-9"
          aria-label="Buscar partidas"
        />
      </form>

      {!term.trim() ? (
        <p className="text-sm text-muted-foreground">Digite o nome de uma equipe ou competição para começar.</p>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Resultados para “{term}”
          </h2>
          <div className="panel">
            <EventRows
              groups={groupEventsByCompetition(feed.events)}
              oddsByEvent={feed.oddsByEvent}
              loading={feed.loading}
              error={feed.error}
              onRetry={feed.reload}
              emptyTitle="Nenhuma partida encontrada"
              emptyDescription="Verifique a grafia ou tente outro nome."
            />
          </div>
        </section>
      )}
    </div>
  );
}
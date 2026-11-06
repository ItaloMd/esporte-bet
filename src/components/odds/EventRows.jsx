import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import EventRow from "@/components/odds/EventRow";
import { flagFor } from "@/lib/flags";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { EmptyState, ErrorState } from "@/components/state/States";

/** Lista principal: partidas agrupadas por competição, como nas casas de apostas. */
export default function EventRows({ groups = [], oddsByEvent = {}, loading, error, onRetry, emptyTitle, emptyDescription }) {
  if (loading) return <div className="p-3"><CardListSkeleton count={3} /></div>;
  if (error) return <div className="p-3"><ErrorState message={error} onRetry={onRetry} /></div>;
  if (!groups.length) {
    return (
      <div className="p-3">
        <EmptyState
          title={emptyTitle || "Nenhuma partida encontrada"}
          description={emptyDescription || "Ajuste a competição ou a data para ver outros jogos."}
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/70">
      {groups.map((group) => (
        <section key={group.name}>
          <header className="flex items-center gap-2 bg-secondary/40 px-3 py-2">
            {flagFor(group.country) && <span className="text-sm leading-none">{flagFor(group.country)}</span>}
            <h3 className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {group.name}
            </h3>
            <span className="rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {group.events.length}
            </span>
            <Link
              to={`/competicoes?competition=${encodeURIComponent(group.name)}`}
              className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary hover:underline"
            >
              Ver <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </header>
          <div className="divide-y divide-border/50">
            {group.events.map((event) => (
              <EventRow key={event.id} event={event} odds={oddsByEvent[event.id] || []} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
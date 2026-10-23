import React from "react";
import EventCard from "@/components/odds/EventCard";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { EmptyState, ErrorState } from "@/components/state/States";

export default function EventGrid({
  events = [],
  oddsByEvent = {},
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  showCompetition = true,
}) {
  if (loading) return <CardListSkeleton count={4} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!events.length) {
    return (
      <EmptyState
        title={emptyTitle || "Nenhum evento disponível"}
        description={emptyDescription || "Ajuste os filtros ou consulte novamente mais tarde."}
      />
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {events.map((event) => (
        <EventCard key={event.id} event={event} odds={oddsByEvent[event.id] || []} showCompetition={showCompetition} />
      ))}
    </div>
  );
}
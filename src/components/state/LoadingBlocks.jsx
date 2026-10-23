import React from "react";

export function EventCardSkeleton() {
  return (
    <div className="card-surface animate-pulse p-4">
      <div className="h-3 w-28 rounded bg-secondary" />
      <div className="mt-3 h-5 w-40 rounded bg-secondary" />
      <div className="mt-2 h-5 w-32 rounded bg-secondary" />
      <div className="mt-4 flex gap-2">
        <div className="h-10 flex-1 rounded-lg bg-secondary" />
        <div className="h-10 flex-1 rounded-lg bg-secondary" />
        <div className="h-10 flex-1 rounded-lg bg-secondary" />
      </div>
    </div>
  );
}

export function CardListSkeleton({ count = 4 }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <EventCardSkeleton key={index} />
      ))}
    </div>
  );
}
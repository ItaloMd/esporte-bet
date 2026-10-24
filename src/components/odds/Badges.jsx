import React from "react";

export function LiveBadge({ minute, label }) {
  const text = label
    ? `${label}${minute ? ` · ${minute}'` : ""}`
    : `Ao vivo${minute ? ` ${minute}'` : ""}`;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
      </span>
      {text}
    </span>
  );
}

export function StatusBadge({ status }) {
  const map = {
    scheduled: { label: "Agendado", className: "bg-secondary text-muted-foreground" },
    finished: { label: "Encerrado", className: "bg-secondary text-muted-foreground" },
    postponed: { label: "Adiado", className: "bg-amber-500/15 text-amber-400" },
    cancelled: { label: "Cancelado", className: "bg-destructive/15 text-destructive" },
  };
  const item = map[status];
  if (!item) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${item.className}`}>{item.label}</span>
  );
}
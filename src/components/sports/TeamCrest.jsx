import React from "react";
import { Image } from "@/components/ui/image";

function initials(name) {
  return String(name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function TeamCrest({ name, crest, className = "h-7 w-7" }) {
  if (crest) {
    return (
      <span className={`${className} shrink-0 overflow-hidden rounded-md border border-border/70 bg-secondary/60 p-0.5`}>
        <Image src={crest} alt={`Escudo de ${name}`} fittingType="fit" className="h-full w-full" />
      </span>
    );
  }
  return (
    <span className={`${className} shrink-0 grid place-items-center rounded-md border border-border/70 bg-secondary/60 text-[11px] font-semibold text-muted-foreground`}>
      {initials(name)}
    </span>
  );
}
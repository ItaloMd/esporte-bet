import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

/** Lista pesquisável de campeonatos ou equipes, com pontuação por item escolhido. */
export default function RelevanceList({ items, selected, onToggle, onScore, placeholder, emptyLabel }) {
  const [term, setTerm] = useState("");

  const filtered = useMemo(() => {
    const key = term.trim().toLowerCase();
    const list = key
      ? items.filter((item) => `${item.name} ${item.meta}`.toLowerCase().includes(key))
      : items;
    return list.slice(0, 60);
  }, [items, term]);

  return (
    <div className="space-y-2">
      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder={placeholder} className="h-9" />
      {!filtered.length ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {filtered.map((item) => {
            const chosen = selected[item.key];
            return (
              <div key={item.key} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-2 py-1.5">
                <Checkbox checked={chosen !== undefined} onCheckedChange={() => onToggle(item)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{item.meta}</p>
                </div>
                {chosen !== undefined && (
                  <Input
                    type="number"
                    min="0"
                    max="50"
                    value={chosen}
                    onChange={(event) => onScore(item.key, Number(event.target.value))}
                    className="h-7 w-16 text-xs"
                    aria-label={`Pontuação de ${item.name}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
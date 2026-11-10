import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GAME_CATEGORIES } from "@/lib/gaming";

export default function GameFilters({ search, onSearch, category, onCategory }) {
  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Buscar jogo ou provedor"
          className="h-10 pl-9"
          aria-label="Buscar jogo"
        />
      </div>
      <div className="hide-scrollbar flex gap-1.5 overflow-x-auto pb-1">
        {[{ key: "", label: "Todos" }, ...GAME_CATEGORIES].map((item) => {
          const active = category === item.key;
          return (
            <button
              key={item.key || "all"}
              type="button"
              onClick={() => onCategory(item.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "border-primary bg-primary/15 font-semibold text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
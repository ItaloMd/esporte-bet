import React from "react";
import { CalendarDays, Filter, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Filtros da listagem de jogos. `competitions` e `countries` vêm da base de
 * eventos (nome + quantidade), então o filtro casa exatamente com o que existe.
 */
export default function EventFilters({ filters, onChange, competitions = [], countries = [], onSubmitSearch }) {
  const update = (patch) => onChange({ ...filters, ...patch });
  const hasExtra = Boolean(filters.competition || filters.date || filters.country);

  return (
    <div className="card-surface flex flex-col gap-3 p-3.5">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitSearch?.(filters.search);
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={filters.search || ""}
            onChange={(event) => update({ search: event.target.value })}
            placeholder="Buscar time ou competição"
            className="h-10 pl-9"
            aria-label="Buscar time ou competição"
          />
        </div>
        <Button type="submit" className="h-10">Buscar</Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="filter-country">País</label>
        <select
          id="filter-country"
          value={filters.country || ""}
          onChange={(event) => update({ country: event.target.value, competition: "" })}
          className="h-9 max-w-[11rem] rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
        >
          <option value="">Todos os países</option>
          {countries.map((country) => (
            <option key={country.name} value={country.name}>
              {country.name} ({country.count})
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-competition">Competição</label>
        <select
          id="filter-competition"
          value={filters.competition || ""}
          onChange={(event) => update({ competition: event.target.value })}
          className="h-9 max-w-[15rem] rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
        >
          <option value="">Todas as competições</option>
          {competitions.map((competition) => (
            <option key={competition.name} value={competition.name}>
              {competition.name} ({competition.count})
            </option>
          ))}
        </select>

        <label className="relative inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-2.5 text-sm" htmlFor="filter-date">
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Data</span>
          <input
            id="filter-date"
            type="date"
            value={filters.date || ""}
            onChange={(event) => update({ date: event.target.value })}
            className="h-9 bg-transparent text-sm outline-none"
          />
        </label>

        {hasExtra && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-muted-foreground"
            onClick={() => onChange({ search: filters.search })}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Limpar filtros
          </Button>
        )}

        <span className="ml-auto hidden items-center gap-1.5 self-center text-xs text-muted-foreground sm:inline-flex">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Horários de Brasília
        </span>
      </div>
    </div>
  );
}
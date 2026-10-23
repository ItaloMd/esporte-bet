import React, { useMemo } from "react";
import { CalendarDays, Filter, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function EventFilters({ filters, onChange, sports, competitions, onSubmitSearch }) {
  const update = (patch) => onChange({ ...filters, ...patch });
  const hasExtra = Boolean(filters.sport || filters.competition || filters.date || filters.country);

  const countries = useMemo(() => {
    const scoped = filters.sport ? competitions.filter((item) => item.sport_slug === filters.sport) : competitions;
    return [...new Set(scoped.map((item) => item.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [competitions, filters.sport]);

  const competitionOptions = filters.country
    ? competitions.filter((item) => item.country === filters.country)
    : competitions;

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
            placeholder="Buscar equipe ou competição"
            className="h-10 pl-9"
            aria-label="Buscar equipe ou competição"
          />
        </div>
        <Button type="submit" className="h-10">Buscar</Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="filter-sport">Esporte</label>
        <select
          id="filter-sport"
          value={filters.sport || ""}
          onChange={(event) => update({ sport: event.target.value, competition: "", country: "" })}
          className="h-9 rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
        >
          <option value="">Todos os esportes</option>
          {sports.map((sport) => (
            <option key={sport.slug} value={sport.slug}>{sport.name}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-country">País</label>
        <select
          id="filter-country"
          value={filters.country || ""}
          onChange={(event) => update({ country: event.target.value, competition: "" })}
          className="h-9 max-w-[11rem] rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
        >
          <option value="">Todos os países</option>
          {countries.map((country) => (
            <option key={country} value={country}>{country}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-competition">Competição</label>
        <select
          id="filter-competition"
          value={filters.competition || ""}
          onChange={(event) => update({ competition: event.target.value })}
          className="h-9 max-w-[13rem] rounded-lg border border-border bg-secondary/60 px-2.5 text-sm"
        >
          <option value="">Todas as competições</option>
          {competitionOptions.map((competition) => (
            <option key={competition.id} value={competition.id}>{competition.name}</option>
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
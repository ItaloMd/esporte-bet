import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Trophy } from "lucide-react";
import useFootballCompetitions from "@/lib/useFootballCompetitions";
import { formatNumber } from "@/lib/format";

export default function SportsIndex() {
  const { competitions, countries, loading } = useFootballCompetitions({ limit: 150 });
  const totalGames = competitions.reduce((total, item) => total + item.count, 0);
  const top = competitions.slice(0, 12);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-tight">Futebol</h1>
        <p className="text-xs text-muted-foreground">
          {loading
            ? "Carregando competições…"
            : `${formatNumber(competitions.length)} competições · ${formatNumber(totalGames)} jogos na base · ${formatNumber(countries.length)} países`}
        </p>
      </header>

      <section className="card-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Competições com jogos importados</p>
          <p className="text-[11px] text-muted-foreground">Somente o que está na base de dados da plataforma</p>
        </div>
        <Link
          to="/competicoes"
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary"
        >
          <Trophy className="h-3.5 w-3.5" /> Ver todas
        </Link>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        {top.map((competition) => (
          <Link
            key={competition.name}
            to={`/competicoes?competition=${encodeURIComponent(competition.name)}`}
            className="card-surface flex items-center gap-3 px-4 py-3 transition-colors hover:border-primary/50"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{competition.name}</span>
              <span className="text-[11px] text-muted-foreground">{competition.count} jogos agendados</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
        {!loading && !top.length && (
          <p className="text-sm text-muted-foreground">Nenhuma competição importada até agora.</p>
        )}
      </div>
    </div>
  );
}
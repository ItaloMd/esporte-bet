import React, { useEffect, useState } from "react";
import { Gamepad2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import GameCard from "@/components/games/GameCard";
import GameFilters from "@/components/games/GameFilters";
import { fetchGames } from "@/lib/gaming";

export default function Casino() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [games, setGames] = useState([]);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      fetchGames({ search, category })
        .then((result) => {
          if (!active) return;
          setGames(result.items || []);
          setPage(result);
        })
        .catch(() => {
          if (active) setError("Não foi possível carregar o catálogo de jogos.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, category]);

  const loadMore = async () => {
    if (!page?.has_more) return;
    setLoading(true);
    const result = await fetchGames({ search, category, cursor: page.next_cursor });
    setGames((current) => [...current, ...(result.items || [])]);
    setPage(result);
    setLoading(false);
  };

  return (
    <div className="space-y-5">
      <header className="panel px-4 py-5 md:px-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15">
            <Gamepad2 className="h-5 w-5 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold md:text-2xl">Cassino</h1>
            <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
              Jogos do portfólio conectado. Saldo, sessão e histórico são os mesmos da sua carteira.
            </p>
          </div>
        </div>
      </header>

      <GameFilters search={search} onSearch={setSearch} category={category} onCategory={setCategory} />

      {error && (
        <div className="card-surface px-4 py-6 text-center text-sm text-destructive">{error}</div>
      )}

      {!error && loading && games.length === 0 && (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        </div>
      )}

      {!error && !loading && games.length === 0 && (
        <div className="card-surface px-4 py-14 text-center">
          <Gamepad2 className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 font-medium">Nenhum jogo disponível</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            O catálogo é preenchido a partir da conexão com o provedor. Assim que a conta estiver liberada, os jogos
            habilitados aparecem aqui.
          </p>
        </div>
      )}

      {games.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
          {page?.has_more && (
            <div className="flex justify-center pt-1">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                {loading ? "Carregando..." : "Carregar mais jogos"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
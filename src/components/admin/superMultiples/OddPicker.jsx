import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Search } from "lucide-react";
import { formatDateTime, formatOdds } from "@/lib/format";

/**
 * Busca uma partida do catálogo e lista as cotações abertas dela para o
 * administrador escolher a seleção que entra na super múltipla.
 */
export default function OddPicker({ pickedIds = [], onPick }) {
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [odds, setOdds] = useState([]);
  const [loadingOdds, setLoadingOdds] = useState(false);

  const search = async () => {
    const text = term.trim();
    setSearching(true);
    setEvent(null);
    setOdds([]);
    try {
      const conditions = [
        { $or: [{ status: "live" }, { status: "scheduled", start_time: { $gte: new Date().toISOString() } }] },
      ];
      if (text) {
        conditions.push({
          $or: [
            { home_team_name: { $regex: text, $options: "i" } },
            { away_team_name: { $regex: text, $options: "i" } },
            { competition_name: { $regex: text, $options: "i" } },
          ],
        });
      }
      const page = await base44.entities.Event.filter({ $and: conditions }, { limit: 8, sort: "start_time" });
      setEvents(page.items || []);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const selectEvent = async (target) => {
    setEvent(target);
    setEvents([]);
    setLoadingOdds(true);
    try {
      const page = await base44.entities.Odd.filter(
        { event_id: target.id, status: "open" },
        { limit: 60, sort: "sort_order" },
      );
      setOdds(page.items || []);
    } finally {
      setLoadingOdds(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label htmlFor="multiple-term" className="text-xs font-medium">
            Jogo: time ou competição
          </label>
          <Input
            id="multiple-term"
            value={term}
            placeholder="Flamengo, Brasileirão…"
            onChange={(changeEvent) => setTerm(changeEvent.target.value)}
            onKeyDown={(keyEvent) => keyEvent.key === "Enter" && search()}
          />
        </div>
        <Button onClick={search} disabled={searching}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Buscar
        </Button>
      </div>

      {events.length > 0 && (
        <div className="space-y-2">
          {events.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => selectEvent(row)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-xs transition-colors hover:border-primary/50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {row.home_team_name} x {row.away_team_name}
                  {row.status === "live" && <span className="ml-2 text-destructive">ao vivo</span>}
                </span>
                <span className="block truncate text-muted-foreground">
                  {row.competition_name} · {formatDateTime(row.start_time)}
                </span>
              </span>
              <span className="shrink-0 text-primary">Selecionar</span>
            </button>
          ))}
        </div>
      )}

      {event && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">
                {event.home_team_name} x {event.away_team_name}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {event.competition_name} · {formatDateTime(event.start_time)}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setEvent(null); setOdds([]); }}>
              Trocar jogo
            </Button>
          </div>

          {loadingOdds ? (
            <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />
          ) : odds.length ? (
            <div className="space-y-1.5">
              {odds.map((odd) => {
                const used = pickedIds.includes(odd.id);
                return (
                  <div key={odd.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{odd.label}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{odd.market_name}</p>
                    </div>
                    <span className="score-num shrink-0 text-xs">{formatOdds(odd.value)}</span>
                    <Button size="sm" variant={used ? "ghost" : "default"} disabled={used} onClick={() => onPick(odd, event)}>
                      {used ? "Na múltipla" : <><Plus className="h-3.5 w-3.5" /> Incluir</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma cotação aberta para este jogo.</p>
          )}
        </div>
      )}

      {searched && !searching && !events.length && !event && (
        <p className="text-xs text-muted-foreground">Nenhuma partida encontrada para a busca.</p>
      )}
    </div>
  );
}
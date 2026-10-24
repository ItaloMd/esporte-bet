import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { formatOdds, formatDateTime } from "@/lib/format";
import { Loader2, Search, Zap } from "lucide-react";
import SuperOddList from "@/components/admin/SuperOddList";

const parseValue = (raw) => Number(String(raw ?? "").replace(",", "."));

/**
 * Registra super odds: escolhe uma partida já salva pela fonte de odds e marca
 * uma seleção com o valor promocional. O valor entra na cotação em si, então a
 * caixa aparece em destaque vermelho para o jogador.
 */
export default function AdminSuperOdds() {
  const { toast } = useToast();
  const [term, setTerm] = useState("");
  const [events, setEvents] = useState([]);
  const [searching, setSearching] = useState(false);
  const [event, setEvent] = useState(null);
  const [odds, setOdds] = useState([]);
  const [loadingOdds, setLoadingOdds] = useState(false);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState("");
  const [revision, setRevision] = useState(0);

  const search = async () => {
    const text = term.trim();
    setSearching(true);
    setEvent(null);
    try {
      const filter = { published: true, start_time: { $gte: new Date().toISOString() } };
      if (text) {
        filter.$or = [
          { home_team_name: { $regex: text, $options: "i" } },
          { away_team_name: { $regex: text, $options: "i" } },
          { competition_name: { $regex: text, $options: "i" } },
        ];
      }
      const page = await base44.entities.Event.filter(filter, { limit: 8, sort: "start_time" });
      setEvents(page.items || []);
    } finally {
      setSearching(false);
    }
  };

  const loadOdds = async (target) => {
    setLoadingOdds(true);
    try {
      const page = await base44.entities.Odd.filter(
        { event_id: target.id, market_group: "principal" },
        { limit: 60, sort: "sort_order" },
      );
      const rows = page.items || [];
      setOdds(rows);
      setValues(Object.fromEntries(rows.map((row) => [row.id, row.is_super_odd ? String(row.super_odd_value ?? row.value) : ""])));
    } finally {
      setLoadingOdds(false);
    }
  };

  const selectEvent = async (target) => {
    setEvent(target);
    setEvents([]);
    await loadOdds(target);
  };

  const mark = async (odd) => {
    const value = parseValue(values[odd.id]);
    if (!Number.isFinite(value) || value <= 1) {
      toast({ title: "Informe uma odd maior que 1", variant: "destructive" });
      return;
    }
    setBusy(odd.id);
    try {
      await base44.entities.Odd.update(odd.id, {
        is_super_odd: true,
        super_odd_value: value,
        value,
        super_odd_at: new Date().toISOString(),
      });
      toast({ title: "Super odd registrada" });
      await loadOdds(event);
      setRevision((current) => current + 1);
    } finally {
      setBusy("");
    }
  };

  const clear = async (odd) => {
    setBusy(odd.id);
    try {
      await base44.entities.Odd.update(odd.id, { is_super_odd: false, super_odd_value: null, super_odd_at: null });
      toast({ title: "Super odd removida" });
      await loadOdds(event);
      setRevision((current) => current + 1);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <section className="card-surface space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Registrar super odd</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Busque uma partida já salva pela fonte de odds, informe o valor promocional da seleção e a caixa dela
            passa a aparecer em destaque vermelho nas listagens e no cartão do jogo.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label htmlFor="super-odd-term">Time ou competição</Label>
            <Input
              id="super-odd-term"
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

        {!searching && !events.length && !event && (
          <p className="text-xs text-muted-foreground">Nenhuma busca realizada ainda.</p>
        )}
      </section>

      {event && (
        <section className="card-surface space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {event.home_team_name} x {event.away_team_name}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {event.competition_name} · {formatDateTime(event.start_time)}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setEvent(null); setOdds([]); }}>
              Trocar partida
            </Button>
          </div>

          {loadingOdds ? (
            <div className="h-20 animate-pulse rounded-lg bg-secondary/40" />
          ) : odds.length ? (
            <div className="space-y-2">
              {odds.map((odd) => (
                <div key={odd.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{odd.label}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {odd.market_name} · odd atual {formatOdds(odd.value)}
                    </p>
                  </div>
                  <Input
                    className="w-24"
                    inputMode="decimal"
                    placeholder="5,00"
                    value={values[odd.id] ?? ""}
                    onChange={(changeEvent) => setValues((current) => ({ ...current, [odd.id]: changeEvent.target.value }))}
                  />
                  <Button size="sm" onClick={() => mark(odd)} disabled={busy === odd.id}>
                    {busy === odd.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    {odd.is_super_odd ? "Atualizar" : "Marcar"}
                  </Button>
                  {odd.is_super_odd && (
                    <Button size="sm" variant="outline" onClick={() => clear(odd)} disabled={busy === odd.id}>
                      Remover
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nenhuma cotação principal registrada para esta partida.
            </p>
          )}
        </section>
      )}

      <SuperOddList revision={revision} />
    </div>
  );
}
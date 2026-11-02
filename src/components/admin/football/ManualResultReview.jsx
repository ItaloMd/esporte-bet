import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import ReviewCard from "@/components/admin/football/ReviewCard";

/**
 * Aba de revisão de resultados: reúne as partidas que precisam de decisão
 * humana (em revisão, sem confirmação da fonte, paradas no 1º tempo/intervalo
 * ou já encerradas com apostas pendentes) e permite informar o resultado
 * completo na mão. A confirmação grava o placar, as estatísticas usadas pelas
 * apostas e liquida as seleções na hora.
 */
export default function ManualResultReview() {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async (term = "") => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", { action: "review_queue", search: term });
      const payload = response.data || {};
      if (payload.error) {
        toast({ title: "Falha ao carregar as partidas", description: payload.error, variant: "destructive" });
        setEvents(null);
      } else {
        setEvents(payload.events || []);
      }
    } catch (error) {
      toast({ title: "Falha ao carregar as partidas", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(query);
  }, [load, query]);

  const resolve = async (eventId, decision, data = {}) => {
    setBusyId(eventId);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", {
        action: "resolve_review",
        event_id: eventId,
        decision,
        force: true,
        ...data,
      });
      const payload = response.data || {};
      if (payload.error) {
        toast({ title: "Falha ao registrar a decisão", description: payload.error, variant: "destructive" });
        return;
      }
      const settled = payload.settlement?.selections_settled ?? 0;
      toast({
        title: decision === "confirm" ? "Resultado confirmado" : "Partida anulada",
        description:
          decision === "confirm"
            ? `${payload.score} · ${settled} seleção(ões) liquidada(s) agora.`
            : "Apostas da partida anuladas e registradas na trilha de auditoria.",
      });
      await load(query);
    } catch (error) {
      toast({ title: "Falha ao registrar a decisão", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card-surface space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              Revisão de resultados ({events?.length ?? 0})
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Partidas que dependem de decisão humana: sem confirmação da fonte, paradas no 1º tempo ou intervalo, ou com
              apostas ainda abertas. O resultado informado aqui vale como confirmação e liquida as apostas na hora.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => load(query)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <Input
            placeholder="Buscar por time ou competição (ex.: Flamengo)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={loading}>
            <Search className="mr-2 h-3.5 w-3.5" />
            Buscar
          </Button>
          {query ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setQuery("");
              }}
            >
              Limpar
            </Button>
          ) : null}
        </form>
      </section>

      {loading && !events ? (
        <div className="card-surface h-32 animate-pulse" />
      ) : !events?.length ? (
        <p className="card-surface p-4 text-xs text-muted-foreground">
          Nenhuma partida esperando decisão: todos os resultados foram confirmados e as apostas liquidadas.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <ReviewCard key={event.id} event={event} busy={busyId === event.id} onResolve={resolve} />
          ))}
        </div>
      )}
    </div>
  );
}
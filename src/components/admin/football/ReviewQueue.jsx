import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import ReviewCard from "@/components/admin/football/ReviewCard";

/**
 * Fila de revisão administrativa: partidas cujo resultado não pôde ser
 * confirmado pela fonte ficam aqui, com a evidência da auditoria, até a
 * decisão de um administrador. Nenhuma aposta é liquidada sem decisão —
 * cada confirmação ou anulação fica registrada na trilha de auditoria.
 */
export default function ReviewQueue() {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", { action: "review_queue" });
      const payload = response.data || {};
      if (payload.error) {
        toast({ title: "Falha ao carregar a fila de revisão", description: payload.error, variant: "destructive" });
        setEvents(null);
      } else {
        setEvents(payload.events || []);
      }
    } catch (error) {
      toast({ title: "Falha ao carregar a fila de revisão", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (eventId, decision, scores = {}) => {
    setBusyId(eventId);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", {
        action: "resolve_review",
        event_id: eventId,
        decision,
        ...(decision === "confirm" ? scores : {}),
      });
      const payload = response.data || {};
      if (payload.error) {
        toast({ title: "Falha ao registrar a decisão", description: payload.error, variant: "destructive" });
        return;
      }
      toast({
        title: decision === "confirm" ? "Resultado confirmado" : "Partida anulada",
        description: "Decisão registrada na trilha de auditoria. As apostas pendentes são liquidadas no próximo ciclo.",
      });
      await load();
    } catch (error) {
      toast({ title: "Falha ao registrar a decisão", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Revisão de resultados ({events?.length ?? 0})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Partidas com resultado não confirmado pela fonte. Nada é liquidado sem confirmação — cada decisão fica
            registrada na trilha de auditoria.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </div>

      {loading && !events ? (
        <div className="h-24 animate-pulse rounded-lg bg-secondary/40" />
      ) : !events?.length ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma partida em revisão: todos os resultados foram confirmados pela fonte ou já decididos.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <ReviewCard key={event.id} event={event} busy={busyId === event.id} onResolve={resolve} />
          ))}
        </div>
      )}
    </section>
  );
}
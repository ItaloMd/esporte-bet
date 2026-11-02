import React, { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

/**
 * Limpeza total da base de jogos. Apaga partidas, cotações, filas e auditorias
 * vinculadas — apostas e bilhetes não são tocados. A segunda opção recarrega o
 * calendário logo depois, já na janela de 7 dias.
 */
export default function PurgeGamesCard({ onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState("");

  const run = async (reimport) => {
    setBusy(reimport ? "purge_import" : "purge");
    try {
      const response = await base44.functions.invoke("apiFootballCentral", { action: "purge_events" });
      const payload = response.data || {};
      if (payload.error) throw new Error(payload.error);
      const removed = payload.removed || {};

      if (reimport) {
        const sync = await base44.functions.invoke("syncFootball", { mode: "calendar", trigger: "manual" });
        const syncPayload = sync.data || {};
        if (syncPayload.error) throw new Error(syncPayload.error);
        toast({
          title: "Base limpa e calendário recarregado",
          description: `${removed.events || 0} jogo(s) removido(s) · ${syncPayload.events_upserted ?? 0} partida(s) na janela de 7 dias.`,
        });
      } else {
        toast({
          title: "Base de jogos limpa",
          description: `${removed.events || 0} jogo(s), ${removed.odds || 0} cotação(ões) e as filas vinculadas foram removidos.`,
        });
      }
      setConfirming(false);
      if (onDone) onDone();
    } catch (error) {
      toast({ title: "Falha ao limpar a base", description: error.message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex items-start gap-2">
        <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold">Limpar base de jogos</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Remove todas as partidas, cotações e filas de coleta para começar do zero. Apostas, bilhetes e carteiras não
            são afetados.
          </p>
        </div>
      </div>

      {confirming ? (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-[11px] text-muted-foreground">
            Esta ação não pode ser desfeita. O histórico de partidas sai do banco; o próximo carregamento traz a janela
            de 7 dias novamente.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={() => run(true)} disabled={Boolean(busy)}>
              {busy === "purge_import" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Limpar e reimportar
            </Button>
            <Button size="sm" variant="outline" onClick={() => run(false)} disabled={Boolean(busy)}>
              {busy === "purge" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Limpar somente
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={Boolean(busy)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)} disabled={Boolean(busy)}>
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Limpar jogos
        </Button>
      )}
    </section>
  );
}
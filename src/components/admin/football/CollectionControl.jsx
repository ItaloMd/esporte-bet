import React from "react";
import { Loader2, PauseCircle, PlayCircle, Power } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Controle operacional único da coleta: ativar a integração (com sincronização
 * imediata) e pausar/retomar globalmente todas as rotinas que consultam a
 * API-Football. O estado fica gravado no ProviderSettings, então as rotinas
 * agendadas respeitam a escolha mesmo com o painel fechado.
 */
export default function CollectionControl({ settings, busy, onActivate, onTogglePause }) {
  const registered = Boolean(settings);
  const enabled = Boolean(settings?.football_enabled);
  const paused = Boolean(settings?.football_paused);

  const state = !enabled ? "disabled" : paused ? "paused" : "active";
  const stateLabel = {
    disabled: "Integração desligada",
    paused: "Coleta pausada",
    active: "Coleta ativa",
  }[state];
  const stateTone = {
    disabled: "border-border bg-secondary/40 text-muted-foreground",
    paused: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  }[state];
  const hint = {
    disabled: "Ative para importar calendário, cotações e resultados oficiais.",
    paused: "Nenhuma rotina consulta a API-Football enquanto a coleta estiver pausada.",
    active: "Rotinas ao vivo, cotações e auditoria seguem o orçamento configurado.",
  }[state];

  return (
    <section className="card-surface flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-[220px] space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${stateTone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {stateLabel}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {!registered ? null : enabled ? (
          <Button size="sm" variant={paused ? "default" : "outline"} onClick={onTogglePause} disabled={busy}>
            {busy ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : paused ? (
              <PlayCircle className="mr-2 h-3.5 w-3.5" />
            ) : (
              <PauseCircle className="mr-2 h-3.5 w-3.5" />
            )}
            {paused ? "Retomar coleta" : "Pausar coleta global"}
          </Button>
        ) : (
          <Button size="sm" onClick={onActivate} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Power className="mr-2 h-3.5 w-3.5" />}
            Ativar e sincronizar
          </Button>
        )}
      </div>
    </section>
  );
}
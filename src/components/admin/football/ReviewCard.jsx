import React, { useState } from "react";
import { Ban, ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/format";

const STATUS_LABEL = {
  scheduled: "Agendada",
  live: "Ao vivo",
  finished: "Encerrada",
  postponed: "Adiada",
  cancelled: "Cancelada",
};

const STATUS_TONE = {
  live: "border-primary/50 bg-primary/10 text-primary",
  finished: "border-border bg-secondary/40 text-muted-foreground",
  postponed: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  cancelled: "border-red-500/40 bg-red-500/10 text-red-400",
  scheduled: "border-border bg-secondary/40 text-muted-foreground",
};

/**
 * Cartão de uma partida em revisão: evidência da auditoria automática e a
 * decisão administrativa (confirmar o placar ou anular a partida). Nenhuma
 * aposta é liquidada antes dessa decisão.
 */
export default function ReviewCard({ event, busy, onResolve }) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(event.home_score ?? "");
  const [away, setAway] = useState(event.away_score ?? "");
  const [htHome, setHtHome] = useState(event.ht_home_score ?? "");
  const [htAway, setHtAway] = useState(event.ht_away_score ?? "");

  const hasScore = event.home_score !== null && event.home_score !== null;
  const score = hasScore ? `${event.home_score} x ${event.away_score}` : "—";

  const confirm = () => {
    onResolve(event.id, "confirm", {
      home_score: home,
      away_score: away,
      ht_home_score: htHome,
      ht_away_score: htAway,
    });
  };

  return (
    <article className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {event.home_team_name} x {event.away_team_name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {event.competition_name || "—"} · início {formatDateTime(event.start_time)} · {event.audit_checks}{" "}
            consulta(s) da fonte
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[event.status] || STATUS_TONE.scheduled}`}
          >
            {STATUS_LABEL[event.status] || event.status}
            {event.phase_label ? ` · ${event.phase_label}` : ""}
          </span>
          <span className="score-num text-sm font-semibold">{score}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>{event.open_selections} aposta(s) pendente(s)</span>
        {event.last_sync_at ? <span>· última leitura da fonte {formatDateTime(event.last_sync_at)}</span> : null}
        {event.result_source ? (
          <span>· resultado atual: {event.result_source}</span>
        ) : (
          <span>· resultado não confirmado</span>
        )}
      </div>

      {event.evidence ? (
        <details className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium">Evidência da auditoria automática</summary>
          <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">
            {event.evidence.audit_report}
          </p>
        </details>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Sem auditoria automática registrada: a partida entrou em revisão antes da confirmação pela fonte.
        </p>
      )}

      {open ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/30 p-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`rev_home_${event.id}`} className="text-[11px]">
              Gols casa
            </Label>
            <Input
              id={`rev_home_${event.id}`}
              type="number"
              min="0"
              value={home}
              onChange={(e) => setHome(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`rev_away_${event.id}`} className="text-[11px]">
              Gols visitante
            </Label>
            <Input
              id={`rev_away_${event.id}`}
              type="number"
              min="0"
              value={away}
              onChange={(e) => setAway(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`rev_hth_${event.id}`} className="text-[11px]">
              1º tempo casa
            </Label>
            <Input
              id={`rev_hth_${event.id}`}
              type="number"
              min="0"
              value={htHome}
              onChange={(e) => setHtHome(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`rev_hta_${event.id}`} className="text-[11px]">
              1º tempo visitante
            </Label>
            <Input
              id={`rev_hta_${event.id}`}
              type="number"
              min="0"
              value={htAway}
              onChange={(e) => setHtAway(e.target.value)}
            />
          </div>
          <div className="col-span-full flex flex-wrap gap-2">
            <Button size="sm" onClick={confirm} disabled={busy || home === "" || away === ""}>
              {busy ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-2 h-3.5 w-3.5" />
              )}
              Confirmar resultado
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={busy}>
            <ClipboardCheck className="mr-2 h-3.5 w-3.5" />
            Confirmar resultado
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onResolve(event.id, "void")} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Ban className="mr-2 h-3.5 w-3.5" />}
            Anular partida
          </Button>
        </div>
      )}
    </article>
  );
}
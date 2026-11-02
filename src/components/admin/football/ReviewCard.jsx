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

const REASON_LABEL = {
  review: "Em revisão",
  unconfirmed: "Sem confirmação da fonte",
  pending_settlement: "Resultado confirmado, apostas pendentes",
  stale: "Passou do horário sem encerrar",
  search: "Busca manual",
};

const MARKET_LABEL = {
  h2h: "Resultado final",
  totals: "Total de gols",
  spreads: "Handicap",
  btts: "Ambas marcam",
  ht_result: "Resultado 1º tempo",
  ht_btts: "Ambas marcam 1º tempo",
  ht_totals: "Gols 1º tempo",
  goal_both_halves: "Gol nos dois tempos",
  first_goal: "Primeiro gol",
  corners: "Escanteios",
  corners_home: "Escanteios casa",
  corners_away: "Escanteios visitante",
  cards: "Cartões",
  cards_home: "Cartões casa",
  cards_away: "Cartões visitante",
};

const field = (event, key) => (event[key] === null || event[key] === undefined ? "" : String(event[key]));

/**
 * Cartão de uma partida em revisão: mostra a evidência disponível e permite ao
 * administrador informar o resultado completo (placar, intervalo, escanteios,
 * cartões e primeiro gol) para confirmar — mesmo sem confirmação da fonte.
 */
export default function ReviewCard({ event, busy, onResolve }) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(field(event, "home_score"));
  const [away, setAway] = useState(field(event, "away_score"));
  const [htHome, setHtHome] = useState(field(event, "ht_home_score"));
  const [htAway, setHtAway] = useState(field(event, "ht_away_score"));
  const [cornersHome, setCornersHome] = useState(field(event, "corners_home"));
  const [cornersAway, setCornersAway] = useState(field(event, "corners_away"));
  const [cardsHome, setCardsHome] = useState(field(event, "cards_home"));
  const [cardsAway, setCardsAway] = useState(field(event, "cards_away"));
  const [firstMinute, setFirstMinute] = useState(field(event, "first_goal_minute"));
  const [firstTeam, setFirstTeam] = useState(event.first_goal_team || "");
  const [stats, setStats] = useState(false);

  const score =
    event.home_score === null || event.home_score === undefined ? "—" : `${event.home_score} x ${event.away_score}`;

  const confirm = () => {
    onResolve(event.id, "confirm", {
      home_score: home,
      away_score: away,
      ht_home_score: htHome,
      ht_away_score: htAway,
      corners_home: cornersHome,
      corners_away: cornersAway,
      cards_home: cardsHome,
      cards_away: cardsAway,
      first_goal_minute: firstMinute,
      first_goal_team: firstTeam,
    });
  };

  return (
    <article className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
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
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-300">
          {REASON_LABEL[event.reason] || event.reason}
        </span>
        <span>{event.open_selections} aposta(s) pendente(s)</span>
        <span>· {event.result_source ? `resultado atual: ${event.result_source}` : "sem confirmação de resultado"}</span>
      </div>

      {event.pending_markets?.length ? (
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[11px] font-medium">Dados que as apostas desta partida precisam</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {event.pending_markets.map((market) => (
              <span key={market.market_key} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {MARKET_LABEL[market.market_key] || market.market_key} · {market.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {event.evidence ? (
        <details className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium">Evidência da auditoria automática</summary>
          <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">
            {event.evidence.audit_report}
          </p>
        </details>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Sem auditoria automática registrada: o resultado será definido manualmente.
        </p>
      )}

      {open ? (
        <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor={`rev_home_${event.id}`} className="text-[11px]">
                Gols casa (final)
              </Label>
              <Input id={`rev_home_${event.id}`} type="number" min="0" value={home} onChange={(e) => setHome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rev_away_${event.id}`} className="text-[11px]">
                Gols visitante (final)
              </Label>
              <Input id={`rev_away_${event.id}`} type="number" min="0" value={away} onChange={(e) => setAway(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rev_hth_${event.id}`} className="text-[11px]">
                1º tempo casa
              </Label>
              <Input id={`rev_hth_${event.id}`} type="number" min="0" value={htHome} onChange={(e) => setHtHome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`rev_hta_${event.id}`} className="text-[11px]">
                1º tempo visitante
              </Label>
              <Input id={`rev_hta_${event.id}`} type="number" min="0" value={htAway} onChange={(e) => setHtAway(e.target.value)} />
            </div>
          </div>

          <button
            type="button"
            className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => setStats((value) => !value)}
          >
            {stats ? "Ocultar escanteios, cartões e primeiro gol" : "Informar escanteios, cartões e primeiro gol"}
          </button>

          {stats ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor={`rev_ch_${event.id}`} className="text-[11px]">
                  Escanteios casa
                </Label>
                <Input
                  id={`rev_ch_${event.id}`}
                  type="number"
                  min="0"
                  value={cornersHome}
                  onChange={(e) => setCornersHome(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rev_ca_${event.id}`} className="text-[11px]">
                  Escanteios visitante
                </Label>
                <Input
                  id={`rev_ca_${event.id}`}
                  type="number"
                  min="0"
                  value={cornersAway}
                  onChange={(e) => setCornersAway(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rev_kh_${event.id}`} className="text-[11px]">
                  Cartões casa
                </Label>
                <Input
                  id={`rev_kh_${event.id}`}
                  type="number"
                  min="0"
                  value={cardsHome}
                  onChange={(e) => setCardsHome(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rev_ka_${event.id}`} className="text-[11px]">
                  Cartões visitante
                </Label>
                <Input
                  id={`rev_ka_${event.id}`}
                  type="number"
                  min="0"
                  value={cardsAway}
                  onChange={(e) => setCardsAway(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rev_fm_${event.id}`} className="text-[11px]">
                  Minuto do 1º gol
                </Label>
                <Input
                  id={`rev_fm_${event.id}`}
                  type="number"
                  min="0"
                  value={firstMinute}
                  onChange={(e) => setFirstMinute(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`rev_ft_${event.id}`} className="text-[11px]">
                  Primeiro gol de
                </Label>
                <select
                  id={`rev_ft_${event.id}`}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={firstTeam}
                  onChange={(e) => setFirstTeam(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="home">Casa</option>
                  <option value="away">Visitante</option>
                </select>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={confirm} disabled={busy || home === "" || away === ""}>
              {busy ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-2 h-3.5 w-3.5" />
              )}
              Confirmar e liquidar
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
            Informar resultado
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
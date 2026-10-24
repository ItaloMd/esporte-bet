import React from "react";
import { Check, Clock, Users } from "lucide-react";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";

const REFERRAL_STATUS = {
  pending: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Recusada",
  fraud: "Antifraude",
};

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="score-num text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** Jogadores indicados, depósitos, FTD, QFTD e comissão gerada. */
export default function AffiliatePlayers({ players = [], totals = {} }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Jogadores indicados" value={formatNumber(totals.players)} />
        <Stat label="Com FTD" value={formatNumber(totals.ftds)} />
        <Stat label="QFTD" value={formatNumber(totals.qftds)} />
        <Stat label="Total depositado" value={formatCurrency(totals.total_deposited)} />
      </div>

      {players.length ? (
        <div className="space-y-2">
          {players.map((player) => (
            <div key={player.referral_id} className="rounded-lg border border-border px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {player.label}
                  </p>
                  <p className="text-muted-foreground">
                    {formatDateTime(player.attributed_at)} · {REFERRAL_STATUS[player.status] || player.status}
                  </p>
                </div>
                <span className="score-num shrink-0 font-semibold">{formatCurrency(player.commission)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                <span>{formatNumber(player.deposits)} depósito(s)</span>
                <span>Total {formatCurrency(player.total_deposited)}</span>
                <span>FTD {player.has_ftd ? formatCurrency(player.ftd) : "—"}</span>
                <span className="inline-flex items-center gap-1">
                  {player.qualified ? (
                    <>
                      <Check className="h-3 w-3 text-primary" aria-hidden="true" /> Comissão liberada
                    </>
                  ) : (
                    <>
                      <Clock className="h-3 w-3" aria-hidden="true" /> Rollover {formatCurrency(player.rollover_completed)}/
                      {formatCurrency(player.rollover_required)}
                    </>
                  )}
                </span>
                {player.qftd && <span className="text-primary">QFTD</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum jogador indicado até agora.</p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Um jogador qualifica quando o primeiro depósito (FTD) atinge {formatCurrency(totals.min_ftd)} e o rollover exigido
        é cumprido. Só jogadores qualificados geram comissão.
      </p>
    </div>
  );
}
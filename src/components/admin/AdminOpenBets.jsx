import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, Loader2, RefreshCw, Ticket, TrendingUp, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import { statusLabel } from "@/lib/sports";

const EVENT_STATUS_STYLE = {
  live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  scheduled: "border-border bg-secondary text-muted-foreground",
  finished: "border-border bg-secondary text-muted-foreground",
};

const TICKET_STATUS = {
  won: { label: "Ganhou", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  lost: { label: "Perdeu", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  void: { label: "Anulada", className: "border-border bg-secondary text-muted-foreground" },
  partial: { label: "Parcial", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  cashed_out: { label: "Cashout", className: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
};

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <div className="card-surface px-3.5 py-3">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      <p className="score-num mt-1.5 text-xl font-semibold">{formatCurrency(value)}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

export default function AdminOpenBets({ mode = "open" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await base44.functions.invoke("adminOverview", { action: "open_bets" });
      setData(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar as apostas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) return <CardListSkeleton count={3} />;
  if (error) {
    return (
      <div className="card-surface space-y-3 px-4 py-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
      </div>
    );
  }

  const totals = data?.totals || {};
  const events = data?.events || [];
  const byMarket = data?.by_market || [];
  const closed = data?.closed || { recent: [], counts: [] };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{mode === "open" ? "Apostas em Aberto" : "Apostas Encerradas"}</h2>
          <p className="text-xs text-muted-foreground">
            {mode === "open"
              ? "Exposição e volume por jogo e mercado, calculados no servidor"
              : "Boletins liquidados recentes e saldo por resultado"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Atualizar
        </Button>
      </header>

      {mode === "open" ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat icon={Ticket} label="Boletins em aberto" value={totals.open_stake} />
            <div className="card-surface px-3.5 py-3">
              <Ticket className="h-4 w-4 text-primary" aria-hidden="true" />
              <p className="score-num mt-1.5 text-xl font-semibold">{formatNumber(totals.open_count)}</p>
              <p className="text-[11px] text-muted-foreground">Boletins ativos</p>
            </div>
            <Stat icon={TrendingUp} label="Pagamento potencial" value={totals.open_potential} />
            <Stat icon={AlertTriangle} label="Exposição máxima da casa" value={totals.exposure} />
          </div>

          {events.length ? (
            <div className="space-y-3">
              {events.map((event) => (
                <section key={event.event_id} className="card-surface overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{event.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {event.competition} · {event.start_time ? formatDateTime(event.start_time) : "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={EVENT_STATUS_STYLE[event.status] || EVENT_STATUS_STYLE.scheduled}>
                        {event.status === "live" ? `Ao vivo ${event.score}` : statusLabel(event.status)}
                      </Badge>
                      <div className="text-right">
                        <p className="score-num text-sm font-semibold">{formatCurrency(event.stake)}</p>
                        <p className="text-[10px] text-muted-foreground">{formatNumber(event.ticket_count)} seleção(ões)</p>
                      </div>
                      <div className="text-right">
                        <p className="score-num text-sm font-semibold text-primary">{formatCurrency(event.potential)}</p>
                        <p className="text-[10px] text-muted-foreground">pagamento potencial</p>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-border/60">
                    {event.markets.map((market) => (
                      <div key={`${event.event_id}-${market.market}-${market.odd_label}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium">{market.market}</p>
                          <p className="text-muted-foreground">{market.odd_label}</p>
                        </div>
                        <div className="flex items-center gap-5 tabular-nums">
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{formatNumber(market.odd_value)}</span> odd
                          </span>
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{formatNumber(market.bet_count)}</span> apostas
                          </span>
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-foreground">{formatCurrency(market.volume)}</span> volume
                          </span>
                          <span className="text-muted-foreground">
                            <span className="font-semibold text-primary">{formatCurrency(market.payout)}</span> pagamento
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="card-surface px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma aposta em aberto no momento.
            </p>
          )}

          {byMarket.length ? (
            <section className="card-surface overflow-hidden">
              <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">Exposição por mercado</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 text-[10px]">Mercado</th>
                      <th className="px-3 py-2 text-right text-[10px]">Apostas</th>
                      <th className="px-4 py-2 text-right text-[10px]">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMarket.map((market) => (
                      <tr key={market.market_key} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 font-medium">{market.market_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(market.bet_count)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(market.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
            {closed.counts.map((row) => {
              const meta = TICKET_STATUS[row.status] || { label: row.status, className: "border-border bg-secondary text-muted-foreground" };
              return (
                <div key={row.status} className="card-surface px-3.5 py-3">
                  <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                  <p className="score-num mt-1.5 text-xl font-semibold">{formatNumber(row.count)}</p>
                  <p className="text-[11px] text-muted-foreground">boletins</p>
                </div>
              );
            })}
          </div>

          <section className="card-surface overflow-hidden">
            <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">Boletins liquidados recentes</h3>
            {closed.recent.length ? (
              <div className="divide-y divide-border/60">
                {closed.recent.map((ticket) => {
                  const meta = TICKET_STATUS[ticket.status] || { label: ticket.status, className: "" };
                  return (
                    <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-3">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium">{formatNumber(ticket.selections)} seleção(ões)</span>
                        <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                      </div>
                      <div className="flex items-center gap-4 tabular-nums text-muted-foreground">
                        <span><Clock className="mr-1 inline h-3 w-3" aria-hidden="true" />{ticket.settled_at ? formatDateTime(ticket.settled_at) : "—"}</span>
                        <span>odd <span className="font-semibold text-foreground">{formatNumber(ticket.odd)}</span></span>
                        <span>{formatCurrency(ticket.stake)} → <span className="font-semibold text-primary">{formatCurrency(ticket.potential)}</span></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-4 py-5 text-xs text-muted-foreground">Nenhum boletim liquidado ainda.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
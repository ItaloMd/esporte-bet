import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Info, Ticket } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState } from "@/components/state/States";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { formatDateTime, formatNumber, formatOdds } from "@/lib/format";
import { useAuth } from "@/lib/AuthContext";

const PAGE_SIZE = 10;

const STATUS_LABEL = {
  open: "Em aberto",
  won: "Ganha",
  lost: "Perdida",
  void: "Anulada",
  partial: "Parcial",
};

function TicketCard({ ticket, selections }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="card-surface overflow-hidden">
      <button type="button" className="w-full px-4 py-3 text-left" onClick={() => setOpen((value) => !value)}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {ticket.selection_count} seleç{ticket.selection_count === 1 ? "ão" : "ões"} · {formatNumber(ticket.stake_points)} pts
            </p>
            <p className="text-[11px] text-muted-foreground">Registrada em {formatDateTime(ticket.created_date)}</p>
          </div>
          <div className="text-right">
            <p className="score-num text-lg font-semibold text-primary">{formatOdds(ticket.total_odd)}</p>
            <p className="text-[11px] text-muted-foreground">retorno {formatNumber(ticket.potential_points)} pts</p>
          </div>
        </div>
        <span className="mt-2 inline-block rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
          {STATUS_LABEL[ticket.status] || ticket.status}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {selections.length ? (
            selections.map((selection) => (
              <div key={selection.id} className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{selection.event_label}</p>
                  <p className="truncate text-muted-foreground">
                    {selection.market_name} · {selection.odd_label} · odd registrada {formatOdds(selection.odd_value)}
                  </p>
                </div>
                <span className="shrink-0 text-muted-foreground">{STATUS_LABEL[selection.status] || selection.status}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">Seleções não encontradas.</p>
          )}
        </div>
      )}
    </article>
  );
}

export default function MySimulations() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [selectionsByTicket, setSelectionsByTicket] = useState({});
  const [stats, setStats] = useState({ total: 0, open: 0, settled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);

  const load = async (nextCursor = null) => {
    if (!user?.id) return;
    setLoading(true);
    setError("");
    try {
      const page = await base44.entities.SimulationTicket.filter(
        { user_id: user.id },
        { sort: "-created_date", limit: PAGE_SIZE, ...(nextCursor ? { cursor: nextCursor } : {}) },
      );
      const items = page.items || [];
      const merged = nextCursor ? [...tickets, ...items] : items;
      setTickets(merged);
      setHasMore(Boolean(page.has_more));
      setCursor(page.next_cursor || null);

      if (items.length) {
        const selectionsPage = await base44.entities.SimulationSelection.filter(
          { ticket_id: { $in: items.map((ticket) => ticket.id) } },
          { limit: 300, sort: "created_date" },
        );
        const grouped = { ...(nextCursor ? selectionsByTicket : {}) };
        (selectionsPage.items || []).forEach((selection) => {
          if (!grouped[selection.ticket_id]) grouped[selection.ticket_id] = [];
          grouped[selection.ticket_id].push(selection);
        });
        setSelectionsByTicket(grouped);
      }
    } catch (err) {
      setError(err.message || "Falha ao carregar suas simulações.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    load();
    base44.entities.SimulationTicket.aggregate({ query: { user_id: user.id }, groupBy: "status" })
      .then((result) => {
        const rows = result.rows || [];
        const total = rows.reduce((acc, row) => acc + row.count, 0);
        const open = rows.find((row) => row.status === "open")?.count || 0;
        setStats({ total, open, settled: total - open });
      })
      .catch(() => setStats({ total: 0, open: 0, settled: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card">
            <Ticket className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Minhas simulações</h1>
            <p className="text-xs text-muted-foreground">Boletins fictícios com pontos sem valor real</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/">Montar nova simulação</Link>
        </Button>
      </header>

      <div className="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-xs text-foreground/85">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <p>
          Ambiente de simulação: não há saldo, depósito, saque ou prêmio em dinheiro. As odds e o horário são
          registrados no momento da confirmação e não podem ser alterados depois. Um resultado só é considerado
          encerrado quando a fonte oficial confirma o placar.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "Boletins registrados", value: stats.total },
          { label: "Em aberto", value: stats.open },
          { label: "Com resultado confirmado", value: stats.settled },
        ].map((item) => (
          <div key={item.label} className="card-surface px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="score-num mt-1 text-2xl font-semibold">{formatNumber(item.value)}</p>
          </div>
        ))}
      </div>

      {loading && !tickets.length ? (
        <CardListSkeleton count={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : tickets.length ? (
        <div className="space-y-3">
          {stats.total > 0 && <Progress value={(stats.settled / Math.max(stats.total, 1)) * 100} className="h-1.5" />}
          {tickets.map((ticket) => (
            <TicketCard key={ticket.id} ticket={ticket} selections={selectionsByTicket[ticket.id] || []} />
          ))}
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => load(cursor)} disabled={loading}>
                Carregar mais
              </Button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          title="Você ainda não registrou simulações"
          description="Escolha mercados nas partidas, monte um boletim e registre pontos fictícios para acompanhar o resultado."
        />
      )}
    </div>
  );
}
import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatOdds, formatDateTime } from "@/lib/format";
import { Loader2 } from "lucide-react";

/** Lista as super odds ativas, com a partida correspondente, para revisão rápida. */
export default function SuperOddList({ revision = 0 }) {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const page = await base44.entities.Odd.filter({ is_super_odd: true }, { limit: 50, sort: "-super_odd_at" });
      const items = page.items || [];
      setRows(items);
      const ids = [...new Set(items.map((item) => item.event_id).filter(Boolean))];
      if (!ids.length) {
        setEvents({});
        return;
      }
      const eventPage = await base44.entities.Event.filter({ id: { $in: ids } }, { limit: ids.length });
      setEvents(Object.fromEntries((eventPage.items || []).map((item) => [item.id, item])));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const clear = async (row) => {
    setBusy(row.id);
    try {
      await base44.entities.Odd.update(row.id, { is_super_odd: false, super_odd_value: null, super_odd_at: null });
      toast({ title: "Super odd removida" });
      await load();
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <h2 className="text-sm font-semibold">Super odds ativas</h2>
      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />
      ) : rows.length ? (
        <div className="space-y-2">
          {rows.map((row) => {
            const event = events[row.event_id];
            return (
              <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {event ? `${event.home_team_name} x ${event.away_team_name}` : "Partida não localizada"} · {row.label}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {row.market_name} · {event ? formatDateTime(event.start_time) : "sem horário"}
                  </p>
                </div>
                <span className="score-num text-sm font-semibold text-primary">{formatOdds(row.super_odd_value ?? row.value)}</span>
                <Button size="sm" variant="outline" onClick={() => clear(row)} disabled={busy === row.id}>
                  {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Remover"}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma super odd registrada.</p>
      )}
    </section>
  );
}
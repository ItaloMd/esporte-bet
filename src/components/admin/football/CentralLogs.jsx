import React, { useCallback, useEffect, useState } from "react";
import { Loader2, ListFilter } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeAgo } from "@/lib/format";

/**
 * Módulo 10: logs avançados da API-Football com filtros de período, endpoint,
 * fixture e liga. Cada consulta registra data, hora, endpoint, status da
 * resposta, tempo de resposta e créditos consumidos.
 */
export default function CentralLogs() {
  const [endpoint, setEndpoint] = useState("");
  const [fixture, setFixture] = useState("");
  const [league, setLeague] = useState("");
  const [period, setPeriod] = useState("7");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", {
        action: "logs",
        endpoint,
        fixture,
        league,
        period_days: Number(period),
        limit: 80,
      });
      const payload = response.data || {};
      setLogs(payload.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [endpoint, fixture, league, period]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Logs avançados</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Todas as chamadas da API-Football com data, endpoint, status, tempo de resposta e créditos consumidos.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Endpoint</Label>
          <Input placeholder="live=all, /odds, statistics…" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Fixture</Label>
          <Input placeholder="ID da partida" value={fixture} onChange={(event) => setFixture(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Liga</Label>
          <Input placeholder="Nome no registro" value={league} onChange={(event) => setLeague(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Período</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Últimas 24h</SelectItem>
              <SelectItem value="7">7 dias</SelectItem>
              <SelectItem value="30">30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ListFilter className="mr-2 h-3.5 w-3.5" />}
          Filtrar
        </Button>
        <span className="text-[11px] text-muted-foreground">{logs.length} registro(s)</span>
      </div>

      {logs.length ? (
        <ul className="space-y-1.5 text-xs">
          {logs.map((row) => (
            <li key={row.id} className="border-b border-border/60 pb-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{row.endpoint}</span>
                <span className="text-muted-foreground">
                  {timeAgo(row.created_date)} · HTTP {row.status_code ?? "—"}
                  {row.duration_ms ? ` · ${Math.round(row.duration_ms)} ms` : ""}
                  {` · ${row.credits_used} crédito(s)`}
                </span>
              </div>
              <p className="text-muted-foreground">
                {row.params || "—"}
                {row.records_returned ? ` · ${row.records_returned} registro(s)` : ""}
                {row.error_message ? ` · ${row.error_message}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma consulta registrada com esses filtros.</p>
      )}
    </section>
  );
}
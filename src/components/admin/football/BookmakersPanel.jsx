import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";

const clock = (value) => {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "nunca sincronizado";
  return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

/**
 * Catálogo de casas de apostas lido do provedor (`/odds/bookmakers`).
 *
 * A sincronização é uma ação explícita do administrador e custa uma requisição.
 * Só as casas ligadas aqui servem de referência de preço na coleta de cotações;
 * sem nenhuma seleção, a coleta usa a ordem de preferência padrão.
 */
export default function BookmakersPanel({ summary, onSynced }) {
  const [rows, setRows] = useState([]);
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await base44.entities.Bookmaker.list({ limit: 500, sort: "name" });
      setRows(page.items || []);
    } catch (error) {
      toast({ title: "Falha ao carregar as casas", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const search = term.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) => `${row.name} ${row.provider_id}`.toLowerCase().includes(search));
  }, [rows, term]);

  const toggle = async (row, enabled) => {
    setSavingId(row.id);
    try {
      await base44.entities.Bookmaker.update(row.id, { enabled });
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, enabled } : item)));
      toast({ title: enabled ? `${row.name} ativada` : `${row.name} desativada` });
      onSynced?.();
    } catch (error) {
      toast({ title: "Não foi possível alterar a casa", description: error.message, variant: "destructive" });
    } finally {
      setSavingId("");
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await base44.functions.invoke("syncFootballCatalog", { action: "bookmakers" });
      const payload = response.data || {};
      if (payload.error || payload.skipped) {
        toast({
          title: "Catálogo não sincronizado",
          description: payload.error || payload.reason || "",
          variant: "destructive",
        });
      } else {
        toast({ title: "Catálogo atualizado", description: payload.summary || "" });
      }
      await load();
      onSynced?.();
    } catch (error) {
      toast({ title: "Falha ao sincronizar o catálogo", description: error.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const selected = rows.filter((row) => row.enabled).length;

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Casas de apostas</h3>
          <p className="text-[11px] text-muted-foreground">
            Catálogo oficial do provedor. {selected > 0
              ? `${selected} selecionada(s) como referência de preço.`
              : "Nenhuma selecionada: vale a ordem de preferência padrão."}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {summary?.total ? `${summary.total} casa(s) · ` : ""}última sincronização {clock(summary?.last_sync_at)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={sync} disabled={syncing || loading}>
          {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
          Sincronizar catálogo
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Pesquisar por nome ou ID"
          className="h-9 pl-8 text-xs"
        />
      </div>

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-secondary/40" />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-border bg-secondary/30 px-3 py-4 text-xs text-muted-foreground">
          {rows.length
            ? "Nenhuma casa corresponde à pesquisa."
            : "Catálogo ainda não sincronizado. Use “Sincronizar catálogo” para ler a lista oficial do provedor."}
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {filtered.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{row.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  ID {row.provider_id} · visto em {clock(row.last_seen_at)}
                </p>
              </div>
              <Switch
                checked={Boolean(row.enabled)}
                onCheckedChange={(value) => toggle(row, value)}
                disabled={savingId === row.id}
                aria-label={`Usar ${row.name} como referência`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
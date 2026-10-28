import React, { useCallback, useEffect, useState } from "react";
import { Loader2, SearchCheck, Telescope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";
import { timeAgo } from "@/lib/format";

const SUPPORT = {
  available: { label: "Disponível", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  unavailable: { label: "Indisponível na API", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  upgrade: { label: "Necessita upgrade", className: "border-destructive/40 bg-destructive/10 text-destructive" },
};

function winRate(won, lost) {
  const total = Number(won) + Number(lost);
  return total ? `${Math.round((Number(won) / total) * 100)}%` : "—";
}

export default function AdminMarkets() {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke("adminMarkets", { action: "overview" });
      setData(result);
    } catch (error) {
      toast({ title: "Falha ao carregar mercados", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSetting = async (market, patch) => {
    try {
      await base44.functions.invoke("adminMarkets", { action: "update_setting", market_key: market.market_key, ...patch });
      setData((current) =>
        current
          ? { ...current, markets: current.markets.map((row) => (row.market_key === market.market_key ? { ...row, ...patch } : row)) }
          : current,
      );
    } catch (error) {
      toast({ title: "Falha ao salvar mercado", description: error.message, variant: "destructive" });
    }
  };

  const runAction = async (action, title) => {
    setBusy(action);
    try {
      const result = await base44.functions.invoke("adminMarkets", { action });
      toast({ title, description: result.summary || "Operação concluída." });
      await load();
    } catch (error) {
      toast({ title: "Falha na operação", description: error.message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  if (loading && !data) {
    return (
      <div className="card-surface flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração de mercados...
      </div>
    );
  }

  const totals = data?.totals || {};
  const markets = data?.markets || [];
  const capabilities = data?.capabilities || [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Configuração de Mercados</h2>
          <p className="text-xs text-muted-foreground">
            Ativação, prioridade e auditoria automática por mercado · suporte verificado na API-Football
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => runAction("validate", "Suporte validado na API")}>
            <SearchCheck className="mr-2 h-3.5 w-3.5" /> Validar suporte na API
          </Button>
          <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => runAction("discover", "Capacidade descoberta por liga")}>
            <Telescope className="mr-2 h-3.5 w-3.5" /> Descobrir por liga
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Jogos processados", value: totals.processed_audits ?? 0 },
          { label: "Jogos pendentes", value: totals.pending_events ?? 0 },
          { label: "Apostas liquidadas", value: totals.bets_settled ?? 0 },
          { label: "Taxa de acerto global", value: totals.win_rate === null || totals.win_rate === undefined ? "—" : `${totals.win_rate}%` },
        ].map((card) => (
          <div key={card.label} className="card-surface px-3.5 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{card.label}</p>
            <p className="score-num mt-1 text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      <section className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3.5 py-2.5">Mercado</th>
                <th className="px-3 py-2.5">Suporte na API</th>
                <th className="px-3 py-2.5">Ativo</th>
                <th className="px-3 py-2.5">Prioridade</th>
                <th className="px-3 py-2.5">Auditoria auto</th>
                <th className="px-3 py-2.5 text-right">Liquidadas</th>
                <th className="px-3 py-2.5 text-right">Acerto</th>
                <th className="px-3 py-2.5 text-right">Abertas</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => {
                const support = SUPPORT[market.support_status] || SUPPORT.available;
                return (
                  <tr key={market.market_key} className="border-b border-border/60 last:border-0">
                    <td className="px-3.5 py-2.5">
                      <p className="font-medium">{market.market_name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {market.provider_bet} · {market.market_group}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={support.className}>
                        {market.support_checked_at ? support.label : "Não verificado"}
                      </Badge>
                      {market.support_note && <p className="mt-1 text-[10px] text-muted-foreground">{market.support_note}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Switch checked={market.enabled} onCheckedChange={(enabled) => updateSetting(market, { enabled })} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Input
                        type="number"
                        className="h-8 w-20"
                        defaultValue={market.priority}
                        onBlur={(e) => {
                          const priority = Number(e.target.value);
                          if (Number.isFinite(priority) && priority !== market.priority) updateSetting(market, { priority });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Switch checked={market.auto_audit} onCheckedChange={(auto_audit) => updateSetting(market, { auto_audit })} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{Number(market.bets_won) + Number(market.bets_lost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{winRate(market.bets_won, market.bets_lost)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{market.bets_open}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card-surface overflow-hidden">
        <div className="border-b border-border px-3.5 py-2.5">
          <h3 className="text-sm font-semibold">Capacidade descoberta por liga e temporada</h3>
          <p className="text-xs text-muted-foreground">
            O que a API realmente fornece por liga — a auditoria só decide mercados com os dados confirmados aqui.
          </p>
        </div>
        {capabilities.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3.5 py-2.5">Liga</th>
                  <th className="px-3 py-2.5">Temporada</th>
                  <th className="px-3 py-2.5">Estatísticas</th>
                  <th className="px-3 py-2.5">Escanteios</th>
                  <th className="px-3 py-2.5">Cartões</th>
                  <th className="px-3 py-2.5">Eventos de gol</th>
                  <th className="px-3 py-2.5 text-right">Amostras</th>
                  <th className="px-3 py-2.5 text-right">Verificado</th>
                </tr>
              </thead>
              <tbody>
                {capabilities.map((cap) => (
                  <tr key={`${cap.league_key}-${cap.season}`} className="border-b border-border/60 last:border-0">
                    <td className="px-3.5 py-2.5 font-medium">{cap.league_name || cap.league_key}</td>
                    <td className="px-3 py-2.5 tabular-nums">{cap.season}</td>
                    {[cap.statistics_available, cap.corners_available, cap.cards_available, cap.goals_events_available].map((flag, index) => (
                      <td key={index} className="px-3 py-2.5">
                        <Badge
                          variant="outline"
                          className={flag ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border bg-secondary text-muted-foreground"}
                        >
                          {flag ? "Sim" : "Não"}
                        </Badge>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums">{cap.samples}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{timeAgo(cap.last_checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3.5 py-4 text-xs text-muted-foreground">
            Nenhuma liga verificada ainda — use "Descobrir por liga" ou aguarde a auditoria de encerramento coletar amostras.
          </p>
        )}
      </section>
    </div>
  );
}
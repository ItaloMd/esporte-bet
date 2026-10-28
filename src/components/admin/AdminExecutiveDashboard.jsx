import React, { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowDownCircle, ArrowUpCircle, CalendarDays, Percent, RefreshCw, Ticket,
  TrendingUp, Trophy, UserPlus, Users, Wallet, Zap,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis,
} from "recharts";
import { base44 } from "@/api/base44Client";
import { CardListSkeleton } from "@/components/state/LoadingBlocks";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/format";

function Kpi({ icon: Icon, label, value, hint, tone }) {
  const toneClass =
    tone === "up" ? "text-emerald-400" : tone === "down" ? "text-destructive" : "text-primary";
  return (
    <div className="card-surface px-3.5 py-3">
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className={`score-num mt-1.5 text-xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--popover-foreground))",
};

export default function AdminExecutiveDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await base44.functions.invoke("adminOverview", { action: "overview" });
      setData(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar o dashboard.");
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

  const kpis = data?.kpis || {};
  const betSeries = data?.bet_series || [];
  const financeSeries = data?.finance_series || [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Visão Geral</h2>
          <p className="text-xs text-muted-foreground">
            Indicadores do dia ({data?.day || "hoje"}) · fuso de São Paulo · uma única fonte de dados
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
        <Kpi icon={ArrowDownCircle} label="Total depositado hoje" value={formatCurrency(kpis.deposits_today)} hint={`${formatNumber(kpis.deposits_count_today)} depósito(s)`} />
        <Kpi icon={ArrowUpCircle} label="Total sacado hoje" value={formatCurrency(kpis.withdrawals_today)} />
        <Kpi icon={TrendingUp} label="Lucro bruto (apostas - prêmios)" value={formatCurrency(kpis.gross_profit)} tone={kpis.gross_profit >= 0 ? "up" : "down"} />
        <Kpi icon={Wallet} label="Lucro líquido (menos taxas)" value={formatCurrency(kpis.net_profit)} tone={kpis.net_profit >= 0 ? "up" : "down"} hint={`taxas ${formatCurrency(kpis.fees_today)}`} />
        <Kpi icon={Users} label="Usuários cadastrados" value={formatNumber(kpis.users_total)} hint={`${formatNumber(kpis.users_new_today)} novo(s) hoje`} />
        <Kpi icon={UserPlus} label="Novos cadastros hoje" value={formatNumber(kpis.users_new_today)} />
        <Kpi icon={Ticket} label="Apostas em aberto" value={formatNumber(kpis.open_bets_count)} hint={`${formatCurrency(kpis.open_bets_stake)} apostados`} />
        <Kpi icon={Trophy} label="Apostas liquidadas hoje" value={formatNumber(kpis.settled_today)} />
        <Kpi icon={Activity} label="Jogos ao vivo" value={formatNumber(kpis.live_matches)} />
        <Kpi icon={CalendarDays} label="Partidas hoje" value={formatNumber(kpis.today_matches)} />
        <Kpi icon={Zap} label="Volume apostado hoje" value={formatCurrency(kpis.volume_today)} hint={`prêmios ${formatCurrency(kpis.prizes_today)}`} />
        <Kpi icon={Percent} label="Exposição em aberto" value={formatCurrency(kpis.open_bets_potential)} hint="pagamento potencial máximo" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card-surface px-4 py-3">
          <h3 className="text-sm font-semibold">Volume apostado (7 dias)</h3>
          {betSeries.length ? (
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={betSeries}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="volume" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Nenhuma aposta registrada nos últimos 7 dias.</p>
          )}
        </section>

        <section className="card-surface px-4 py-3">
          <h3 className="text-sm font-semibold">Financeiro (snapshots diários)</h3>
          {financeSeries.length ? (
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={financeSeries}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} width={48} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatCurrency(value)} />
                  <Line type="monotone" dataKey="apostado" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="pago" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="resultado" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Nenhum snapshot financeiro registrado ainda — o módulo de análise de caixa gera um por dia.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
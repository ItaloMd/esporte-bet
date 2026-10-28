import React from "react";
import {
  AlertTriangle,
  Coins,
  Landmark,
  Scale,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/format";

const HEALTH_STYLE = {
  green: { box: "border-emerald-500/40 bg-emerald-500/10", text: "text-emerald-400" },
  yellow: { box: "border-amber-500/40 bg-amber-500/10", text: "text-amber-400" },
  red: { box: "border-red-500/50 bg-red-500/10", text: "text-red-400" },
};

const ALERT_STYLE = {
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  yellow: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  red: "border-red-500/50 bg-red-500/10 text-red-300",
};

const COVERAGE_LABEL = { safe: "Seguro", attention: "Atenção", risk: "Risco" };
const HEALTH_LABEL = { green: "Saudável", yellow: "Atenção", red: "Risco operacional" };

function Metric({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null} {label}
      </div>
      <p className="score-num mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export default function RiskOverview({ data }) {
  const health = HEALTH_STYLE[data.health] || HEALTH_STYLE.red;
  const ratioPercent = Math.round((data.free_cash_ratio || 0) * 100);
  const gateway = data.gateway;
  const players = data.players || {};
  const openBets = data.open_bets || {};
  const profit = data.profit || {};
  const coverage = data.coverage_index;
  const coverageLabel = data.coverage_label;
  const money = (value) => (value === null || value === undefined ? "—" : formatCurrency(value));

  return (
    <div className="space-y-4">
      {(data.alerts || []).map((alert, index) => (
        <div
          key={index}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${ALERT_STYLE[alert.level] || ALERT_STYLE.red}`}
        >
          {alert.level === "green" ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {alert.message}
        </div>
      ))}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-xl border p-4 ${health.box}`}>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Coins className="h-3.5 w-3.5" aria-hidden="true" /> Caixa Livre
          </div>
          <p className={`score-num mt-1 text-2xl font-bold ${health.text}`}>{money(data.free_cash)}</p>
          <p className="text-[11px] text-muted-foreground">{ratioPercent}% do Caixa Gateway · {HEALTH_LABEL[data.health]}</p>
          <p className="text-[10px] text-muted-foreground/70">Gateway − jogadores − responsabilidade</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Landmark className="h-3.5 w-3.5" aria-hidden="true" /> Patrimônio da Casa
          </div>
          <p className="score-num mt-1 text-2xl font-bold">{money(data.patrimony)}</p>
          <p className="text-[10px] text-muted-foreground/70">Gateway − saldo dos jogadores</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Resultado Real
          </div>
          <p className="score-num mt-1 text-2xl font-bold">{money(data.real_result)}</p>
          <p className="text-[10px] text-muted-foreground/70">Patrimônio − exposição atual</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Scale className="h-3.5 w-3.5" aria-hidden="true" /> Índice de Cobertura
          </div>
          <p className="score-num mt-1 text-2xl font-bold">{coverage === null ? "—" : coverage.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground/70">
            {coverage === null ? "sem responsabilidade aberta" : `${COVERAGE_LABEL[coverageLabel] || "—"} · Gateway ÷ responsabilidade`}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={Wallet}
          label="Caixa Gateway (Payshark)"
          value={money(gateway?.available)}
          hint={
            gateway
              ? `em trânsito ${formatCurrency(gateway.held)} · pendente ${formatCurrency(gateway.pending)}`
              : data.gateway_error
          }
        />
        <Metric
          icon={Users}
          label="Saldo dos Jogadores"
          value={money(players.balance)}
          hint={`${formatNumber(players.count)} jogador(es) com saldo · reservado em saques ${formatCurrency(players.locked)}`}
        />
        <Metric
          icon={Ticket}
          label="Apostas em Andamento"
          value={money(openBets.stake)}
          hint={`${formatNumber(openBets.count)} aposta(s) aberta(s)${openBets.truncated ? " · lista parcial" : ""}`}
        />
        <Metric icon={AlertTriangle} label="Responsabilidade (Liability)" value={money(openBets.liability)} hint="prêmio máximo se todas vencerem" />
        <Metric icon={Coins} label="Exposição Líquida" value={money(openBets.net_exposure)} hint="responsabilidade − valor apostado" />
        <Metric icon={Landmark} label="Reserva Necessária" value={money(data.reserve)} hint="jogadores + responsabilidade" />
        <Metric icon={AlertTriangle} label="Cenário Máximo de Risco" value={money(openBets.liability)} hint="pior caso: pagamento total aos vencedores" />
        <Metric icon={Scale} label="Saúde do Caixa Livre" value={HEALTH_LABEL[data.health] || "—"} hint={`${ratioPercent}% do Caixa Gateway`} />
      </div>

      <section className="card-surface p-4">
        <h2 className="text-sm font-semibold">Lucro operacional projetado</h2>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Projeção com base nos registros da plataforma: apostas debitadas, prêmios pagos e taxas do gateway.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={Ticket} label="Total apostado" value={money(profit.staked_total)} />
          <Metric icon={TrendingUp} label="Total pago aos vencedores" value={money(profit.paid_total)} />
          <Metric icon={Wallet} label="Taxas cobradas (gateway)" value={money(profit.fees_total)} hint="3,5% + R$ 1,00 por transação" />
          <Metric icon={Coins} label="Lucro líquido projetado" value={money(profit.net_profit)} />
        </div>
      </section>
    </div>
  );
}
import React from "react";
import { History } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

const SERIES = [
  { key: "gateway", label: "Caixa Gateway", color: "#ff2424" },
  { key: "players", label: "Saldo dos jogadores", color: "#38bdf8" },
  { key: "liability", label: "Responsabilidade", color: "#f59e0b" },
  { key: "free", label: "Caixa livre", color: "#34d399" },
];

export default function RiskHistory({ history }) {
  const rows = (history || []).map((snap) => ({
    day: String(snap.day || "").slice(5),
    gateway: Number(snap.gateway_available || 0),
    players: Number(snap.players_balance || 0) + Number(snap.players_locked || 0),
    liability: Number(snap.liability || 0),
    free: Number(snap.free_cash || 0),
    real_result: Number(snap.real_result || 0),
    fullDay: snap.day,
  }));
  const tableRows = rows.slice().reverse().slice(0, 10);

  return (
    <section className="card-surface space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-primary" aria-hidden="true" /> Evolução diária (snapshots)
      </div>

      {rows.length >= 2 ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                {SERIES.map((serie) => (
                  <areaGradient key={serie.key} serie={serie} />
                ))}
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#9ca3af", fontSize: 11 }} stroke="rgba(255,255,255,0.15)" />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                stroke="rgba(255,255,255,0.15)"
                tickFormatter={(value) => `R$ ${Math.round(Number(value) / 100) / 10}k`}
                width={64}
              />
              <Tooltip
                formatter={(value) => formatCurrency(value)}
                contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#e5e7eb" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SERIES.map((serie) => (
                <Area
                  key={serie.key}
                  type="monotone"
                  dataKey={serie.key}
                  name={serie.label}
                  stroke={serie.color}
                  fill={`url(#gradient-${serie.key})`}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ainda não há histórico suficiente para o gráfico. Cada consulta atualizada grava o snapshot do dia.
        </p>
      )}

      {tableRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Dia</th>
                <th className="py-1.5 pr-3 font-medium">Gateway</th>
                <th className="py-1.5 pr-3 font-medium">Jogadores</th>
                <th className="py-1.5 pr-3 font-medium">Responsabilidade</th>
                <th className="py-1.5 pr-3 font-medium">Caixa livre</th>
                <th className="py-1.5 font-medium">Resultado real</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr key={row.fullDay} className="border-t border-border/60">
                  <td className="py-1.5 pr-3 text-muted-foreground">{row.fullDay}</td>
                  <td className="score-num py-1.5 pr-3">{formatCurrency(row.gateway)}</td>
                  <td className="score-num py-1.5 pr-3">{formatCurrency(row.players)}</td>
                  <td className="score-num py-1.5 pr-3">{formatCurrency(row.liability)}</td>
                  <td className="score-num py-1.5 pr-3">{formatCurrency(row.free)}</td>
                  <td className="score-num py-1.5">{formatCurrency(row.real_result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function areaGradient({ serie }) {
  return (
    <linearGradient id={`gradient-${serie.key}`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={serie.color} stopOpacity={0.25} />
      <stop offset="100%" stopColor={serie.color} stopOpacity={0.02} />
    </linearGradient>
  );
}
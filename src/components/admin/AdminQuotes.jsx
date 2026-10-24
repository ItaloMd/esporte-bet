import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { formatOdds, timeAgo } from "@/lib/format";

const percent = (value) => (Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "—");

/**
 * Mostra, para cada cotação publicada, a odd original da API, a odd oferecida
 * pelo sistema, a margem aplicada, o overround original, o alvo e o efetivo.
 */
export default function AdminQuotes({ marginPercent }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    base44.entities.Odd
      .filter({ source: "provider" }, { sort: "-last_sync_at", limit: 12 })
      .then((page) => {
        if (!active) return;
        setRows(page.items || []);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Cotações e margem da casa</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A odd original recebida da API é preservada em cada cotação. A odd oferecida é sempre
          recalculada a partir dela com a margem vigente de {marginPercent ?? 20}% e o overround-alvo
          distribuído proporcionalmente entre os resultados. Mercados com resultados incompletos ficam
          retidos, sem oferta.
        </p>
      </div>

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-secondary/40" />
      ) : rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-medium">Mercado e seleção</th>
                <th className="py-2 pr-3 font-medium">Odd original</th>
                <th className="py-2 pr-3 font-medium">Odd oferecida</th>
                <th className="py-2 pr-3 font-medium">Margem</th>
                <th className="py-2 pr-3 font-medium">Overround original</th>
                <th className="py-2 pr-3 font-medium">Overround-alvo</th>
                <th className="py-2 pr-3 font-medium">Overround efetivo</th>
                <th className="py-2 pr-3 font-medium">Atualização</th>
                <th className="py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const withheld = row.quote_state !== "offered";
                return (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <p className="truncate font-medium">{row.label}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{row.market_name}</p>
                    </td>
                    <td className="py-2 pr-3 score-num">{formatOdds(row.original_value)}</td>
                    <td className="py-2 pr-3 score-num font-semibold">
                      {withheld ? "—" : formatOdds(row.value)}
                    </td>
                    <td className="py-2 pr-3">{row.house_margin_percent ?? "—"}%</td>
                    <td className="py-2 pr-3 score-num">{percent(row.original_overround)}</td>
                    <td className="py-2 pr-3 score-num">{percent(row.target_overround)}</td>
                    <td className="py-2 pr-3 score-num">{percent(row.offered_overround)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{timeAgo(row.last_sync_at)}</td>
                    <td className="py-2">
                      <span
                        className={
                          withheld
                            ? "rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400"
                            : "rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary"
                        }
                      >
                        {withheld ? "Retida" : "Oferecida"}
                      </span>
                      {row.calc_version ? (
                        <span className="ml-2 text-[10px] text-muted-foreground">{row.calc_version}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhuma cotação registrada ainda. Execute uma sincronização para popular a tabela.
        </p>
      )}
    </section>
  );
}
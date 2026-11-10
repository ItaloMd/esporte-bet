import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { formatCurrency } from "@/lib/format";

const KIND_LABEL = {
  bet: "Aposta",
  win: "Prêmio",
  rollback: "Estorno",
  adjustment: "Ajuste",
};

export default function GscReconciliationPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.GscTransaction.list({ sort: "-created_date", limit: 50 })
      .then((result) => setItems(result.items || []))
      .finally(() => setLoading(false));
  }, []);

  const divergent = items.filter((item) => item.status === "divergent").length;

  return (
    <section className="card-surface space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Conciliação de carteira</h2>
        <span className="text-[11px] text-muted-foreground">
          {items.length} lançamentos · {divergent} divergentes
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cada aposta, prêmio e estorno recebido do provedor é registrado com o identificador da rodada. Divergências
        aparecem aqui para revisão manual antes de qualquer ajuste de saldo.
      </p>

      {loading ? (
        <div className="h-20 animate-pulse rounded-lg bg-secondary/40" />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Nenhum lançamento recebido até agora.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {KIND_LABEL[item.kind] || item.kind} · {item.game_name || "jogo não informado"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {item.user_email || "jogador não identificado"} · rodada {item.round_id || "—"}
                </p>
              </div>
              <span className="score-num shrink-0 font-semibold">{formatCurrency(item.amount || 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
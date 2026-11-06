import React, { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { formatOdds } from "@/lib/format";

const STATUS_LABEL = {
  draft: { text: "Rascunho", className: "text-muted-foreground" },
  published: { text: "Publicada", className: "text-primary" },
  archived: { text: "Arquivada", className: "text-destructive" },
};

/** Múltiplas já cadastradas, com publicação e edição. */
export default function MultipleList({ revision = 0, onEdit }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [local, setLocal] = useState(0);

  const reload = useCallback(() => setLocal((current) => current + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const page = await base44.entities.SuperMultiple.filter({}, { limit: 50, sort: "-created_date" });
        if (alive) setRows(page.items || []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [revision, local]);

  const setStatus = async (row, status) => {
    setBusy(row.id);
    try {
      await base44.entities.SuperMultiple.update(row.id, { status });
      reload();
    } finally {
      setBusy("");
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Excluir a super múltipla "${row.title}"?`)) return;
    setBusy(row.id);
    try {
      await base44.entities.SuperMultiple.delete(row.id);
      reload();
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Múltiplas cadastradas</h2>
        <Button size="sm" variant="ghost" onClick={reload} disabled={loading}>
          Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-secondary/40" />
      ) : rows.length ? (
        <div className="space-y-2">
          {rows.map((row) => {
            const label = STATUS_LABEL[row.status] || STATUS_LABEL.draft;
            return (
              <div key={row.id} className="rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{row.title}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {row.legs || 0} seleções · odd {formatOdds(row.boosted_odd)} · +{Number(row.boost_percent) || 0}%
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${label.className}`}>
                    {label.text}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(row)} disabled={busy === row.id}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                  {row.status === "published" ? (
                    <Button size="sm" variant="outline" onClick={() => setStatus(row, "draft")} disabled={busy === row.id}>
                      Despublicar
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setStatus(row, "published")} disabled={busy === row.id}>
                      {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Publicar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => remove(row)} disabled={busy === row.id}>
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma super múltipla cadastrada ainda.</p>
      )}
    </section>
  );
}
import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";
import { formatNumber } from "@/lib/format";

export default function AdminCatalog({ actor }) {
  const [state, setState] = useState({ loading: true, sports: [], competitions: [], counts: {} });

  const load = async () => {
    setState((current) => ({ ...current, loading: true }));
    // Plataforma exclusivamente de futebol: o catálogo lista só esta modalidade.
    const [sports, competitions, aggregate] = await Promise.all([
      base44.entities.Sport.filter({ slug: "futebol" }, { sort: "sort_order", limit: 10 }),
      base44.entities.Competition.filter({ sport_slug: "futebol" }, { sort: "name", limit: 200 }),
      base44.entities.Event.aggregate({ query: { sport_slug: "futebol" }, groupBy: "competition_name" }),
    ]);
    const counts = {};
    (aggregate.rows || []).forEach((row) => {
      counts[row.competition_name] = row.count;
    });
    setState({ loading: false, sports: sports.items || [], competitions: competitions.items || [], counts });
  };

  useEffect(() => {
    load().catch(() => setState((current) => ({ ...current, loading: false })));
  }, []);

  const toggle = async (competition, patch) => {
    try {
      await base44.entities.Competition.update(competition.id, patch);
      await logAdminAction({
        actor,
        action: "competition.updated",
        targetType: "Competition",
        targetId: competition.id,
        details: `${competition.name}: ${JSON.stringify(patch)}`,
      });
      load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    }
  };

  if (state.loading) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-5">
      <section>

        <h2 className="mb-2 text-sm font-semibold">Esportes monitorados</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {state.sports.map((sport) => (
            <div key={sport.id} className="card-surface px-4 py-3">
              <p className="text-sm font-medium">{sport.name}</p>
              <p className="text-[11px] text-muted-foreground">
                identificador: {sport.slug} · {sport.active === false ? "inativo" : "ativo"}
              </p>
            </div>
          ))}
          {!state.sports.length && <p className="text-sm text-muted-foreground">Nenhum esporte cadastrado.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Competições e eventos importados</h2>
        <div className="space-y-2">
          {state.competitions.map((competition) => (
            <div key={competition.id} className="card-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{competition.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {competition.country || "Internacional"} · {formatNumber(state.counts[competition.name] || 0)} eventos na base
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Destaque
                  <Switch
                    checked={Boolean(competition.featured)}
                    onCheckedChange={(value) => toggle(competition, { featured: value })}
                    aria-label={`Destacar ${competition.name}`}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Ativa
                  <Switch
                    checked={competition.active !== false}
                    onCheckedChange={(value) => toggle(competition, { active: value })}
                    aria-label={`Ativar ${competition.name}`}
                  />
                </label>
              </div>
            </div>
          ))}
          {!state.competitions.length && <p className="text-sm text-muted-foreground">Nenhuma competição cadastrada.</p>}
        </div>
      </section>
    </div>
  );
}
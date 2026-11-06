import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save } from "lucide-react";
import { formatOdds } from "@/lib/format";
import { boostedOdd, parseSelections, totalOfLegs } from "@/lib/superMultiples";
import OddPicker from "@/components/admin/superMultiples/OddPicker";
import DraftList from "@/components/admin/superMultiples/DraftList";

/** Monta (ou edita) uma super múltipla escolhendo os jogos e as seleções. */
export default function MultipleForm({ initial, onSaved, onCancel }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(initial?.title || "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle || "");
  const [boost, setBoost] = useState(String(initial?.boost_percent ?? 10));
  const [status, setStatus] = useState(initial?.status === "published" ? "published" : "draft");
  const [legs, setLegs] = useState(() => parseSelections(initial?.selections));
  const [saving, setSaving] = useState(false);

  const base = totalOfLegs(legs);
  const total = boostedOdd(base, boost);

  const pick = (odd, event) => {
    setLegs((current) =>
      current.some((leg) => leg.odd_id === odd.id)
        ? current
        : [
            ...current,
            {
              odd_id: odd.id,
              event_id: event.id,
              market_id: odd.market_id,
              market_name: odd.market_name,
              label: odd.label,
              odd_value: Number(odd.value) || 0,
              event_label: `${event.home_team_name} x ${event.away_team_name}`,
              competition_name: event.competition_name,
              start_time: event.start_time,
            },
          ],
    );
  };

  const remove = (oddId) => setLegs((current) => current.filter((leg) => leg.odd_id !== oddId));

  const save = async () => {
    if (!title.trim()) {
      toast({ title: "Informe um título para a múltipla", variant: "destructive" });
      return;
    }
    if (legs.length < 2) {
      toast({ title: "Inclua pelo menos duas seleções", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const boostPercent = Number(String(boost).replace(",", ".")) || 0;
      const payload = {
        title: title.trim(),
        subtitle: subtitle.trim(),
        selections: JSON.stringify(legs),
        legs: legs.length,
        base_odd: base,
        boost_percent: boostPercent,
        boosted_odd: boostedOdd(base, boostPercent),
        status,
        sort_order: initial?.sort_order ?? 0,
      };
      if (initial) await base44.entities.SuperMultiple.update(initial.id, payload);
      else await base44.entities.SuperMultiple.create(payload);
      toast({ title: initial ? "Super múltipla atualizada" : "Super múltipla criada" });
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-surface space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{initial ? "Editar super múltipla" : "Montar super múltipla"}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha os jogos e as seleções, defina o percentual de turbinação e publique na vitrine da home.
          </p>
        </div>
        {initial && onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar edição
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="multiple-title">Título</Label>
          <Input
            id="multiple-title"
            value={title}
            placeholder="Combo da Rodada"
            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="multiple-subtitle">Subtítulo (opcional)</Label>
          <Input
            id="multiple-subtitle"
            value={subtitle}
            placeholder="Clássicos do fim de semana"
            onChange={(changeEvent) => setSubtitle(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="multiple-boost">Turbinação (%)</Label>
          <Input
            id="multiple-boost"
            inputMode="decimal"
            value={boost}
            onChange={(changeEvent) => setBoost(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Situação</Label>
          <div className="flex gap-2">
            {[
              { key: "draft", label: "Rascunho" },
              { key: "published", label: "Publicada" },
            ].map((option) => (
              <Button
                key={option.key}
                type="button"
                size="sm"
                variant={status === option.key ? "default" : "outline"}
                onClick={() => setStatus(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <OddPicker pickedIds={legs.map((leg) => leg.odd_id)} onPick={pick} />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Seleções ({legs.length})
          </h3>
          <span className="text-xs text-muted-foreground">
            Odd total: <span className="score-num font-semibold text-primary">{formatOdds(total)}</span>
          </span>
        </div>
        <DraftList legs={legs} onRemove={remove} />
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {initial ? "Salvar alterações" : "Criar super múltipla"}
        </Button>
      </div>
    </section>
  );
}
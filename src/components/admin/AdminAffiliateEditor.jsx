import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/format";
import { logAdminAction } from "@/lib/adminAudit";
import { AFFILIATE_MODELS } from "@/lib/affiliateModels";
import AffiliatePlayers from "@/components/affiliate/AffiliatePlayers";

/** Configuração do modelo de afiliação e acompanhamento dos jogadores indicados. */
export default function AdminAffiliateEditor({ affiliate, settings, actor, onSaved }) {
  const [form, setForm] = useState({
    model: affiliate.model || "full_rev",
    rev_share_percent: affiliate.rev_share_percent ?? 30,
    cpa_amount: affiliate.cpa_amount ?? 0,
    rollover_multiplier: affiliate.rollover_multiplier ?? 1,
    withdrawal_enabled: affiliate.withdrawal_enabled === true,
  });
  const [stats, setStats] = useState({ loading: true, players: [], totals: {} });
  const [saving, setSaving] = useState(false);

  const loadStats = async () => {
    setStats((current) => ({ ...current, loading: true }));
    try {
      const response = await base44.functions.invoke("affiliateStats", { affiliate_id: affiliate.id });
      setStats({ loading: false, players: response.data?.players || [], totals: response.data?.totals || {} });
    } catch {
      setStats({ loading: false, players: [], totals: {} });
    }
  };

  useEffect(() => {
    loadStats();
  }, [affiliate.id]);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await base44.entities.AffiliateProfile.update(affiliate.id, {
        model: form.model,
        rev_share_percent: Number(form.rev_share_percent) || 0,
        cpa_amount: Number(form.cpa_amount) || 0,
        rollover_multiplier: Number(form.rollover_multiplier) || 0,
        withdrawal_enabled: Boolean(form.withdrawal_enabled),
      });
      await logAdminAction({
        actor,
        action: "affiliate.settings_updated",
        targetType: "AffiliateProfile",
        targetId: affiliate.id,
        details: `Modelo ${form.model} · rev ${form.rev_share_percent}% · CPA R$ ${form.cpa_amount} · rollover ${form.rollover_multiplier}x · saque ${form.withdrawal_enabled ? "liberado" : "bloqueado"}`,
        severity: "warning",
      });
      toast({ title: "Modelo de afiliação atualizado" });
      onSaved?.();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const hint = AFFILIATE_MODELS.find((item) => item.value === form.model)?.hint;

  return (
    <div className="space-y-4 border-t border-border pt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`model-${affiliate.id}`}>Modelo de afiliação</Label>
          <select
            id={`model-${affiliate.id}`}
            value={form.model}
            onChange={(event) => update({ model: event.target.value })}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {AFFILIATE_MODELS.map((model) => (
              <option key={model.value} value={model.value}>{model.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`rev-${affiliate.id}`}>Rev share (%)</Label>
          <Input
            id={`rev-${affiliate.id}`}
            type="number"
            step="0.1"
            value={form.rev_share_percent}
            onChange={(event) => update({ rev_share_percent: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`cpa-${affiliate.id}`}>CPA por jogador (R$)</Label>
          <Input
            id={`cpa-${affiliate.id}`}
            type="number"
            step="0.01"
            value={form.cpa_amount}
            onChange={(event) => update({ cpa_amount: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`rollover-${affiliate.id}`}>Rollover para creditar (x FTD)</Label>
          <Input
            id={`rollover-${affiliate.id}`}
            type="number"
            step="0.1"
            value={form.rollover_multiplier}
            onChange={(event) => update({ rollover_multiplier: event.target.value })}
          />
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
        <span>
          Liberar saque para este afiliado
          <span className="block text-[11px] text-muted-foreground">
            {settings?.affiliate_withdrawal_enabled
              ? "O saque já está liberado para todos os afiliados."
              : "Libera o saque apenas para este afiliado."}
          </span>
        </span>
        <Switch
          checked={form.withdrawal_enabled}
          onCheckedChange={(value) => update({ withdrawal_enabled: value })}
        />
      </label>

      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          Salvar modelo
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Saldo elegível: {formatCurrency(stats.totals.available)} · já solicitado:{" "}
          {formatCurrency(stats.totals.requested)}
        </p>
      </div>

      {stats.loading ? (
        <div className="h-20 animate-pulse rounded-lg bg-secondary" />
      ) : (
        <AffiliatePlayers players={stats.players} totals={stats.totals} />
      )}
    </div>
  );
}
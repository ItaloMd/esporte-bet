import React, { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Save, ShieldOff, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, formatNumber } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";
import AdminAffiliateEditor from "@/components/admin/AdminAffiliateEditor";

const EMPTY_SETTINGS = { affiliate_withdrawal_enabled: false, affiliate_qftd_min_deposit: 50 };

export default function AdminAffiliates({ actor }) {
  const [state, setState] = useState({
    loading: true,
    affiliates: [],
    referrals: [],
    settings: null,
    settingsId: null,
  });
  const [busy, setBusy] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = async () => {
    setState((current) => ({ ...current, loading: true }));
    const [affiliates, referrals, settingsPage] = await Promise.all([
      base44.entities.AffiliateProfile.filter({}, { sort: "-created_date", limit: 100 }),
      base44.entities.AffiliateReferral.filter({}, { sort: "-created_date", limit: 100 }),
      base44.entities.AppSettings.list({ limit: 1 }),
    ]);
    const record = settingsPage.items?.[0] || null;
    setState({
      loading: false,
      affiliates: affiliates.items || [],
      referrals: referrals.items || [],
      settings: {
        affiliate_withdrawal_enabled: record?.affiliate_withdrawal_enabled === true,
        affiliate_qftd_min_deposit: record?.affiliate_qftd_min_deposit ?? EMPTY_SETTINGS.affiliate_qftd_min_deposit,
      },
      settingsId: record?.id || null,
    });
  };

  useEffect(() => {
    load().catch(() => setState((current) => ({ ...current, loading: false })));
  }, []);

  const updateAffiliate = async (affiliate, status) => {
    setBusy(affiliate.id);
    try {
      await base44.entities.AffiliateProfile.update(affiliate.id, {
        status,
        eligible: status !== "blocked",
        blocked_reason: status === "blocked" ? "Bloqueado pela administração por suspeita de fraude." : "",
      });
      await logAdminAction({
        actor,
        action: `affiliate.${status}`,
        targetType: "AffiliateProfile",
        targetId: affiliate.id,
        details: `Indicador ${affiliate.code} → ${status}`,
        severity: status === "blocked" ? "warning" : "info",
      });
      toast({ title: "Indicador atualizado" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const updateReferral = async (referral, status) => {
    setBusy(referral.id);
    try {
      await base44.entities.AffiliateReferral.update(referral.id, { status });
      await logAdminAction({
        actor,
        action: `referral.${status}`,
        targetType: "AffiliateReferral",
        targetId: referral.id,
        details: `Indicação ${referral.code} → ${status}`,
        severity: "warning",
      });
      toast({ title: "Indicação atualizada" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const patchSettings = (patch) => setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));

  const saveSettings = async () => {
    if (!state.settingsId) {
      toast({ title: "Configuração da plataforma não encontrada", variant: "destructive" });
      return;
    }
    setSavingSettings(true);
    try {
      await base44.entities.AppSettings.update(state.settingsId, {
        affiliate_withdrawal_enabled: Boolean(state.settings.affiliate_withdrawal_enabled),
        affiliate_qftd_min_deposit: Number(state.settings.affiliate_qftd_min_deposit) || 0,
      });
      await logAdminAction({
        actor,
        action: "affiliate.withdrawal_policy_updated",
        targetType: "AppSettings",
        targetId: state.settingsId,
        details: `Saque de comissões ${state.settings.affiliate_withdrawal_enabled ? "liberado para todos os afiliados" : "restrito a liberação individual"} · QFTD mínimo R$ ${state.settings.affiliate_qftd_min_deposit}`,
        severity: "warning",
      });
      toast({ title: "Política de afiliados atualizada" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  if (state.loading) return <div className="card-surface h-40 animate-pulse" />;

  const settings = state.settings || EMPTY_SETTINGS;

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Política de saque dos afiliados</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Liberar saque para todos os afiliados
            <Switch
              checked={Boolean(settings.affiliate_withdrawal_enabled)}
              onCheckedChange={(value) => patchSettings({ affiliate_withdrawal_enabled: value })}
            />
          </label>
          <div className="space-y-2">
            <Label htmlFor="qftd-min">Depósito mínimo para QFTD (R$)</Label>
            <Input
              id="qftd-min"
              type="number"
              step="0.01"
              value={settings.affiliate_qftd_min_deposit}
              onChange={(event) => patchSettings({ affiliate_qftd_min_deposit: event.target.value })}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Com a liberação geral desligada, o saque de comissões fica disponível apenas para os afiliados liberados
          individualmente na lista abaixo.
        </p>
        <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
          {savingSettings ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
          Salvar política
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Indicadores</h2>
        {state.affiliates.length ? (
          state.affiliates.map((affiliate) => (
            <div key={affiliate.id} className="card-surface space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="score-num text-sm font-semibold tracking-wider">{affiliate.code}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatNumber(affiliate.clicks)} cliques · {formatNumber(affiliate.referrals)} indicações ·{" "}
                    {formatNumber(affiliate.conversions)} conversões · status {affiliate.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === affiliate.id || affiliate.status === "active"}
                    onClick={() => updateAffiliate(affiliate, "active")}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={busy === affiliate.id || affiliate.status === "blocked"}
                    onClick={() => updateAffiliate(affiliate, "blocked")}
                  >
                    <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Bloquear
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOpenId(openId === affiliate.id ? null : affiliate.id)}
                  >
                    {openId === affiliate.id ? (
                      <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Modelo e jogadores
                  </Button>
                </div>
              </div>
              {openId === affiliate.id && (
                <AdminAffiliateEditor
                  affiliate={affiliate}
                  settings={settings}
                  actor={actor}
                  onSaved={load}
                />
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum indicador cadastrado.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Indicações atribuídas</h2>
        {state.referrals.length ? (
          state.referrals.map((referral) => (
            <div key={referral.id} className="card-surface space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {referral.code} → {referral.referred_label || "cadastro atribuído"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(referral.attributed_at || referral.created_date)} · status atual: {referral.status}
                  </p>
                </div>
                {busy === referral.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { status: "approved", label: "Aprovar" },
                  { status: "rejected", label: "Recusar" },
                  { status: "fraud", label: "Marcar fraude" },
                ].map((option) => (
                  <Button
                    key={option.status}
                    size="sm"
                    variant="outline"
                    disabled={busy === referral.id || referral.status === option.status}
                    onClick={() => updateReferral(referral, option.status)}
                  >
                    {option.status === "fraud" ? <X className="mr-1.5 h-3.5 w-3.5" /> : null}
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma indicação atribuída até agora.</p>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Indicações marcadas como fraude ou recusadas não geram recompensa. A comissão é calculada sobre os jogadores
        qualificados, conforme o modelo e o rollover definidos para cada afiliado.
      </p>
    </div>
  );
}
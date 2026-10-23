import React, { useEffect, useState } from "react";
import { Check, Loader2, ShieldOff, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";

export default function AdminAffiliates({ actor }) {
  const [state, setState] = useState({ loading: true, affiliates: [], referrals: [] });
  const [busy, setBusy] = useState(null);

  const load = async () => {
    setState((current) => ({ ...current, loading: true }));
    const [affiliates, referrals] = await Promise.all([
      base44.entities.AffiliateProfile.filter({}, { sort: "-created_date", limit: 100 }),
      base44.entities.AffiliateReferral.filter({}, { sort: "-created_date", limit: 100 }),
    ]);
    setState({ loading: false, affiliates: affiliates.items || [], referrals: referrals.items || [] });
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

  if (state.loading) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Indicadores</h2>
        {state.affiliates.length ? (
          state.affiliates.map((affiliate) => (
            <div key={affiliate.id} className="card-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
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
              </div>
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
        Indicações marcadas como fraude ou recusadas não geram recompensa. Nesta fase, nenhuma comissão é paga em
        dinheiro: a política de comissões depende de validação jurídica.
      </p>
    </div>
  );
}
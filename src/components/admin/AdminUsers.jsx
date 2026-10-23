import React, { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";
import { useAuth } from "@/lib/AuthContext";

const STATUS_STYLE = {
  verified: "border-primary/40 text-primary",
  pending: "border-amber-500/40 text-amber-400",
  rejected: "border-destructive/40 text-destructive",
  unverified: "border-border text-muted-foreground",
};

export default function AdminUsers({ actor }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    const [profiles, users] = await Promise.all([
      base44.entities.UserProfile.filter({}, { sort: "-created_date", limit: 100 }),
      base44.entities.User.list(),
    ]);
    const byId = new Map((users || []).map((item) => [item.id, item]));
    setRows(
      (profiles.items || []).map((profile) => ({
        ...profile,
        account: byId.get(profile.user_id) || null,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  const setIdentity = async (profile, status) => {
    setBusyId(profile.id);
    try {
      await base44.entities.UserProfile.update(profile.id, { identity_status: status });
      await base44.entities.IdentityVerification.create({
        user_id: profile.user_id,
        cpf_masked: profile.cpf_masked,
        method: "manual",
        status: status === "verified" ? "verified" : "rejected",
        verified_at: new Date().toISOString(),
        notes: `Revisão manual pelo administrador (${user?.email ? "conta administrativa" : "painel"}).`,
      });
      await logAdminAction({
        actor,
        action: `user_profile.identity_${status}`,
        targetType: "UserProfile",
        targetId: profile.id,
        details: `Status de identidade ajustado para ${status}.`,
        severity: "warning",
      });
      toast({ title: "Status de identidade atualizado" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dados pessoais são exibidos apenas no necessário: CPF sempre mascarado, sem acesso a senhas ou credenciais.
      </p>
      {rows.length ? (
        rows.map((row) => (
          <div key={row.id} className="card-surface space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.full_name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {row.account?.email || "e-mail não disponível"} · CPF {row.cpf_masked}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Conta criada em {formatDateTime(row.account?.created_date || row.created_date)}
                  {row.account?.role === "admin" ? " · administrador" : ""}
                </p>
              </div>
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[row.identity_status] || STATUS_STYLE.unverified}`}>
                {row.identity_status}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === row.id}
                onClick={() => setIdentity(row, "verified")}
              >
                {busyId === row.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-2 h-3.5 w-3.5" />}
                Marcar verificado
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={busyId === row.id}
                onClick={() => setIdentity(row, "rejected")}
              >
                <ShieldX className="mr-2 h-3.5 w-3.5" />
                Recusar
              </Button>
            </div>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum cadastro concluído até agora.</p>
      )}
    </div>
  );
}
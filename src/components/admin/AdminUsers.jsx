import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { formatCurrency } from "@/lib/format";
import UserDetail from "@/components/admin/users/UserDetail";

const STATUS_STYLE = {
  verified: "border-primary/40 text-primary",
  pending: "border-amber-500/40 text-amber-400",
  rejected: "border-destructive/40 text-destructive",
  unverified: "border-border text-muted-foreground",
};

export default function AdminUsers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = async () => {
    setLoading(true);
    const [profiles, users, wallets] = await Promise.all([
      base44.entities.UserProfile.filter({}, { sort: "-created_date", limit: 100 }),
      base44.entities.User.list(),
      base44.entities.Wallet.filter({}, { limit: 200 }),
    ]);
    const accountById = new Map((users || []).map((item) => [item.id, item]));
    const walletByUser = new Map((wallets.items || []).map((wallet) => [wallet.user_id, wallet]));
    setRows(
      (profiles.items || []).map((profile) => ({
        ...profile,
        account: accountById.get(profile.user_id) || null,
        wallet: walletByUser.get(profile.user_id) || null,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Gestão de contas: histórico de depósitos, apostas e saques, rollover atual e ajuste de saldo. A verificação de
        identidade (KYC) fica na aba própria.
      </p>
      {rows.length ? (
        rows.map((row) => (
          <div key={row.id} className="card-surface px-4 py-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => setOpenId(openId === row.user_id ? null : row.user_id)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.full_name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {row.account?.email || "e-mail não disponível"} · CPF {row.cpf_masked}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Saldo {formatCurrency(row.wallet?.balance)} · rollover {formatCurrency(row.wallet?.rollover_completed)} de{" "}
                  {formatCurrency(row.wallet?.rollover_required)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[row.identity_status] || STATUS_STYLE.unverified}`}
                >
                  {row.identity_status}
                </span>
                {openId === row.user_id ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
            </button>
            {openId === row.user_id && <UserDetail row={row} onAdjusted={load} />}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum cadastro concluído até agora.</p>
      )}
    </div>
  );
}
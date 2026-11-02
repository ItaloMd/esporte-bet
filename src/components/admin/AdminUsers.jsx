import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import UserDetail from "@/components/admin/users/UserDetail";

const PAGE_SIZE = 50;

export default function AdminUsers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [term, setTerm] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Busca no servidor: nome, CPF ou e-mail encontram o jogador sem depender de
  // a lista inteira ter sido carregada na tela.
  const load = useCallback(async (needle) => {
    setLoading(true);
    const clean = String(needle || "").trim();
    const digits = clean.replace(/\D/g, "");
    const conditions = [];
    if (clean) {
      conditions.push({ full_name: { $regex: clean, $options: "i" } });
      conditions.push({ display_name: { $regex: clean, $options: "i" } });
      conditions.push({ cpf_masked: { $regex: clean, $options: "i" } });
      if (digits.length >= 3) conditions.push({ cpf: { $regex: digits, $options: "i" } });
    }
    const [emailMatches, users] = await Promise.all([
      clean.includes("@")
        ? base44.entities.User.filter({ email: { $regex: clean, $options: "i" } }, { limit: 50 }).catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] }),
      base44.entities.User.list(),
    ]);
    // Busca por e-mail resolve a conta e localiza o perfil pelo usuário.
    if (emailMatches.items?.length) {
      conditions.push({ user_id: { $in: emailMatches.items.map((item) => item.id) } });
    }
    const profileFilter = conditions.length ? { $or: conditions } : {};
    const profiles = await base44.entities.UserProfile.filter(profileFilter, {
      sort: "-created_date",
      limit: PAGE_SIZE,
    });
    const accountById = new Map((users || []).map((item) => [item.id, item]));
    const matched = (profiles.items || []).filter((profile) => {
      if (!clean) return true;
      const account = accountById.get(profile.user_id);
      const haystack = `${profile.full_name || ""} ${account?.email || ""}`.toLowerCase();
      return haystack.includes(clean.toLowerCase()) || Boolean(profile.cpf || profile.cpf_masked);
    });
    const userIds = matched.map((profile) => profile.user_id);
    const wallets = userIds.length
      ? await base44.entities.Wallet.filter({ user_id: { $in: userIds } }, { limit: 200 })
      : { items: [] };
    const walletByUser = new Map((wallets.items || []).map((wallet) => [wallet.user_id, wallet]));
    setRows(
      matched.map((profile) => ({
        ...profile,
        account: accountById.get(profile.user_id) || null,
        wallet: walletByUser.get(profile.user_id) || null,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load("").catch(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(term), 350);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    load(searchTerm).catch(() => setLoading(false));
  }, [searchTerm, load]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Buscar por nome, CPF ou e-mail"
          className="h-10 pl-9"
          aria-label="Buscar jogador"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {loading ? "Carregando jogadores…" : `${rows.length} jogador(es) ${searchTerm ? "encontrado(s)" : "recentes"}`}
      </p>

      {loading ? (
        <div className="card-surface h-40 animate-pulse" />
      ) : rows.length ? (
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
                  {row.account?.email || "e-mail não disponível"} · CPF {row.cpf_masked || "não vinculado"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Saldo {formatCurrency(row.wallet?.balance)} · rollover {formatCurrency(row.wallet?.rollover_completed)} de{" "}
                  {formatCurrency(row.wallet?.rollover_required)}
                </p>
              </div>
              {openId === row.user_id ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </button>
            {openId === row.user_id && <UserDetail row={row} onAdjusted={() => load(searchTerm)} />}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          {searchTerm ? "Nenhum jogador encontrado para esta busca." : "Nenhum cadastro concluído até agora."}
        </p>
      )}
    </div>
  );
}
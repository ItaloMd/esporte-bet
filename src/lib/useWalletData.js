import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useWallet } from "@/lib/WalletProvider";

/**
 * Carregamento único dos dados da carteira, compartilhado pelas páginas de
 * resumo, depósito e saque — uma só fonte, sem consultas duplicadas.
 */
export function useWalletData() {
  const { user, isAuthenticated, isLoadingAuth, authChecked, navigateToLogin } = useAuth();
  const { reload: reloadBalance } = useWallet();
  const [state, setState] = useState({ loading: true, wallet: null, deposits: [], withdrawals: [], transactions: [], settings: {}, profile: null });

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [walletPage, depositPage, withdrawalPage, transactionPage, settingsPage, profilePage] = await Promise.all([
      base44.entities.Wallet.filter({ user_id: user.id }, { limit: 1 }),
      base44.entities.Deposit.filter({ user_id: user.id }, { sort: "-created_date", limit: 10 }),
      base44.entities.Withdrawal.filter(
        { user_id: user.id, kind: { $in: ["player", "simulated"] } },
        { sort: "-created_date", limit: 10 },
      ),
      base44.entities.WalletTransaction.filter({ user_id: user.id }, { sort: "-created_date", limit: 15 }),
      base44.entities.AppSettings.list({ limit: 1 }),
      base44.entities.UserProfile.filter({ user_id: user.id }, { limit: 1 }),
    ]);
    setState({
      loading: false,
      wallet: walletPage.items?.[0] || null,
      deposits: depositPage.items || [],
      withdrawals: withdrawalPage.items || [],
      transactions: transactionPage.items || [],
      settings: settingsPage.items?.[0] || {},
      profile: profilePage.items?.[0] || null,
    });
    reloadBalance();
  }, [user?.id, reloadBalance]);

  useEffect(() => {
    if (!authChecked || isLoadingAuth) return undefined;
    if (!isAuthenticated) {
      navigateToLogin();
      return undefined;
    }
    load().catch(() => setState((current) => ({ ...current, loading: false })));
    return undefined;
  }, [authChecked, isLoadingAuth, isAuthenticated, load, navigateToLogin]);

  return { ...state, load, user };
}
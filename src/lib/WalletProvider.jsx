import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

const WalletContext = createContext({ balance: 0, loading: false, reload: () => {}, setBalance: () => {} });

export function WalletProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setBalance(0);
      return;
    }
    setLoading(true);
    try {
      const page = await base44.entities.Wallet.filter({ user_id: user.id }, { limit: 1 });
      setBalance(Number(page.items?.[0]?.balance || 0));
    } catch {
      setBalance(0);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(() => ({ balance, loading, reload, setBalance }), [balance, loading, reload]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}
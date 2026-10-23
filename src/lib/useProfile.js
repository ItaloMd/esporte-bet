import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

export default function useProfile() {
  const { user, isAuthenticated, isLoadingAuth, authChecked } = useAuth();
  const [state, setState] = useState({ loading: true, profile: null, error: "" });

  const load = useCallback(async () => {
    if (!isAuthenticated || !user?.id) {
      setState({ loading: false, profile: null, error: "" });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const page = await base44.entities.UserProfile.filter({ user_id: user.id }, { limit: 1 });
      setState({ loading: false, profile: page.items?.[0] || null, error: "" });
    } catch (error) {
      setState({ loading: false, profile: null, error: error.message || "Falha ao carregar o perfil." });
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (authChecked && !isLoadingAuth) load();
  }, [authChecked, isLoadingAuth, load]);

  return { ...state, user, reload: load };
}
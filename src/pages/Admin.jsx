import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminShell, { findSectionLabel } from "@/components/admin/AdminShell";
import AdminExecutiveDashboard from "@/components/admin/AdminExecutiveDashboard";
import AdminMatches from "@/components/admin/AdminMatches";
import AdminAudit from "@/components/admin/AdminAudit";
import FootballCentral from "@/components/admin/FootballCentral";
import AdminOpenBets from "@/components/admin/AdminOpenBets";
import AdminMarkets from "@/components/admin/AdminMarkets";
import AdminUsers from "@/components/admin/AdminUsers";
import AdminKyc from "@/components/admin/AdminKyc";
import AdminFinance from "@/components/admin/AdminFinance";
import AdminGateways from "@/components/admin/AdminGateways";
import AdminAffiliates from "@/components/admin/AdminAffiliates";
import AdminBanners from "@/components/admin/AdminBanners";
import AdminSuperOdds from "@/components/admin/AdminSuperOdds";
import AdminRisk from "@/components/admin/AdminRisk";
import AdminSettings from "@/components/admin/AdminSettings";
import AdminFootball from "@/components/admin/AdminFootball";
import AdminProvider from "@/components/admin/AdminProvider";
import AdminCatalog from "@/components/admin/AdminCatalog";
import AdminLogs from "@/components/admin/AdminLogs";
import { useAuth } from "@/lib/AuthContext";

const SECTION_COMPONENTS = {
  overview: (user) => <AdminExecutiveDashboard />,
  live: () => <AdminMatches mode="live" />,
  today: () => <AdminMatches mode="today" />,
  "audit-games": () => <AdminAudit />,
  "api-monitor": () => <FootballCentral />,
  "open-bets": () => <AdminOpenBets mode="open" />,
  "closed-bets": () => <AdminOpenBets mode="closed" />,
  markets: () => <AdminMarkets />,
  players: (user) => <AdminUsers actor={user} />,
  kyc: (user) => <AdminKyc actor={user} />,
  finance: () => <AdminFinance />,
  gateways: () => <AdminGateways />,
  affiliates: (user) => <AdminAffiliates actor={user} />,
  banners: (user) => <AdminBanners actor={user} />,
  "super-odds": () => <AdminSuperOdds />,
  reports: () => <AdminRisk />,
  platform: (user) => <AdminSettings actor={user} />,
  "api-football": (user) => <AdminFootball actor={user} />,
  provider: (user) => <AdminProvider actor={user} />,
  catalog: (user) => <AdminCatalog actor={user} />,
  risk: () => <AdminRisk />,
  logs: (user) => <AdminLogs actor={user} />,
};

export default function Admin() {
  const { user, isAuthenticated } = useAuth();
  const [section, setSection] = useState(() => new URLSearchParams(window.location.search).get("s") || "overview");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", section);
    window.history.replaceState(null, "", url);
  }, [section]);

  if (!isAuthenticated) {
    return (
      <div className="card-surface px-4 py-10 text-center">
        <ShieldAlert className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
        <p className="mt-2 font-medium">Área restrita: entre com uma conta administrativa</p>
        <Button className="mt-3" asChild>
          <Link to="/login">Entrar</Link>
        </Button>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="card-surface px-4 py-10 text-center">
        <ShieldAlert className="mx-auto h-7 w-7 text-destructive" aria-hidden="true" />
        <p className="mt-2 font-medium">Acesso restrito</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Esta área é exclusiva para administradores.
        </p>
        <Button className="mt-3" variant="outline" asChild>
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    );
  }

  const content = (SECTION_COMPONENTS[section] || SECTION_COMPONENTS.overview)(user);

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Painel administrativo</h1>
          <p className="text-xs text-muted-foreground">
            {findSectionLabel(section)} · permissões verificadas no servidor · ações registradas em log de auditoria
          </p>
        </div>
      </header>

      <AdminShell section={section} onChange={setSection}>
        {content}
      </AdminShell>
    </div>
  );
}
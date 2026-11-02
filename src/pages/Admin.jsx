import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminShell from "@/components/admin/AdminShell";
import AdminExecutiveDashboard from "@/components/admin/AdminExecutiveDashboard";
import AdminMatches from "@/components/admin/AdminMatches";
import AdminAudit from "@/components/admin/AdminAudit";
import ManualResultReview from "@/components/admin/football/ManualResultReview";
import FootballCentral from "@/components/admin/FootballCentral";
import AdminOpenBets from "@/components/admin/AdminOpenBets";
import AdminMarkets from "@/components/admin/AdminMarkets";
import AdminUsers from "@/components/admin/AdminUsers";
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
  overview: () => <AdminExecutiveDashboard />,
  today: () => <AdminMatches mode="today" />,
  "audit-games": () => <AdminAudit />,
  results: () => <ManualResultReview />,
  "api-monitor": () => <FootballCentral />,
  "open-bets": () => <AdminOpenBets mode="open" />,
  "closed-bets": () => <AdminOpenBets mode="closed" />,
  markets: () => <AdminMarkets />,
  players: (user) => <AdminUsers actor={user} />,
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
  logs: (user) => <AdminLogs actor={user} />,
};

export default function Admin() {
  const { user, isAuthenticated } = useAuth();
  const [section, setSection] = useState(() => new URLSearchParams(window.location.search).get("s") || "overview");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", section);
    window.history.replaceState(null, "", url);
  }, [section]);

  if (!isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card-surface w-full max-w-sm px-4 py-10 text-center">
          <ShieldAlert className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
          <p className="mt-2 font-medium">Área restrita: entre com uma conta administrativa</p>
          <Button className="mt-3" asChild>
            <Link to="/login">Entrar</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="card-surface w-full max-w-sm px-4 py-10 text-center">
          <ShieldAlert className="mx-auto h-7 w-7 text-destructive" aria-hidden="true" />
          <p className="mt-2 font-medium">Acesso restrito</p>
          <p className="mt-1 text-xs text-muted-foreground">Esta área é exclusiva para administradores.</p>
          <Button className="mt-3" variant="outline" asChild>
            <Link to="/">Voltar ao início</Link>
          </Button>
        </div>
      </div>
    );
  }

  const content = (SECTION_COMPONENTS[section] || SECTION_COMPONENTS.overview)(user);

  return (
    <AdminShell section={section} onChange={setSection} onRefresh={() => setRefreshToken((token) => token + 1)}>
      <div key={`${section}-${refreshToken}`}>{content}</div>
    </AdminShell>
  );
}
import React from "react";
import { Link } from "react-router-dom";
import { Activity, CreditCard, FileSearch, Gauge, LayoutDashboard, Database, Gift, Images, ShieldAlert, ShieldCheck, SlidersHorizontal, UserCheck, Users, Wallet, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminUsers from "@/components/admin/AdminUsers";
import AdminKyc from "@/components/admin/AdminKyc";
import AdminAffiliates from "@/components/admin/AdminAffiliates";
import AdminCatalog from "@/components/admin/AdminCatalog";
import AdminBanners from "@/components/admin/AdminBanners";
import AdminSuperOdds from "@/components/admin/AdminSuperOdds";
import AdminProvider from "@/components/admin/AdminProvider";
import AdminFootball from "@/components/admin/AdminFootball";
import AdminFinance from "@/components/admin/AdminFinance";
import AdminGateways from "@/components/admin/AdminGateways";
import AdminAudit from "@/components/admin/AdminAudit";
import AdminRisk from "@/components/admin/AdminRisk";
import AdminSettings from "@/components/admin/AdminSettings";
import AdminLogs from "@/components/admin/AdminLogs";
import { useAuth } from "@/lib/AuthContext";

const TABS = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "users", label: "Usuários", icon: Users },
  { value: "kyc", label: "Verificação KYC", icon: UserCheck },
  { value: "finance", label: "Financeiro", icon: Wallet },
  { value: "gateways", label: "Gateways", icon: CreditCard },
  { value: "audit", label: "Auditoria", icon: FileSearch },
  { value: "risk", label: "Caixa e risco", icon: Gauge },
  { value: "affiliates", label: "Afiliados", icon: Gift },
  { value: "banners", label: "Banners", icon: Images },
  { value: "super-odds", label: "Super odds", icon: Zap },
  { value: "catalog", label: "Esportes e competições", icon: Database },
  { value: "provider", label: "Margem e cotações", icon: SlidersHorizontal },
  { value: "football", label: "API-Football", icon: Activity },
  { value: "settings", label: "Identidade e textos", icon: ShieldCheck },
  { value: "logs", label: "Logs e privacidade", icon: ShieldAlert },
];

export default function Admin() {
  const { user, isAuthenticated } = useAuth();

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
          Esta área é exclusiva para administradores. Funções operacionais não têm acesso a dados pessoais além do
          necessário.
        </p>
        <Button className="mt-3" variant="outline" asChild>
          <Link to="/">Voltar ao início</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Painel administrativo</h1>
          <p className="text-xs text-muted-foreground">
            Permissões verificadas no servidor · ações sensíveis registradas em log de auditoria
          </p>
        </div>
      </header>

      <Tabs defaultValue="dashboard">
        <TabsList className="hide-scrollbar flex w-full justify-start gap-1 overflow-x-auto bg-secondary/40 p-1">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 gap-1.5 text-xs">
              <tab.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <AdminDashboard />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <AdminUsers actor={user} />
        </TabsContent>
        <TabsContent value="kyc" className="mt-4">
          <AdminKyc actor={user} />
        </TabsContent>
        <TabsContent value="finance" className="mt-4">
          <AdminFinance />
        </TabsContent>
        <TabsContent value="gateways" className="mt-4">
          <AdminGateways />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AdminAudit />
        </TabsContent>
        <TabsContent value="risk" className="mt-4">
          <AdminRisk />
        </TabsContent>
        <TabsContent value="affiliates" className="mt-4">
          <AdminAffiliates actor={user} />
        </TabsContent>
        <TabsContent value="banners" className="mt-4">
          <AdminBanners actor={user} />
        </TabsContent>
        <TabsContent value="super-odds" className="mt-4">
          <AdminSuperOdds />
        </TabsContent>
        <TabsContent value="catalog" className="mt-4">
          <AdminCatalog actor={user} />
        </TabsContent>
        <TabsContent value="provider" className="mt-4">
          <AdminProvider actor={user} />
        </TabsContent>
        <TabsContent value="football" className="mt-4">
          <AdminFootball actor={user} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <AdminSettings actor={user} />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <AdminLogs actor={user} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
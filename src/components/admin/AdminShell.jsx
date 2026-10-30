import React from "react";
import {
  Activity, BarChart3, CalendarDays, CreditCard, Database, FileSearch, Gauge, Gift, Images,
  LayoutDashboard, Radio, ShieldAlert, ShieldCheck, SlidersHorizontal, Target, Ticket, TicketCheck,
  Users, UserCheck, Wallet, Zap,
} from "lucide-react";

export const ADMIN_SECTIONS = [
  {
    group: "Dashboard",
    items: [{ key: "overview", label: "Visão Geral", icon: LayoutDashboard }],
  },
  {
    group: "Operações",
    items: [
      { key: "live", label: "Jogos Ao Vivo", icon: Radio },
      { key: "today", label: "Jogos Hoje", icon: CalendarDays },
      { key: "audit-games", label: "Auditoria de Jogos", icon: FileSearch },
      { key: "api-monitor", label: "Monitoramento da API", icon: Activity },
    ],
  },
  {
    group: "Apostas",
    items: [
      { key: "open-bets", label: "Apostas em Aberto", icon: Ticket },
      { key: "closed-bets", label: "Apostas Encerradas", icon: TicketCheck },
      { key: "markets", label: "Mercados", icon: Target },
    ],
  },
  {
    group: "Usuários",
    items: [
      { key: "players", label: "Jogadores", icon: Users },
      { key: "kyc", label: "Verificações (KYC)", icon: UserCheck },
    ],
  },
  {
    group: "Financeiro",
    items: [
      { key: "finance", label: "Depósitos e Saques", icon: Wallet },
      { key: "gateways", label: "Gateways", icon: CreditCard },
    ],
  },
  {
    group: "Afiliação",
    items: [{ key: "affiliates", label: "Afiliados", icon: Gift }],
  },
  {
    group: "Marketing",
    items: [
      { key: "banners", label: "Banners", icon: Images },
      { key: "super-odds", label: "Super Odds", icon: Zap },
    ],
  },
  {
    group: "Relatórios",
    items: [{ key: "reports", label: "Relatórios Financeiros", icon: BarChart3 }],
  },
  {
    group: "Configurações",
    items: [
      { key: "platform", label: "Plataforma", icon: ShieldCheck },
      { key: "api-football", label: "Configuração da API", icon: SlidersHorizontal },
      { key: "provider", label: "Margem e Cotações", icon: SlidersHorizontal },
      { key: "catalog", label: "Esportes e Competições", icon: Database },
      { key: "risk", label: "Caixa e Risco", icon: Gauge },
      { key: "logs", label: "Logs e Privacidade", icon: ShieldAlert },
    ],
  },
];

export function findSectionLabel(key) {
  for (const group of ADMIN_SECTIONS) {
    const item = group.items.find((entry) => entry.key === key);
    if (item) return item.label;
  }
  return "Painel";
}

export default function AdminShell({ section, onChange, children }) {
  const active = ADMIN_SECTIONS.some((group) => group.items.some((item) => item.key === section)) ? section : "overview";

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* Desktop: menu lateral agrupado */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-4 space-y-4" aria-label="Seções do painel">
          {ADMIN_SECTIONS.map((group) => (
            <div key={group.group}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.group}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = active === item.key;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        onClick={() => onChange(item.key)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          isActive
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-foreground/75 hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile: seletor de seção */}
      <div className="lg:hidden">
        <label className="sr-only" htmlFor="admin-section-select">Seção do painel</label>
        <select
          id="admin-section-select"
          value={active}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-secondary px-3 text-sm"
        >
          {ADMIN_SECTIONS.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
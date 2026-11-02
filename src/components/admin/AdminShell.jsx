import React from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowLeft, BarChart3, CalendarDays, CreditCard, Database, FileSearch, Gauge, Gift, Images,
  LayoutDashboard, RefreshCw, ShieldAlert, ShieldCheck, SlidersHorizontal, Target, Ticket, TicketCheck, Users, Wallet, Zap,
} from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import { useAppSettings } from "@/lib/appSettings";

export const ADMIN_SECTIONS = [
  { group: "Painel", items: [{ key: "overview", label: "Visão geral", icon: LayoutDashboard }] },
  {
    group: "Jogos",
    items: [
      { key: "today", label: "Jogos de hoje", icon: CalendarDays },
      { key: "audit-games", label: "Auditoria de jogos", icon: FileSearch },
      { key: "results", label: "Revisão de resultados", icon: ShieldCheck },
    ],
  },
  {
    group: "Apostas",
    items: [
      { key: "open-bets", label: "Apostas abertas", icon: Ticket },
      { key: "closed-bets", label: "Apostas encerradas", icon: TicketCheck },
      { key: "markets", label: "Mercados", icon: Target },
    ],
  },
  {
    group: "Pessoas",
    items: [
      { key: "players", label: "Jogadores", icon: Users },
      { key: "affiliates", label: "Afiliados", icon: Gift },
    ],
  },
  {
    group: "Financeiro",
    items: [
      { key: "finance", label: "Depósitos e saques", icon: Wallet },
      { key: "gateways", label: "Gateways", icon: CreditCard },
      { key: "reports", label: "Caixa e risco", icon: BarChart3 },
    ],
  },
  {
    group: "Marketing",
    items: [
      { key: "banners", label: "Banners", icon: Images },
      { key: "super-odds", label: "Super odds", icon: Zap },
    ],
  },
  {
    group: "API-Football",
    items: [
      { key: "api-monitor", label: "Monitoramento", icon: Activity },
      { key: "api-football", label: "Coleta", icon: SlidersHorizontal },
      { key: "provider", label: "Margem e cotações", icon: Gauge },
      { key: "catalog", label: "Competições", icon: Database },
    ],
  },
  {
    group: "Sistema",
    items: [
      { key: "platform", label: "Plataforma", icon: ShieldAlert },
      { key: "logs", label: "Logs e privacidade", icon: ShieldAlert },
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

/** Painel em tela cheia: navegação própria, sem menu da plataforma. */
export default function AdminShell({ section, onChange, onRefresh, children }) {
  const settings = useAppSettings();
  const active = ADMIN_SECTIONS.some((group) => group.items.some((item) => item.key === section)) ? section : "overview";

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card/60 lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <BrandMark className="h-8 w-8" />
          <div className="min-w-0">
            <p className="truncate font-heading text-sm font-semibold leading-tight">{settings.brand_name}</p>
            <p className="text-[10px] uppercase tracking-widest text-primary">Admin</p>
          </div>
        </div>
        <nav className="hide-scrollbar flex-1 overflow-y-auto px-2 pb-4" aria-label="Seções do painel">
          {ADMIN_SECTIONS.map((group) => (
            <div key={group.group} className="mb-3">
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
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
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          isActive
                            ? "bg-primary/15 font-semibold text-primary"
                            : "text-foreground/70 hover:bg-secondary hover:text-foreground"
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
        <Link
          to="/"
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Voltar ao site
        </Link>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 md:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground lg:hidden">
                {settings.brand_name} · Admin
              </p>
              <h1 className="truncate text-lg font-semibold">{findSectionLabel(active)}</h1>
            </div>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Atualizar
              </button>
            )}
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Site
            </Link>
          </div>
          <div className="hide-scrollbar flex gap-1.5 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
            {ADMIN_SECTIONS.flatMap((group) => group.items).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onChange(item.key)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                  active === item.key ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>
        <main className="px-4 py-5 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
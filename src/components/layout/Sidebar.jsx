import React from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, ShieldCheck } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import { NAV_ITEMS } from "@/lib/nav";
import { useAppSettings } from "@/lib/appSettings";
import { useAuth } from "@/lib/AuthContext";

export default function Sidebar() {
  const settings = useAppSettings();
  const { user } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[15.5rem] flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <NavLink to="/" className="flex items-center gap-3 px-4 pb-4 pt-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/30">
          <BrandMark className="h-7 w-7" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-lg font-semibold uppercase leading-none tracking-tight">
            {settings.brand_name}
          </span>
          <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-primary">Futebol</span>
        </span>
      </NavLink>

      <nav className="hide-scrollbar flex-1 overflow-y-auto px-2.5 pb-4" aria-label="Navegação principal">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-primary/15 font-semibold text-primary ring-1 ring-primary/25"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`
                }
              >
                <item.icon className="h-[1.05rem] w-[1.05rem] shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {user?.role === "admin" && (
        <div className="px-2.5 pb-2">
          <NavLink
            to="/admin"
            className="flex items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-sidebar-foreground/75 transition-colors hover:border-primary/50 hover:text-primary"
          >
            <LayoutDashboard className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
            Painel admin
          </NavLink>
        </div>
      )}

      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-primary" aria-hidden="true" /> +18
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Aposte com responsabilidade.
        </p>
      </div>
    </aside>
  );
}
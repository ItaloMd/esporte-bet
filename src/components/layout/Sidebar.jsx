import React from "react";
import { NavLink } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import { NAV_ITEMS } from "@/lib/nav";
import { useAppSettings } from "@/lib/appSettings";
import { useAuth } from "@/lib/AuthContext";

export default function Sidebar() {
  const settings = useAppSettings();
  const { user } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[15.5rem] flex-col border-r border-border bg-sidebar md:flex">
      <NavLink to="/" className="flex items-center gap-2.5 px-5 py-5">
        <BrandMark className="h-8 w-8" />
        <span className="min-w-0">
          <span className="block font-heading text-lg font-semibold leading-none">{settings.brand_name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">Odds informativas</span>
        </span>
      </NavLink>

      <nav className="hide-scrollbar flex-1 overflow-y-auto px-3 pb-4" aria-label="Navegação principal">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {user?.role === "admin" && (
        <div className="border-t border-border p-3">
          <NavLink
            to="/admin"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Painel administrativo
          </NavLink>
        </div>
      )}

      <p className="border-t border-border px-5 py-3 text-[10px] leading-relaxed text-muted-foreground">
        Uso restrito a maiores de 18 anos. Aposte com responsabilidade.
      </p>
    </aside>
  );
}
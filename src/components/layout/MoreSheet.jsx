import React from "react";
import { NavLink } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ShieldCheck } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";

export default function MoreSheet({ open, onOpenChange, isAdmin, onNavigate }) {
  const items = isAdmin ? [...NAV_ITEMS, { path: "/admin", label: "Painel administrativo", icon: ShieldCheck }] : NAV_ITEMS;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[19rem] border-border bg-card p-0">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Menu
          </SheetTitle>
        </SheetHeader>
        <ul className="p-3">
          {items.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    isActive ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-secondary"
                  }`
                }
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
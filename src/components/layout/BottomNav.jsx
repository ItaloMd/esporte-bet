import React from "react";
import { NavLink } from "react-router-dom";
import { BOTTOM_ITEMS } from "@/lib/nav";

export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      aria-label="Navegação principal"
    >
      <ul className="grid grid-cols-5">
        {BOTTOM_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`grid h-8 w-12 place-items-center rounded-full transition-colors ${
                      isActive ? "bg-primary/15" : "bg-transparent"
                    }`}
                  >
                    <item.icon className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
import React, { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, Search, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BrandMark from "@/components/brand/BrandMark";
import MoreSheet from "@/components/layout/MoreSheet";
import UserMenu from "@/components/layout/UserMenu";
import { useAppSettings } from "@/lib/appSettings";
import { useAuth } from "@/lib/AuthContext";
import { useWallet } from "@/lib/WalletProvider";
import { formatCurrency } from "@/lib/format";

export default function TopBar() {
  const settings = useAppSettings();
  const { user, isAuthenticated } = useAuth();
  const { balance } = useWallet();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [term, setTerm] = useState("");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2.5 md:px-6 md:py-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <Link to="/" className="flex items-center gap-2 md:hidden" aria-label={settings.brand_name}>
          <BrandMark className="h-7 w-7" />
          <span className="font-heading text-base font-semibold">{settings.brand_name}</span>
        </Link>

        <form
          className="relative ml-auto hidden w-full max-w-md md:block"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(term.trim() ? `/busca?q=${encodeURIComponent(term.trim())}` : "/busca");
          }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Buscar equipe, competição ou partida"
            className="h-10 pl-9"
            aria-label="Buscar"
          />
        </form>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {isAuthenticated && (
            <Link
              to="/carteira"
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary"
              aria-label="Saldo disponível na carteira"
            >
              <WalletIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="score-num">{formatCurrency(balance)}</span>
            </Link>
          )}
          {user?.role === "admin" && (
            <NavLink
              to="/admin"
              className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary md:inline-flex"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Admin
            </NavLink>
          )}
          <UserMenu />
        </div>
      </div>
      <MoreSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        isAdmin={user?.role === "admin"}
        onNavigate={() => setMenuOpen(false)}
      />
    </header>
  );
}
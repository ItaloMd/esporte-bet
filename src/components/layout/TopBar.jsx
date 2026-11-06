import React, { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, Search, Wallet as WalletIcon } from "lucide-react";
import BrandMark from "@/components/brand/BrandMark";
import MoreSheet from "@/components/layout/MoreSheet";
import UserMenu from "@/components/layout/UserMenu";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/appSettings";
import { useAuth } from "@/lib/AuthContext";
import { useWallet } from "@/lib/WalletProvider";
import { formatCurrency } from "@/lib/format";

const LINKS = [
  { path: "/", label: "Início", end: true },
  { path: "/esportes", label: "Futebol" },
  { path: "/competicoes", label: "Competições" },
  { path: "/minhas-simulacoes", label: "Minhas apostas" },
  { path: "/indique-e-ganhe", label: "Indique e ganhe" },
];

export default function TopBar() {
  const settings = useAppSettings();
  const { user, isAuthenticated } = useAuth();
  const { balance } = useWallet();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [term, setTerm] = useState("");

  const submit = (event) => {
    event.preventDefault();
    navigate(term.trim() ? `/busca?q=${encodeURIComponent(term.trim())}` : "/busca");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1320px] items-center gap-2 px-3 md:h-16 md:px-6">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label={settings.brand_name}>
          <BrandMark className="h-8 w-8" />
          <span className="hidden font-display text-lg font-bold uppercase leading-none tracking-tight sm:inline">
            {settings.brand_name}
          </span>
        </Link>

        <nav className="ml-5 hidden items-center gap-1 lg:flex" aria-label="Navegação principal">
          {LINKS.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              end={link.end}
              className={({ isActive }) =>
                `rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
          {user?.role === "admin" && (
            <NavLink
              to="/admin"
              className="rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Admin
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <form className="relative hidden md:block" onSubmit={submit}>
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Buscar time"
              aria-label="Buscar time ou competição"
              className="h-9 w-48 rounded-full border-border/70 bg-secondary/70 pl-9 text-sm lg:w-56"
            />
          </form>

          <Link
            to="/busca"
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
            aria-label="Buscar"
          >
            <Search className="h-5 w-5" />
          </Link>

          {isAuthenticated ? (
            <>
              <Link
                to="/carteira"
                className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
                aria-label="Saldo disponível na carteira"
              >
                <WalletIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="score-num">{formatCurrency(balance)}</span>
              </Link>
              <UserMenu />
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/60 sm:block"
              >
                Entrar
              </Link>
              <Link
                to="/register"
                className="rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Cadastrar
              </Link>
            </>
          )}
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
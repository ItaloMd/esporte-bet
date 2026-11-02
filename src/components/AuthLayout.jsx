import React from "react";
import { Link } from "react-router-dom";
import BrandMark from "@/components/brand/BrandMark";
import AuthHero from "@/components/auth/AuthHero";
import { useAppSettings } from "@/lib/appSettings";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  const settings = useAppSettings();

  return (
    <div className="min-h-screen bg-background lg:grid lg:min-h-screen lg:grid-cols-[1.05fr_minmax(430px,0.95fr)]">
      <AuthHero brandName={settings.brand_name} tagline={settings.tagline} />

      <main className="flex flex-col justify-center px-4 py-8 sm:px-8 lg:px-10 lg:py-14">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-6 flex items-center gap-2 lg:hidden" aria-label={settings.brand_name}>
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-base font-semibold uppercase tracking-tight">
              {settings.brand_name}
            </span>
          </Link>

          <div className="rounded-2xl border border-border/80 bg-card/80 p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              {Icon && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <div>
                <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-tight">{title}</h2>
                {subtitle && <p className="mt-1.5 text-xs text-muted-foreground">{subtitle}</p>}
              </div>
            </div>
            {children}
          </div>

          {footer && <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>}

          <div className="mt-6 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/60">
            <Link to="/termos" className="hover:text-primary">Termos</Link>
            <span aria-hidden="true">·</span>
            <Link to="/privacidade" className="hover:text-primary">Privacidade</Link>
            <span aria-hidden="true">·</span>
            <span>+18</span>
          </div>
        </div>
      </main>
    </div>
  );
}
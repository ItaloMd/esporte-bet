import React from "react";
import { DEFAULT_TERMS, DEFAULT_PRIVACY } from "@/lib/legalDefaults";
import { useAppSettings } from "@/lib/appSettings";

function LegalPage({ title, field, fallback }) {
  const settings = useAppSettings();
  const text = settings[field] || fallback;

  return (
    <article className="space-y-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="card-surface px-4 py-4">
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">{text}</p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Texto institucional editável pelo administrador no painel administrativo. Deve passar por revisão jurídica.
      </p>
    </article>
  );
}

export function Terms() {
  return <LegalPage title="Termos de uso" field="terms_text" fallback={DEFAULT_TERMS} />;
}

export function Privacy() {
  return <LegalPage title="Política de privacidade" field="privacy_text" fallback={DEFAULT_PRIVACY} />;
}
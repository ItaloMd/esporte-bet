import React, { useState } from "react";
import { Copy, Link2 } from "lucide-react";

const ENDPOINTS = [
  { label: "Consulta de saldo", path: "/functions/gscBalance" },
  { label: "Débito e crédito", path: "/functions/gscWallet" },
  { label: "Histórico de apostas", path: "/functions/gscBetHistory" },
  { label: "Rodadas grátis", path: "/functions/gscFreeRounds" },
];

export default function GscCallbacksCard() {
  const [copied, setCopied] = useState("");
  const base = window.location.origin;

  const copy = async (url) => {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <section className="card-surface space-y-2 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Link2 className="h-4 w-4 text-primary" aria-hidden="true" /> URLs para registrar na GamingSoft
      </h2>
      <p className="text-[11px] text-muted-foreground">
        Envie estas rotas ao provedor. Elas validam a assinatura, o horário e a identidade do jogador antes de mover
        saldo, e cada operação usa o identificador da rodada para não duplicar transações.
      </p>
      <ul className="space-y-1.5">
        {ENDPOINTS.map((endpoint) => {
          const url = `${base}${endpoint.path}`;
          return (
            <li
              key={endpoint.path}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">{endpoint.label}</p>
                <p className="truncate font-mono text-[11px]">{url}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(url)}
                className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Copiar ${endpoint.label}`}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        {copied ? "Link copiado." : "As rotas respondem quando a integração de servidor estiver ativa."}
      </p>
    </section>
  );
}
import React from "react";
import { Loader2, Timer } from "lucide-react";

/** Linha de progresso do ciclo: etapa em execução e espera com contagem regressiva. */
export default function StepProgress({ step, waitSeconds }) {
  if (!step && !waitSeconds) return null;
  const waiting = Boolean(waitSeconds);
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      {waiting ? <Timer className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {waiting
        ? `Espera de ${waitSeconds}s para proteger o limite por minuto · ${step}`
        : `Executando em etapas: ${step}`}
    </p>
  );
}
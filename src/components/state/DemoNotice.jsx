import React from "react";
import { Info } from "lucide-react";

export default function DemoNotice({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p>
        {children ||
          "Modo demonstrativo: os eventos e odds exibidos são dados de simulação, apenas para testar a plataforma. Nenhuma aposta com dinheiro real é possível."}
      </p>
    </div>
  );
}
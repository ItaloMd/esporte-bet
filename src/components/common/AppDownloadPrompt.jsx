import React, { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "app_download_prompt_dismissed";

/**
 * Popup que convida o jogador a baixar o aplicativo: usa o instalador nativo
 * do navegador (PWA) quando disponível e guarda a escolha no dispositivo.
 */
export default function AppDownloadPrompt() {
  const [open, setOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return undefined;
    } catch {
      return undefined;
    }
    const timer = setTimeout(() => setOpen(true), 1500);
    const onPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // armazenamento indisponível — apenas fecha
    }
  };

  const install = async () => {
    if (installEvent) {
      installEvent.prompt();
    }
    close();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-w-sm">
      <div className="card-surface flex items-start gap-3 border-primary/40 p-4 shadow-lg">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <Smartphone className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Baixe o nosso aplicativo</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Acompanhe as partidas, os palpites e a sua carteira direto do celular, com a experiência completa do app.
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={install}>Instalar agora</Button>
            <Button size="sm" variant="ghost" onClick={close}>Agora não</Button>
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Fechar aviso do aplicativo"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
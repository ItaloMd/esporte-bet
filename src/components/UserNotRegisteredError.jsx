import React from 'react';
import { AlertTriangle } from 'lucide-react';
import BrandMark from '@/components/brand/BrandMark';
import { useAppSettings } from '@/lib/appSettings';

const UserNotRegisteredError = () => {
  const settings = useAppSettings();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="panel w-full max-w-md p-7">
        <div className="mb-5 flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-lg font-bold uppercase tracking-tight">{settings.brand_name}</span>
        </div>

        <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-2xl font-bold uppercase tracking-tight">Acesso restrito</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Esta conta não está registrada na plataforma. Fale com o administrador para liberar o acesso.
        </p>
        <div className="mt-4 rounded-md border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">Se acredita que é um engano:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>Confirme se está conectado com a conta correta</li>
            <li>Peça a liberação ao administrador da plataforma</li>
            <li>Tente sair e entrar novamente</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
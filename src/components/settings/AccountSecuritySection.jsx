import React, { useState } from "react";
import { Bell, LogOut, Monitor, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/AuthContext";
import { useAppSettings } from "@/lib/appSettings";

export default function AccountSecuritySection({ profile }) {
  const { user, logout } = useAuth();
  const settings = useAppSettings();
  const [sending, setSending] = useState(false);

  const requestPasswordChange = async () => {
    if (!user?.email) return;
    setSending(true);
    try {
      await base44.auth.resetPasswordRequest(user.email);
      toast({
        title: "Enviamos um link de redefinição",
        description: "Confira seu e-mail para criar uma nova senha com segurança.",
      });
    } catch {
      toast({
        title: "Link enviado",
        description: "Se o e-mail estiver cadastrado, você receberá as instruções de redefinição.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <section className="card-surface space-y-2 p-4">
        <h2 className="text-sm font-semibold">Conta</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Nome completo</p>
            <p>{profile?.full_name || user?.full_name || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">E-mail da conta</p>
            <p className="truncate">{user?.email}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">CPF</p>
            <p>{profile?.cpf_masked || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Conta criada em</p>
            <p>{profile ? formatDateTime(profile.created_date) : "—"}</p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Preferências de exibição: tema escuro fixo, com a cor de destaque definida pela administração (
          <span className="font-mono">{settings.accent_color}</span>). Alterações de nome de exibição ficam em{" "}
          <Link to="/perfil" className="text-primary hover:underline">Meu perfil</Link>.
        </p>
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Segurança</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={requestPasswordChange} disabled={sending}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Alterar senha por link seguro
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => logout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Encerrar esta sessão
          </Button>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="flex items-center gap-2 text-xs font-medium">
            <Monitor className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Sessão ativa deste dispositivo
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{navigator.userAgent}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            O encerramento de sessão invalida o acesso neste navegador. Senhas são armazenadas de forma criptografada
            pela plataforma de autenticação, nunca em texto puro.
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Bell className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Histórico de acessos relevantes
          </p>
          <p className="mt-1">
            A plataforma registra autenticações e ações administrativas sensíveis em logs protegidos. O administrador
            consulta esses registros no painel administrativo; nesta fase, não há lista de sessões expiradas para o
            jogador.
          </p>
        </div>
      </section>
    </>
  );
}
import React from "react";
import { Link } from "react-router-dom";
import { Bell, Gift, LogOut, Settings as SettingsIcon, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import ProfileSetupForm from "@/components/profile/ProfileSetupForm";
import { formatNumber, formatDateTime } from "@/lib/format";
import useProfile from "@/lib/useProfile";
import { useAuth } from "@/lib/AuthContext";
import { sportName } from "@/lib/sports";
import { base44 } from "@/api/base44Client";
import { useEffect, useState } from "react";

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

export default function Profile() {
  const { user, logout, isAuthenticated } = useAuth();
  const { profile, loading, reload } = useProfile();
  const [stats, setStats] = useState({ tickets: 0, open: 0 });

  useEffect(() => {
    if (!user?.id) return;
    base44.entities.SimulationTicket.aggregate({ query: { user_id: user.id }, groupBy: "status" })
      .then((result) => {
        const rows = result.rows || [];
        setStats({
          tickets: rows.reduce((acc, row) => acc + row.count, 0),
          open: rows.find((row) => row.status === "open")?.count || 0,
        });
      })
      .catch(() => setStats({ tickets: 0, open: 0 }));
  }, [user?.id]);

  if (!isAuthenticated) {
    return (
      <div className="card-surface px-4 py-10 text-center">
        <p className="font-medium">Entre na sua conta para ver seu perfil</p>
        <Button className="mt-3" asChild>
          <Link to="/register">Criar conta</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return <div className="card-surface h-48 animate-pulse" />;
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Meu perfil</h1>
          <p className="text-xs text-muted-foreground">
            Sua conta existe, mas os dados cadastrais ainda não foram concluídos.
          </p>
        </header>
        <ProfileSetupForm defaultName={user?.full_name || ""} defaultEmail={user?.email || ""} onDone={() => reload()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="card-surface flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div>
          <h1 className="text-xl font-semibold">{profile.display_name || profile.full_name}</h1>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="score-num text-xl font-semibold">{formatNumber(stats.tickets)}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">simulações</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="score-num text-xl font-semibold">{formatNumber(stats.open)}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">em aberto</p>
          </div>
        </div>
      </header>

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Dados cadastrais protegidos</h2>
        <div className="mt-2">
          <InfoRow label="Nome completo" value={profile.full_name} />
          <InfoRow label="CPF" value={profile.cpf_masked} />
          <InfoRow label="Data de nascimento" value={profile.birth_date} />
          <InfoRow label="Estado" value={profile.state} />
          <InfoRow label="Conta criada em" value={formatDateTime(profile.created_date)} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          O CPF completo não é exibido nesta tela nem em relatórios comuns. Correções cadastrais passam por solicitação
          em Configurações › Privacidade.
        </p>
      </section>

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Preferências esportivas</h2>
        <div className="mt-2">
          <InfoRow
            label="Esportes favoritos"
            value={(profile.favorite_sports || []).map((slug) => sportName(slug)).join(", ") || "Nenhum selecionado"}
          />
          <InfoRow label="Equipes favoritas" value={(profile.favorite_teams || []).join(", ")} />
          <InfoRow
            label="Competições favoritas"
            value={`${(profile.favorite_competitions || []).length} selecionada(s)`}
          />
        </div>
        <Button variant="outline" size="sm" className="mt-3" asChild>
          <Link to="/configuracoes">
            <SettingsIcon className="mr-2 h-3.5 w-3.5" /> Editar preferências
          </Link>
        </Button>
      </section>

      <section className="grid gap-2 sm:grid-cols-3">
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/minhas-simulacoes">
            <Ticket className="mr-2 h-4 w-4" /> Minhas simulações
          </Link>
        </Button>
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/indique-e-ganhe">
            <Gift className="mr-2 h-4 w-4" /> Programa de afiliados
          </Link>
        </Button>
        <Button variant="outline" className="justify-start" asChild>
          <Link to="/configuracoes">
            <Bell className="mr-2 h-4 w-4" /> Notificações e privacidade
          </Link>
        </Button>
      </section>

      <Button variant="outline" className="text-destructive" onClick={() => logout()}>
        <LogOut className="mr-2 h-4 w-4" /> Encerrar sessão
      </Button>
    </div>
  );
}
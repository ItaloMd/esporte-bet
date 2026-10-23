import React from "react";
import { Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import AccountSecuritySection from "@/components/settings/AccountSecuritySection";
import SportsPreferences from "@/components/settings/SportsPreferences";
import NotificationsSection from "@/components/settings/NotificationsSection";
import PrivacySection from "@/components/settings/PrivacySection";
import ProfileSetupForm from "@/components/profile/ProfileSetupForm";
import useProfile from "@/lib/useProfile";
import { useAuth } from "@/lib/AuthContext";

export default function SettingsPage() {
  const { user, isAuthenticated } = useAuth();
  const { profile, loading, reload } = useProfile();

  if (!isAuthenticated) {
    return (
      <div className="card-surface px-4 py-10 text-center">
        <SettingsIcon className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
        <p className="mt-2 font-medium">Entre na sua conta para acessar as configurações</p>
        <Button className="mt-3" asChild>
          <Link to="/register">Criar conta</Link>
        </Button>
      </div>
    );
  }

  if (loading) return <div className="card-surface h-48 animate-pulse" />;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card">
          <SettingsIcon className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Configurações</h1>
          <p className="text-xs text-muted-foreground">Conta, segurança, preferências, privacidade e notificações</p>
        </div>
      </header>

      {!profile ? (
        <ProfileSetupForm defaultName={user?.full_name || ""} defaultEmail={user?.email || ""} onDone={() => reload()} />
      ) : (
        <>
          <AccountSecuritySection profile={profile} />
          <SportsPreferences profile={profile} onSaved={reload} />
          <NotificationsSection userId={user.id} />
          <PrivacySection userId={user.id} profile={profile} />
        </>
      )}
    </div>
  );
}
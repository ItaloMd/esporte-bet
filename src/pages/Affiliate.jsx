import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Gift, Link2, Percent, Share2, ShieldCheck, UserPlus, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime, formatNumber } from "@/lib/format";
import useProfile from "@/lib/useProfile";
import { useAppSettings } from "@/lib/appSettings";
import { useAuth } from "@/lib/AuthContext";

const REFERRAL_STATUS = {
  pending: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Recusada",
  fraud: "Bloqueada por antifraude",
};

export default function Affiliate() {
  const { user, isAuthenticated } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const settings = useAppSettings();
  const [state, setState] = useState({ loading: true, affiliate: null });
  const [counts, setCounts] = useState({ clicks: 0, referrals: 0, approved: 0 });
  const [referrals, setReferrals] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setState({ loading: false, affiliate: null });
      return;
    }
    let active = true;
    const load = async () => {
      setState({ loading: true, affiliate: null });
      const page = await base44.entities.AffiliateProfile.filter({ user_id: user.id }, { limit: 1 });
      const affiliate = page.items?.[0] || null;
      if (!active) return;
      setState({ loading: false, affiliate });
      if (!affiliate) return;
      const [clicks, refs, approved, history] = await Promise.all([
        base44.entities.AffiliateClick.count({ code: affiliate.code }),
        base44.entities.AffiliateReferral.count({ referrer_user_id: user.id }),
        base44.entities.AffiliateReferral.count({ referrer_user_id: user.id, status: "approved" }),
        base44.entities.AffiliateReferral.filter({ referrer_user_id: user.id }, { sort: "-created_date", limit: 20 }),
      ]);
      if (!active) return;
      setCounts({ clicks, referrals: refs, approved });
      setReferrals(history.items || []);
    };
    load().catch(() => setState({ loading: false, affiliate: null }));
    return () => {
      active = false;
    };
  }, [isAuthenticated, user?.id]);

  if (!isAuthenticated) {
    return (
      <div className="card-surface px-4 py-10 text-center">
        <Gift className="mx-auto h-7 w-7 text-primary" aria-hidden="true" />
        <p className="mt-2 font-medium">Entre na sua conta para acessar o programa de indicações</p>
        <Button className="mt-3" asChild>
          <Link to="/register">Criar conta</Link>
        </Button>
      </div>
    );
  }

  if (profileLoading || state.loading) {
    return <div className="card-surface h-48 animate-pulse" />;
  }

  if (!profile || !state.affiliate) {
    return (
      <div className="card-surface px-4 py-8 text-center">
        <p className="font-medium">Conclua seu cadastro para gerar seu código de indicação</p>
        <p className="mt-1 text-xs text-muted-foreground">
          O código é criado junto com o cadastro verificado por CPF, garantindo uma conta por pessoa.
        </p>
        <Button className="mt-3" asChild>
          <Link to="/perfil">Concluir cadastro</Link>
        </Button>
      </div>
    );
  }

  const affiliate = state.affiliate;
  const link = `${window.location.origin}/?ref=${affiliate.code}`;
  const conversionRate = counts.clicks ? (counts.approved / counts.clicks) * 100 : 0;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast({ title: "Link copiado", description: "Compartilhe com quem quer convidar." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Não foi possível copiar", description: link });
    }
  };

  const share = async () => {
    const text = `Estou usando o ${settings.brand_name} para acompanhar odds informativas e simulações esportivas. Entre pelo meu link: ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: settings.brand_name, text, url: link });
        return;
      } catch {
        /* usuário cancelou o compartilhamento */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/40 bg-primary/10">
          <Gift className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Indique e ganhe</h1>
          <p className="text-xs text-muted-foreground">Painel individual do programa de indicações</p>
        </div>
      </header>

      <section className="card-surface space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Seu código</p>
            <p className="score-num text-2xl font-semibold tracking-wider text-primary">{affiliate.code}</p>
          </div>
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            {affiliate.status === "active" ? "Programa ativo" : affiliate.status === "pending" ? "Aguardando aprovação" : "Indicador bloqueado"}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-xs text-muted-foreground">{link}</span>
          </div>
          <Button onClick={copyLink} className="sm:w-auto">
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            Copiar link
          </Button>
          <Button variant="outline" onClick={share}>
            <Share2 className="mr-2 h-4 w-4" />
            Compartilhar
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Cada visita válida é contada uma vez por sessão de navegação. Autorreferências e cadastros duplicados são
          recusados automaticamente.
        </p>
      </section>

      <section className="grid gap-2 sm:grid-cols-4">
        {[
          { icon: Link2, label: "Cliques válidos", value: counts.clicks },
          { icon: UserPlus, label: "Cadastros atribuídos", value: counts.referrals },
          { icon: Users, label: "Indicações aprovadas", value: counts.approved },
          { icon: Percent, label: "Taxa de conversão", value: `${conversionRate.toFixed(1)}%` },
        ].map((item) => (
          <div key={item.label} className="card-surface px-4 py-3">
            <item.icon className="h-4 w-4 text-primary" aria-hidden="true" />
            <p className="score-num mt-2 text-2xl font-semibold">
              {typeof item.value === "number" ? formatNumber(item.value) : item.value}
            </p>
            <p className="text-[11px] text-muted-foreground">{item.label}</p>
          </div>
        ))}
      </section>

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Regras do programa</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>• Janela de atribuição: {formatNumber(settings.affiliate_attribution_days || 30)} dias após o clique.</li>
          <li>• Limite de indicações por conta: {formatNumber(settings.affiliate_max_referrals || 50)}.</li>
          <li>• Aprovação das indicações: {settings.affiliate_approval_required === false ? "automática" : "manual, pelo administrador"}.</li>
          <li>• Política de comissões: {settings.affiliate_commission_rule || "recompensas demonstrativas, sujeitas a validação jurídica."}</li>
          <li>• Não é permitido indicar menores de 18 anos nem usar o programa para incentivar apostas.</li>
        </ul>
        <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90">
          Fase de protótipo: as recompensas são apenas demonstrativas. Não há pagamento, crédito ou conversão em
          dinheiro, e nenhuma comissão é paga nesta etapa.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Histórico de indicações</h2>
        {referrals.length ? (
          referrals.map((referral) => (
            <div
              key={referral.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{referral.referred_label || "Cadastro atribuído"}</p>
                <p className="text-muted-foreground">
                  {formatDateTime(referral.created_date)} · origem: {referral.source === "link" ? "link de indicação" : referral.source}
                </p>
              </div>
              <span className="shrink-0 text-muted-foreground">
                {REFERRAL_STATUS[referral.status] || referral.status}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma indicação registrada ainda.</p>
        )}
      </section>

      {user?.role === "admin" && (
        <Button variant="outline" asChild>
          <Link to="/admin">
            <ShieldCheck className="mr-2 h-4 w-4" /> Painel administrativo do programa
          </Link>
        </Button>
      )}
    </div>
  );
}
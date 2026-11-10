import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Gamepad2, KeyRound } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import GscConnectionForm from "@/components/admin/gsc/GscConnectionForm";
import GscCallbacksCard from "@/components/admin/gsc/GscCallbacksCard";
import GscCatalogPanel from "@/components/admin/gsc/GscCatalogPanel";
import GscReconciliationPanel from "@/components/admin/gsc/GscReconciliationPanel";

function Pill({ ok, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        ok ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export default function AdminGsc() {
  const { toast } = useToast();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await base44.entities.GscSettings.list({ sort: "-created_date", limit: 1 });
    setSettings((result.items || [])[0] || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const save = async (patch) => {
    setSaving(true);
    try {
      const saved = settings
        ? await base44.entities.GscSettings.update(settings.id, patch)
        : await base44.entities.GscSettings.create(patch);
      setSettings(saved);
      toast({ title: "Configuração salva" });
    } catch (err) {
      toast({ variant: "destructive", title: "Não foi possível salvar", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card-surface h-64 animate-pulse" />;

  return (
    <div className="space-y-4">
      <section className="card-surface space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Gamepad2 className="h-4 w-4 text-primary" aria-hidden="true" /> Conexão GSC+
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <Pill ok={Boolean(settings?.enabled)}>{settings?.enabled ? "ligada" : "desligada"}</Pill>
            <Pill ok={Boolean(settings?.secret_configured)}>chave secreta</Pill>
            <Pill ok={settings?.environment === "production"}>
              {settings?.environment === "production" ? "produção" : "staging"}
            </Pill>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          A GSC+ conecta o lobby de jogos à carteira do jogador. Toda chamada ao provedor é feita pelo servidor, com
          assinatura validada, moeda conferida e cada rodada registrada uma única vez.
        </p>
        {settings?.last_error && <p className="text-[11px] text-destructive">Último erro: {settings.last_error}</p>}
      </section>

      <GscConnectionForm settings={settings} saving={saving} onSave={save} />

      <section className="card-surface space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" /> Chave secreta
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Cadastre a chave secreta do operador na página Secrets com o nome{" "}
          <span className="font-mono text-foreground">{settings?.secret_name || "GSC_SECRET_KEY"}</span>. Ela fica
          disponível apenas para o servidor e nunca é gravada no banco nem enviada ao navegador.
        </p>
        <p className="text-[11px] text-muted-foreground">
          As rotas de carteira e de lançamento dependem da integração de servidor ativa. Enquanto ela não estiver
          habilitada no plano do workspace, o painel guarda a configuração e o catálogo, mas nenhuma operação de saldo
          real acontece.
        </p>
      </section>

      <GscCallbacksCard />
      <GscCatalogPanel />
      <GscReconciliationPanel />
    </div>
  );
}
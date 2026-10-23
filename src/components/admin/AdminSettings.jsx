import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { logAdminAction } from "@/lib/adminAudit";
import { setLocalSettings } from "@/lib/appSettings";

const EMPTY = {
  brand_name: "Placar",
  tagline: "",
  accent_color: "#FF2222",
  logo_url: "",
  favicon_url: "",
  support_email: "",
  demo_mode: true,
  min_age: 18,
  responsible_gaming_text: "",
  terms_text: "",
  privacy_text: "",
  affiliate_enabled: true,
  affiliate_attribution_days: 30,
  affiliate_max_referrals: 50,
  affiliate_approval_required: true,
  affiliate_commission_rule: "",
};

export default function AdminSettings({ actor }) {
  const [settings, setSettings] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const page = await base44.entities.AppSettings.list({ limit: 1 });
    const existing = page.items?.[0] || null;
    setRecordId(existing?.id || null);
    setSettings(existing ? { ...EMPTY, ...existing } : { ...EMPTY });
  };

  useEffect(() => {
    load().catch(() => setSettings({ ...EMPTY }));
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...settings };
      ["id", "created_date", "updated_date", "created_by_id"].forEach((key) => delete payload[key]);
      if (recordId) await base44.entities.AppSettings.update(recordId, payload);
      else {
        const created = await base44.entities.AppSettings.create(payload);
        setRecordId(created.id);
      }
      setLocalSettings(payload);
      await logAdminAction({
        actor,
        action: "app_settings.updated",
        targetType: "AppSettings",
        targetId: recordId || "novo",
        details: `Identidade visual e textos institucionais atualizados (${payload.brand_name}).`,
        severity: "warning",
      });
      toast({ title: "Identidade e textos atualizados" });
      load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-4 p-4">
        <h2 className="text-sm font-semibold">Identidade visual do site</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="brand_name">Nome da plataforma</Label>
            <Input id="brand_name" value={settings.brand_name} onChange={(event) => update({ brand_name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tagline">Slogan</Label>
            <Input id="tagline" value={settings.tagline} onChange={(event) => update({ tagline: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accent_color">Cor de destaque</Label>
            <div className="flex items-center gap-2">
              <input
                id="accent_color"
                type="color"
                value={settings.accent_color}
                onChange={(event) => update({ accent_color: event.target.value })}
                className="h-10 w-14 rounded-lg border border-border bg-transparent"
              />
              <Input value={settings.accent_color} onChange={(event) => update({ accent_color: event.target.value })} className="font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="support_email">E-mail de contato institucional</Label>
            <Input id="support_email" value={settings.support_email} onChange={(event) => update({ support_email: event.target.value })} placeholder="contato@seudominio.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo_url">URL do logotipo (opcional)</Label>
            <Input id="logo_url" value={settings.logo_url} onChange={(event) => update({ logo_url: event.target.value })} placeholder="https://…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="favicon_url">URL do favicon (opcional)</Label>
            <Input id="favicon_url" value={settings.favicon_url} onChange={(event) => update({ favicon_url: event.target.value })} placeholder="https://…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="min_age">Idade mínima</Label>
            <Input id="min_age" type="number" value={settings.min_age} onChange={(event) => update({ min_age: Number(event.target.value) })} />
          </div>
          <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border px-3 py-2 text-sm">
            Modo demonstrativo visível no site
            <Switch checked={Boolean(settings.demo_mode)} onCheckedChange={(value) => update({ demo_mode: value })} />
          </label>
        </div>
      </section>

      <section className="card-surface space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Programa de indicações</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Camada de regras configurável. Nenhum pagamento de comissão é executado nesta fase.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="attribution">Janela de atribuição (dias)</Label>
            <Input id="attribution" type="number" value={settings.affiliate_attribution_days} onChange={(event) => update({ affiliate_attribution_days: Number(event.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_referrals">Limite de indicações por conta</Label>
            <Input id="max_referrals" type="number" value={settings.affiliate_max_referrals} onChange={(event) => update({ affiliate_max_referrals: Number(event.target.value) })} />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Programa habilitado
            <Switch checked={Boolean(settings.affiliate_enabled)} onCheckedChange={(value) => update({ affiliate_enabled: value })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Aprovação manual das indicações
            <Switch checked={Boolean(settings.affiliate_approval_required)} onCheckedChange={(value) => update({ affiliate_approval_required: value })} />
          </label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission_rule">Política de comissões (texto demonstrativo)</Label>
          <Input id="commission_rule" value={settings.affiliate_commission_rule} onChange={(event) => update({ affiliate_commission_rule: event.target.value })} placeholder="Sujeita a validação jurídica" />
        </div>
      </section>

      <section className="card-surface space-y-4 p-4">
        <h2 className="text-sm font-semibold">Textos institucionais</h2>
        <div className="space-y-2">
          <Label htmlFor="responsible">Aviso de jogo responsável</Label>
          <Input id="responsible" value={settings.responsible_gaming_text} onChange={(event) => update({ responsible_gaming_text: event.target.value })} placeholder="Plataforma de simulação, sem apostas com dinheiro real." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="terms">Termos de uso</Label>
          <Textarea id="terms" rows={8} value={settings.terms_text} onChange={(event) => update({ terms_text: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="privacy">Política de privacidade</Label>
          <Textarea id="privacy" rows={8} value={settings.privacy_text} onChange={(event) => update({ privacy_text: event.target.value })} />
        </div>
      </section>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Salvar identidade e textos
      </Button>
    </div>
  );
}
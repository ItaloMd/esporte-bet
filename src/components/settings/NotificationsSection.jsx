import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";

const OPTIONS = [
  { key: "favorite_results", label: "Resultados de partidas favoritas" },
  { key: "event_start", label: "Início de eventos acompanhados" },
  { key: "odds_updates", label: "Alertas de atualização de odds" },
  { key: "product_news", label: "Novidades e comunicados da plataforma" },
  { key: "channel_email", label: "Receber por e-mail" },
  { key: "channel_push", label: "Receber no celular (push), quando disponível" },
];

export default function NotificationsSection({ userId }) {
  const [preference, setPreference] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    base44.entities.NotificationPreference.filter({ user_id: userId }, { limit: 1 })
      .then(async (page) => {
        if (!active) return;
        const existing = page.items?.[0];
        if (existing) setPreference(existing);
        else {
          const created = await base44.entities.NotificationPreference.create({ user_id: userId });
          if (active) setPreference(created);
        }
      })
      .catch(() => active && setPreference(null));
    return () => {
      active = false;
    };
  }, [userId]);

  const update = async (key, value) => {
    if (!preference) return;
    const next = { ...preference, [key]: value };
    setPreference(next);
    setSaving(true);
    try {
      await base44.entities.NotificationPreference.update(preference.id, { [key]: value });
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-surface space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Notificações</h2>
          <p className="mt-1 text-xs text-muted-foreground">Escolha o que você quer receber e por qual canal.</p>
        </div>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {preference ? (
        <div className="space-y-1">
          {OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center justify-between gap-3 rounded-lg px-1 py-2">
              <span className="text-sm">{option.label}</span>
              <Switch
                checked={Boolean(preference[option.key])}
                onCheckedChange={(value) => update(option.key, value)}
                aria-label={option.label}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Carregando preferências…</p>
      )}
    </section>
  );
}
import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import AdminProviderStats from "@/components/admin/AdminProviderStats";
import AdminQuotes from "@/components/admin/AdminQuotes";
import { logAdminAction } from "@/lib/adminAudit";
import { formatDateTime, timeAgo } from "@/lib/format";

/**
 * Margem da casa e cotações.
 *
 * As cotações vêm da API-Football: a chave fica como segredo do backend e o
 * navegador nunca fala com a fonte. Aqui ficam apenas a margem aplicada sobre
 * as odds originais e o diagnóstico da última execução.
 */
export default function AdminProvider({ actor }) {
  const [settings, setSettings] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [page, jobPage] = await Promise.all([
      base44.entities.ProviderSettings.list({ limit: 1 }),
      base44.entities.SyncJob.filter({ provider: "api_football" }, { sort: "-created_date", limit: 6 }),
    ]);
    const existing = page.items?.[0] || null;
    setRecordId(existing?.id || null);
    setSettings(existing || { house_margin_percent: 20 });
    setJobs(jobPage.items || []);
  };

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const save = async () => {
    const margin = Number(settings.house_margin_percent);
    if (!Number.isFinite(margin) || margin < 0 || margin > 50) {
      toast({ title: "A margem da casa deve ficar entre 0% e 50%", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const patch = { house_margin_percent: margin, house_margin_version: "v1" };
      if (recordId) await base44.entities.ProviderSettings.update(recordId, patch);
      else {
        const created = await base44.entities.ProviderSettings.create({ provider: "api_football", ...patch });
        setRecordId(created.id);
      }
      await logAdminAction({
        actor,
        action: "provider.margin_updated",
        targetType: "ProviderSettings",
        targetId: recordId || "novo",
        details: `Margem da casa em ${margin}%`,
        severity: "warning",
      });
      // Reaplica a nova margem sobre as odds salvas na hora, sem esperar a próxima coleta.
      const recalcResponse = await base44.functions.invoke("apiFootballCentral", { action: "recalc_margin" });
      const recalc = recalcResponse.data || {};
      if (recalc.error) {
        toast({ title: "Margem salva", description: `Não foi possível reaplicar sobre as odds salvas: ${recalc.error}` });
      } else {
        toast({
          title: "Margem salva e reaplicada",
          description: `${recalc.updated ?? 0} cotação(ões) atualizadas com a margem de ${margin}%.`,
        });
      }
      await load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="card-surface h-40 animate-pulse" />;

  const oddsJob = jobs.find((job) => job.job_type === "odds") || null;
  const failures = jobs.filter((job) => job.status === "error");

  return (
    <div className="space-y-5">
      <AdminProviderStats actor={actor} />

      <section className="card-surface space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Margem da casa</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Aplicada sobre as odds originais de cada mercado completo, no momento em que as cotações são gravadas. Ao
            salvar, a nova margem é reaplicada na hora sobre todas as cotações já armazenadas.
            Apostas já confirmadas nunca são alteradas, e uma seleção sem preço válido fica suspensa em vez de ser
            oferecida.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="house_margin">Margem aplicada (%)</Label>
            <Input
              id="house_margin"
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={settings.house_margin_percent ?? 20}
              onChange={(event) => update({ house_margin_percent: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>Cotações</Label>
            <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              Coletadas pela API-Football, uma vez por hora para os jogos de hoje e de amanhã.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar margem
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Última alteração: {settings.updated_date ? formatDateTime(settings.updated_date) : "—"}
          </span>
        </div>
      </section>

      <AdminQuotes marginPercent={settings.house_margin_percent} />

      <section className="card-surface px-4 py-3">
        <h2 className="text-sm font-semibold">Diagnóstico</h2>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>• Provedor de dados e odds: API-Football</li>
          <li>
            • Integração: {settings.football_enabled ? "habilitada" : "desligada"} · plano{" "}
            {settings.football_plan || "não informado"}
          </li>
          <li>
            • Última coleta de odds: {oddsJob?.finished_at ? timeAgo(oddsJob.finished_at) : "nunca"} ·{" "}
            {oddsJob?.status || "—"}
          </li>
          <li>• Última liquidação: {settings.last_sync_at ? timeAgo(settings.last_sync_at) : "nunca"}</li>
          <li>• Falhas recentes: {failures.length}</li>
        </ul>
      </section>
    </div>
  );
}
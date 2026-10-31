import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, SearchCheck, Timer } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import CentralStatus from "@/components/admin/football/CentralStatus";
import CollectionControl from "@/components/admin/football/CollectionControl";
import ConsumptionSimulator from "@/components/admin/football/ConsumptionSimulator";
import OpsWidgets from "@/components/admin/football/OpsWidgets";
import ResultAuditMonitor from "@/components/admin/football/ResultAuditMonitor";
import ForecastPanel from "@/components/admin/football/ForecastPanel";
import CentralLogs from "@/components/admin/football/CentralLogs";
import EndpointConsumption from "@/components/admin/football/EndpointConsumption";
import ReviewQueue from "@/components/admin/football/ReviewQueue";

/**
 * Central API-Football: status da conta e do plano, simulador de consumo,
 * painel operacional, previsão, logs avançados e execução manual das rotinas
 * (detector ao vivo e ciclo completo de importação, auditoria, cotações e
 * liquidação).
 */
export default function FootballCentral() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", { action: "overview" });
      const payload = response.data || {};
      if (payload.error) {
        toast({ title: "Falha ao carregar a central", description: payload.error, variant: "destructive" });
        setData(null);
      } else {
        setData(payload);
      }
      const page = await base44.entities.ProviderSettings.list({ limit: 1 });
      setSettings(page.items?.[0] || null);
    } catch (error) {
      toast({ title: "Falha ao carregar a central", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveIntervals = async (patch) => {
    const response = await base44.functions.invoke("apiFootballCentral", { action: "update_settings", patch });
    const payload = response.data || {};
    if (payload.error) throw new Error(payload.error);
    return payload;
  };

  const invokeStep = async (name, args, label) => {
    const response = await base44.functions.invoke(name, args);
    const payload = response.data || {};
    if (payload.error) {
      toast({ title: "Falha na etapa", description: `${label}: ${payload.error}`, variant: "destructive" });
      return false;
    }
    toast({ title: label, description: payload.summary || payload.reason || "" });
    return true;
  };

  const runDetector = async () => {
    setRunning(true);
    try {
      await invokeStep("syncFootballLive", { trigger: "manual" }, "Detector ao vivo");
      await load();
    } finally {
      setRunning(false);
    }
  };

  const runCycle = async () => {
    setRunning(true);
    try {
      const steps = [
        ["syncFootball", { mode: "calendar", trigger: "manual" }, "Calendário importado"],
        ["syncFootballLive", { trigger: "manual" }, "Detector ao vivo"],
        ["auditarResultadosPendentes", { trigger: "manual" }, "Resultados pendentes"],
        ["syncFootballOdds", { mode: "auto", trigger: "manual" }, "Cotações atualizadas"],
        ["settleMatches", { trigger: "manual" }, "Bilhetes liquidados"],
      ];
      for (const [name, args, label] of steps) {
        const ok = await invokeStep(name, args, label);
        if (!ok) break;
      }
      await load();
    } finally {
      setRunning(false);
    }
  };

  /** Pausa/retomada global: gravada nas configurações e respeitada por todas as rotinas. */
  const togglePause = async () => {
    if (!settings?.id) return;
    const next = !settings.football_paused;
    setRunning(true);
    try {
      await base44.entities.ProviderSettings.update(settings.id, { football_paused: next });
      toast({
        title: next ? "Coleta pausada" : "Coleta retomada",
        description: next
          ? "Nenhuma rotina consulta a API-Football enquanto a pausa estiver ativa."
          : "As rotinas voltam a coletar no próximo ciclo.",
      });
      await load();
    } catch (error) {
      toast({ title: "Não foi possível alterar a coleta", description: error.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  /** Ativa a integração e executa a sincronização inicial na sequência. */
  const activateAndSync = async () => {
    setRunning(true);
    try {
      if (settings?.id) {
        await base44.entities.ProviderSettings.update(settings.id, { football_enabled: true, football_paused: false });
      }
      const steps = [
        ["syncFootball", { mode: "calendar", trigger: "manual" }, "Calendário importado"],
        ["syncFootballLive", { trigger: "manual" }, "Detector ao vivo"],
        ["syncFootballOdds", { mode: "auto", trigger: "manual" }, "Cotações atualizadas"],
      ];
      for (const [name, args, label] of steps) {
        const ok = await invokeStep(name, args, label);
        if (!ok) break;
      }
      await load();
    } catch (error) {
      toast({ title: "Falha ao ativar a integração", description: error.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Monitoramento da API-Football</h2>
          <p className="text-xs text-muted-foreground">
            Monitoramento ao vivo, auditoria de apostas, controle de consumo e previsão — dentro do limite do plano.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading || running}>
            {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Atualizar
          </Button>
          <Button size="sm" variant="outline" onClick={runDetector} disabled={running}>
            <Timer className="mr-2 h-3.5 w-3.5" />
            Detector agora
          </Button>
          <Button size="sm" onClick={runCycle} disabled={running}>
            <SearchCheck className="mr-2 h-3.5 w-3.5" />
            Ciclo completo
          </Button>
        </div>
      </div>

      <CollectionControl
        settings={settings}
        busy={running}
        onActivate={activateAndSync}
        onTogglePause={togglePause}
      />

      {!data ? (
        <div className="card-surface h-64 animate-pulse" />
      ) : (
        <>
          <CentralStatus data={data} />
          <EndpointConsumption connection={data.connection} />
          <OpsWidgets widgets={data.widgets} />
          <ResultAuditMonitor
            audit={data.result_audit}
            consumption={{ ...(data.consumption || {}), limit: data.plan?.internal_limit }}
          />
          <ReviewQueue />
          <ConsumptionSimulator
            monitor={data.monitor}
            planLimit={data.plan?.limit}
            settingsId={settings?.id || null}
            onSaved={saveIntervals}
          />
          <ForecastPanel forecast={data.forecast} history={data.history} />
          <CentralLogs />
        </>
      )}
    </div>
  );
}
import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Wifi } from "lucide-react";
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
import StepProgress from "@/components/admin/football/StepProgress";
import ManualActions from "@/components/admin/football/ManualActions";
import { classifyStep, nextStepWait, shouldHalt, waitWithCountdown } from "@/lib/smartStepDelay";

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
  const [step, setStep] = useState("");
  const [waitSeconds, setWaitSeconds] = useState(0);

  /**
   * Recarrega o painel. Por padrão usa apenas o estado já salvo — nenhuma
   * chamada à API-Football, nenhum efeito na janela de requisições. A consulta
   * de conta (/status) só acontece quando o administrador pede.
   */
  const load = useCallback(async ({ withStatus = false } = {}) => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("apiFootballCentral", {
        action: "overview",
        skip_status: !withStatus,
      });
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
    const startedAt = Date.now();
    const response = await base44.functions.invoke(name, args);
    const payload = response.data || {};
    const outcome = classifyStep(payload);
    if (payload.error) {
      toast({ title: "Falha na etapa", description: `${label}: ${payload.error}`, variant: "destructive" });
    } else {
      toast({ title: label, description: payload.summary || payload.reason || "" });
    }
    return { payload, outcome, elapsedMs: Date.now() - startedAt };
  };

  /**
   * Execução em etapas com espera adaptativa: o intervalo entre rotinas cresce
   * com o orçamento consumido e com sinais de limite do provedor, e encurta
   * quando a etapa anterior já demorou o suficiente para espaçar as chamadas.
   * Um limite sinalizado encerra o ciclo e deixa o restante para o próximo.
   */
  const runSteps = async (steps) => {
    setRunning(true);
    try {
      for (let index = 0; index < steps.length; index += 1) {
        const [name, args, label] = steps[index];
        setStep(`${index + 1}/${steps.length} · ${label}`);
        setWaitSeconds(0);
        const { payload, outcome, elapsedMs } = await invokeStep(name, args, label);
        if (outcome === "error") break;
        if (shouldHalt(payload)) {
          toast({
            title: "Ciclo interrompido",
            description: "O provedor sinalizou limite de consultas. As etapas restantes ficam para o próximo ciclo.",
            variant: "destructive",
          });
          break;
        }
        if (index === steps.length - 1) break;
        setStep(`${index + 2}/${steps.length} · ${steps[index + 1][2]}`);
        const waitMs = nextStepWait({ payload, outcome, elapsedMs });
        await waitWithCountdown(waitMs, (seconds) => setWaitSeconds(seconds));
      }
    } finally {
      setStep("");
      setWaitSeconds(0);
      setRunning(false);
      await load();
    }
  };

  /** Ação manual escolhida no painel: uma rotina específica ou o ciclo completo. */
  const runAction = (steps) => runSteps(steps);

  /** Consulta a conta no provedor: única ação do painel que chama /status. */
  const checkAccount = async () => {
    setRunning(true);
    try {
      await load({ withStatus: true });
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

  /** Ativa a integração e executa a coleta inicial em etapas espaçadas. */
  const activateAndSync = async () => {
    try {
      if (settings?.id) {
        await base44.entities.ProviderSettings.update(settings.id, { football_enabled: true, football_paused: false });
      }
    } catch (error) {
      toast({ title: "Falha ao ativar a integração", description: error.message, variant: "destructive" });
      return;
    }
    await runSteps([
      ["syncFootball", { mode: "calendar", trigger: "manual" }, "Calendário importado"],
      ["syncFootballOdds", { mode: "auto", trigger: "manual", force: true }, "Cotações atualizadas"],
      ["syncFootballLive", { trigger: "manual" }, "Detector ao vivo"],
    ]);
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
          <Button size="sm" variant="outline" onClick={() => load()} disabled={loading || running}>
            {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Atualizar painel
          </Button>
          <Button size="sm" variant="outline" onClick={checkAccount} disabled={loading || running}>
            <Wifi className="mr-2 h-3.5 w-3.5" />
            Consultar conta
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Atualizar painel recarrega apenas os dados já salvos, sem chamar a API-Football. Consultar conta é a única ação
        que fala com o provedor aqui — não consome cota diária, mas ocupa a janela de requisições do minuto.
      </p>
      <StepProgress step={step} waitSeconds={waitSeconds} />

      <CollectionControl
        settings={settings}
        busy={running}
        onActivate={activateAndSync}
        onTogglePause={togglePause}
      />

      <ManualActions busy={running} onRun={runAction} />

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
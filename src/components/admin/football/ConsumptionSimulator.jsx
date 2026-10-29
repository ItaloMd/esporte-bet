import React, { useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { SIM_DEFAULTS, simulateConsumption } from "@/lib/consumptionSim";

const FIELDS = [
  { key: "liveIntervalMinutes", label: "Intervalo detector ao vivo (min)", hint: "Cadência do GET /fixtures?live=all. O agendamento mínimo da plataforma é de 5 min." },
  { key: "monitorDefaultMinutes", label: "Monitoramento padrão (min)", hint: "Fila de jogos sem apostas. Padrão 5 min." },
  { key: "monitorBetsMinutes", label: "Monitoramento apostas (min)", hint: "Jogos com apostas registradas. Padrão 1 min." },
  { key: "monitorFavoritesMinutes", label: "Monitoramento favoritos (min)", hint: "Jogos favoritados por usuários. Padrão 1 min." },
  { key: "monitorCriticalMinutes", label: "Monitoramento crítico (min)", hint: "Jogos nos minutos finais. Padrão 0,5 min (30s)." },
  { key: "criticalFromMinute", label: "Minuto inicial da situação crítica", hint: "A partir desse minuto o jogo entra na prioridade 4. Padrão 80." },
  { key: "gamesPerDay", label: "Jogos médios por dia", hint: "Quantidade de partidas monitoradas por dia." },
  { key: "liveSimultaneous", label: "Jogos ao vivo simultâneos", hint: "Média de partidas em andamento ao mesmo tempo." },
  { key: "betGames", label: "Jogos monitorados por apostas", hint: "Partidas com apostas: recebem auditoria com estatísticas." },
  { key: "favoriteGames", label: "Jogos favoritados", hint: "Prioridade 3 na fila (cobertos pelo detector global)." },
  { key: "calendarDays", label: "Dias importados por dia", hint: "Carga diária: hoje, amanhã e próximos dias. Padrão 5." },
  { key: "oddsCallsPerDay", label: "Chamadas de odds por dia", hint: "Coletas por hora × dias × páginas. Padrão 96." },
  { key: "planLimit", label: "Limite do plano (requisições/dia)", hint: "Limite diário contratado na API-Football." },
];

const INTERVAL_KEYS = [
  ["football_live_interval_minutes", "liveIntervalMinutes"],
  ["football_monitor_default_minutes", "monitorDefaultMinutes"],
  ["football_monitor_bets_minutes", "monitorBetsMinutes"],
  ["football_monitor_favorites_minutes", "monitorFavoritesMinutes"],
  ["football_monitor_critical_minutes", "monitorCriticalMinutes"],
  ["football_critical_from_minute", "criticalFromMinute"],
];

const RISK_LABEL = {
  low: "Risco baixo",
  medium: "Atenção",
  high: "Risco alto",
  critical: "Risco crítico",
};

const RISK_TONE = {
  low: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
  medium: "border-amber-500/50 bg-amber-500/10 text-amber-400",
  high: "border-orange-500/50 bg-orange-500/10 text-orange-400",
  critical: "border-red-500/50 bg-red-500/10 text-red-400",
};

/** Módulo 2: simulador de consumo em tempo real, com gráfico e salvamento dos intervalos. */
export default function ConsumptionSimulator({ monitor, planLimit, settingsId, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...SIM_DEFAULTS,
    liveIntervalMinutes: monitor?.live_interval_minutes ?? SIM_DEFAULTS.liveIntervalMinutes,
    monitorDefaultMinutes: monitor?.monitor_default_minutes ?? SIM_DEFAULTS.monitorDefaultMinutes,
    monitorBetsMinutes: monitor?.monitor_bets_minutes ?? SIM_DEFAULTS.monitorBetsMinutes,
    monitorFavoritesMinutes: monitor?.monitor_favorites_minutes ?? SIM_DEFAULTS.monitorFavoritesMinutes,
    monitorCriticalMinutes: monitor?.monitor_critical_minutes ?? SIM_DEFAULTS.monitorCriticalMinutes,
    criticalFromMinute: monitor?.critical_from_minute ?? SIM_DEFAULTS.criticalFromMinute,
    calendarDays: monitor?.window_days ?? SIM_DEFAULTS.calendarDays,
    planLimit: planLimit || SIM_DEFAULTS.planLimit,
  }));
  const [saving, setSaving] = useState(false);

  const result = useMemo(() => simulateConsumption(form), [form]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: Number(value) }));

  const saveIntervals = async () => {
    setSaving(true);
    try {
      const patch = {};
      INTERVAL_KEYS.forEach(([field, key]) => {
        patch[field] = form[key];
      });
      const result = await onSaved(patch);
      toast({
        title: "Intervalos salvos",
        description: result?.rejected?.length
          ? `Fora da faixa e ignorados: ${result.rejected.map((row) => row.field).join(", ")}`
          : "Validados e aplicados em todas as rotinas.",
      });
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-surface space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Simulador de consumo</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Projeção em tempo real conforme os intervalos e o volume de jogos. O detector global cobre todas as partidas
          ao vivo em uma única chamada, então os intervalos da fila não geram custo extra — apenas os críticos, quando
          mais frequentes que o detector.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`sim_${field.key}`} className="text-xs">
              {field.label}
            </Label>
            <Input
              id={`sim_${field.key}`}
              type="number"
              step="0.5"
              min="0.5"
              value={form[field.key]}
              onChange={(event) => update(field.key, event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{field.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Consumo por hora</p>
          <p className="score-num text-lg font-semibold">{result.perHour}</p>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Consumo por dia</p>
          <p className="score-num text-lg font-semibold">{result.perDay}</p>
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Por semana / por mês</p>
          <p className="score-num text-lg font-semibold">
            {result.perWeek} / {result.perMonth}
          </p>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${RISK_TONE[result.risk]}`}>
          <p className="text-[11px] uppercase tracking-wide opacity-80">{RISK_LABEL[result.risk]}</p>
          <p className="score-num text-lg font-semibold">{result.percentOfMonth}% do plano/mês</p>
          <p className="text-[11px] opacity-80">margem de segurança {result.safetyMargin}%</p>
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={result.breakdown}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-15} dy={10} height={50} />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value) => [`${value} chamada(s)/dia`, "Consumo"]}
            />
            <Bar dataKey="calls" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {settingsId ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={saveIntervals} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
            Salvar intervalos do monitoramento
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Janela estimada com jogos ao vivo: {result.coverageHours}h/dia · {result.percentOfDay}% do plano por dia
          </span>
        </div>
      ) : null}
    </section>
  );
}
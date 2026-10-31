import React, { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import CollectionArchitecture from "@/components/admin/football/CollectionArchitecture";

const FOOTBALL_DEFAULTS = {
  football_enabled: false,
  football_base_url: "https://v3.football.api-sports.io",
  football_daily_limit: 6000,
  football_minute_limit: 60,
  football_window_days: 7,
  football_calendar_refresh_seconds: 86400,
  football_live_interval_minutes: 10,
  football_create_events: true,
  football_audit_offset_hours: 2,
  football_audit_recheck_minutes: 30,
  football_audit_fast_minutes: 15,
};

/**
 * Configuração da API: somente parâmetros de integração e coleta. Status,
 * métricas, execuções e o controle de pausa ficam no Monitoramento da API.
 */
export default function AdminFootball({ actor }) {
  const [settings, setSettings] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const settingsPage = await base44.entities.ProviderSettings.list({ limit: 1 });
    const existing = settingsPage.items?.[0] || null;
    setRecordId(existing?.id || null);
    setSettings({ ...FOOTBALL_DEFAULTS, ...(existing || {}) });
  };

  useEffect(() => {
    load().catch(() => setSettings(null));
  }, []);

  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      if (!recordId) {
        const created = await base44.entities.ProviderSettings.create({ provider: "api_football" });
        setRecordId(created.id);
      }
      const patch = {};
      Object.keys(FOOTBALL_DEFAULTS).forEach((key) => {
        patch[key] = settings[key];
      });
      const response = await base44.functions.invoke("apiFootballCentral", { action: "update_settings", patch });
      const payload = response.data || {};
      if (payload.error) throw new Error(payload.error);
      toast({
        title: "Configurações salvas",
        description: payload.rejected?.length
          ? `Fora da faixa e ignorados: ${payload.rejected.map((row) => row.field).join(", ")}`
          : "Validadas e aplicadas em todas as rotinas.",
      });
      await load();
    } catch (error) {
      toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="card-surface h-40 animate-pulse" />;

  return (
    <div className="space-y-5">
      <section className="card-surface space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Integração API-Football v3</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Somente parâmetros. Status, consumo, execuções e o controle de pausa da coleta ficam em
            <span className="text-foreground"> Monitoramento da API</span>. A chave fica guardada como segredo do
            backend; o navegador nunca fala com a API-Football.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Integração habilitada
            <Switch checked={Boolean(settings.football_enabled)} onCheckedChange={(value) => update({ football_enabled: value })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
            Criar partidas dos dias importados
            <Switch checked={Boolean(settings.football_create_events)} onCheckedChange={(value) => update({ football_create_events: value })} />
          </label>
        </div>
      </section>

      <section className="card-surface space-y-3 p-4">
        <h2 className="text-sm font-semibold">Parâmetros de sincronização</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="fb_limit">Limite diário interno</Label>
            <Input id="fb_limit" type="number" value={settings.football_daily_limit} onChange={(event) => update({ football_daily_limit: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Teto de créditos que as rotinas podem gastar por dia. Alertas em 60%, 80% e 95%. Não é o limite real do
              provedor — o valor oficial aparece no Monitoramento da API.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_minute">Limite por minuto</Label>
            <Input id="fb_minute" type="number" min="3" max="60" value={settings.football_minute_limit} onChange={(event) => update({ football_minute_limit: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Teto compartilhado de requisições por minuto entre todas as rotinas — no máximo 60, bem abaixo dos
              300/min do plano. Ao atingir, as rotinas esperam o próximo minuto em vez de receber 429 do provedor.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_live">Placar ao vivo (min)</Label>
            <Input id="fb_live" type="number" min="5" max="60" value={settings.football_live_interval_minutes} onChange={(event) => update({ football_live_interval_minutes: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Cadência do placar em toda a plataforma: uma única chamada global cobre todas as partidas ao vivo.
              Padrão 10 minutos; abaixo de 5 não há ganho de placar para o visitante.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_days">Dias importados por dia</Label>
            <Input id="fb_days" type="number" min="1" max="7" value={settings.football_window_days} onChange={(event) => update({ football_window_days: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Quantos dias a importação diária busca, sempre incluindo o dia atual. Padrão 7: hoje e os próximos seis.
              A execução manual é feita no Monitoramento da API.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_cal">Validade do calendário (horas)</Label>
            <Input id="fb_cal" type="number" value={Math.round(Number(settings.football_calendar_refresh_seconds || 0) / 3600)} onChange={(event) => update({ football_calendar_refresh_seconds: Number(event.target.value) * 3600 })} />
            <p className="text-[11px] text-muted-foreground">
              Cada data é importada uma única vez dentro dessa validade. Com 24 horas a importação é diária: nenhuma
              data é consultada de novo no mesmo dia.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_audit_offset">Primeira auditoria (horas após o início)</Label>
            <Input id="fb_audit_offset" type="number" min="1" max="6" value={settings.football_audit_offset_hours} onChange={(event) => update({ football_audit_offset_hours: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Nenhuma consulta é feita antes desse horário. A primeira auditoria acontece no início previsto da partida
              mais essas horas — o momento em que a maioria dos jogos já encerrou (padrão 2).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_recheck">Reavaliação (minutos)</Label>
            <Input id="fb_recheck" type="number" value={settings.football_audit_recheck_minutes} onChange={(event) => update({ football_audit_recheck_minutes: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              Se na primeira auditoria a partida ainda estiver em andamento, uma nova verificação é agendada em X
              minutos (padrão 30).
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fb_fast">Verificações seguintes (minutos)</Label>
            <Input id="fb_fast" type="number" value={settings.football_audit_fast_minutes} onChange={(event) => update({ football_audit_fast_minutes: Number(event.target.value) })} />
            <p className="text-[11px] text-muted-foreground">
              A partir da segunda verificação sem encerramento, novas consultas a cada X minutos até a partida terminar
              (padrão 15). Ao encerrar, a partida nunca mais é consultada.
            </p>
          </div>
        </div>

        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar configurações
        </Button>
      </section>

      <CollectionArchitecture />

      <section className="card-surface space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Como os créditos são economizados</h2>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            <li>• Uma chamada por data, uma vez ao dia: o calendário dos próximos 7 dias é importado em lote (1 crédito por data) e a data não é reconsultada no mesmo dia.</li>
            <li>• Placar ao vivo a cada 10 minutos: uma única chamada global cobre todas as partidas em andamento.</li>
            <li>• Eventos e estatísticas só são consultados para partidas com bilhete ativo — partida sem aposta não gera chamada desses endpoints.</li>
            <li>• Nenhuma consulta durante o jogo: a primeira auditoria de cada partida acontece 2 horas depois do horário de início previsto.</li>
            <li>• Se a partida ainda estiver em andamento, nova verificação em 30 minutos; a partir da segunda verificação, a cada 15 minutos até encerrar.</li>
            <li>• Encerrada (tempo normal, prorrogação ou pênaltis), o resultado é gravado e a partida nunca mais é consultada.</li>
            <li>• As auditorias consultam até 20 partidas em uma única chamada.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
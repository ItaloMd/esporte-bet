/**
 * Validação centralizada das configurações operacionais da API-Football.
 *
 * Toda alteração vinda do painel administrativo passa por aqui antes de tocar
 * o registro: apenas campos permitidos, dentro de faixas seguras. As rotinas
 * leem sempre o valor já validado — não existe um segundo caminho de escrita
 * para os parâmetros de cadência, orçamento e limites.
 *
 * Faixas: o limite por minuto nunca passa do teto do plano (300/min) e o
 * orçamento diário interno fica bem abaixo dos 7.500 do plano, preservando
 * folga para placares e auditorias mesmo em dia cheio de jogos.
 */
export const FOOTBALL_SETTINGS_RULES = {
  football_enabled: { type: 'boolean' },
  football_create_events: { type: 'boolean' },
  /** Orçamento diário interno das rotinas (abaixo do limite do plano). */
  football_daily_limit: { type: 'number', min: 10, max: 20000 },
  /**
   * Teto compartilhado de requisições por minuto entre todas as rotinas.
   * Limitado a 60 (1/5 dos 300/min do plano) e nunca acima disso no cliente.
   */
  football_minute_limit: { type: 'number', min: 3, max: 60 },
  football_window_days: { type: 'number', min: 1, max: 7 },
  football_calendar_refresh_seconds: { type: 'number', min: 3600, max: 86400 },
  football_audit_offset_hours: { type: 'number', min: 1, max: 6 },
  football_audit_recheck_minutes: { type: 'number', min: 5, max: 120 },
  football_audit_fast_minutes: { type: 'number', min: 5, max: 120 },
  football_live_interval_minutes: { type: 'number', min: 5, max: 60 },
  football_monitor_default_minutes: { type: 'number', min: 5, max: 60 },
  football_monitor_bets_minutes: { type: 'number', min: 5, max: 60 },
  football_monitor_favorites_minutes: { type: 'number', min: 5, max: 60 },
  football_monitor_critical_minutes: { type: 'number', min: 5, max: 60 },
  football_critical_from_minute: { type: 'number', min: 60, max: 100 },
};

/**
 * Filtra um conjunto de alterações vindas do painel: mantém apenas os campos
 * permitidos com valores dentro da faixa e devolve os rejeitados com o motivo,
 * para que a tela informe o administrador em vez de gravar silenciosamente.
 */
export function validateFootballSettingsPatch(input) {
  const patch = {};
  const rejected = [];
  Object.entries(input || {}).forEach(([field, value]) => {
    const rule = FOOTBALL_SETTINGS_RULES[field];
    if (!rule) {
      rejected.push({ field, reason: 'campo não permitido' });
      return;
    }
    if (rule.type === 'boolean') {
      if (typeof value === 'boolean') patch[field] = value;
      else rejected.push({ field, reason: 'esperado verdadeiro ou falso' });
      return;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      rejected.push({ field, reason: 'valor numérico inválido' });
      return;
    }
    if (num < rule.min || num > rule.max) {
      rejected.push({ field, reason: `fora da faixa permitida (${rule.min} a ${rule.max})` });
      return;
    }
    patch[field] = num;
  });
  return { patch, rejected };
}
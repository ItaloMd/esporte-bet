/**
 * Fila de monitoramento ao vivo da API-Football.
 *
 * O detector global (GET /fixtures?live=all) cobre todas as partidas em
 * andamento em uma única chamada; a fila registra a prioridade de cada partida
 * e quando ela merece atenção especial, para o painel e para checagens extras
 * de partidas em minutos finais.
 */
import { FOOTBALL_CADENCE } from './footballConfig.ts';
import { numberOr } from './footballSync.ts';

/** Detector ao vivo: uma chamada global a cada 10 minutos. */
export const DEFAULT_LIVE_INTERVAL_MINUTES = FOOTBALL_CADENCE.liveSeconds / 60;
/**
 * A fila de prioridades é informativa: o detector global é a única rotina que
 * consulta placares, então nenhuma prioridade dispara chamada própria. Os
 * intervalos apenas acompanham a cadência do detector.
 */
export const DEFAULT_MONITOR_DEFAULT_MINUTES = DEFAULT_LIVE_INTERVAL_MINUTES;
export const DEFAULT_MONITOR_BETS_MINUTES = DEFAULT_LIVE_INTERVAL_MINUTES;
export const DEFAULT_MONITOR_FAVORITES_MINUTES = DEFAULT_LIVE_INTERVAL_MINUTES;
export const DEFAULT_MONITOR_CRITICAL_MINUTES = DEFAULT_LIVE_INTERVAL_MINUTES;
export const DEFAULT_CRITICAL_FROM_MINUTE = 80;
/** Menor cadência aceita: abaixo disso só se gasta cota sem ganho de placar. */
export const MIN_LIVE_INTERVAL_MINUTES = 5;

/** Intervalo do detector global, em minutos. */
export function liveIntervalMinutes(settings) {
  return Math.max(
    MIN_LIVE_INTERVAL_MINUTES,
    numberOr(settings?.football_live_interval_minutes, DEFAULT_LIVE_INTERVAL_MINUTES),
  );
}

/** Minutos finais: a partir desse minuto a partida entra em situação crítica. */
export function isCriticalMinute(minute, settings) {
  const from = numberOr(settings?.football_critical_from_minute, DEFAULT_CRITICAL_FROM_MINUTE);
  const value = Number(minute);
  return Number.isFinite(value) && value >= from;
}

/** Prioridade da fila: 4 crítica · 3 favorita · 2 com apostas · 1 padrão. */
export function queuePriority({ hasBets, isFavorite, isCritical }) {
  if (isCritical) return { priority: 4, reason: 'minutos finais' };
  if (isFavorite) return { priority: 3, reason: 'favorita dos usuários' };
  if (hasBets) return { priority: 2, reason: 'com apostas registradas' };
  return { priority: 1, reason: 'monitoramento padrão' };
}

/** Próxima verificação da fila conforme a prioridade e os intervalos salvos. */
export function queueNextCheckAt(priority, settings, nowMs) {
  const minutes =
    priority === 4
      ? numberOr(settings?.football_monitor_critical_minutes, DEFAULT_MONITOR_CRITICAL_MINUTES)
      : priority === 3
        ? numberOr(settings?.football_monitor_favorites_minutes, DEFAULT_MONITOR_FAVORITES_MINUTES)
        : priority === 2
          ? numberOr(settings?.football_monitor_bets_minutes, DEFAULT_MONITOR_BETS_MINUTES)
          : numberOr(settings?.football_monitor_default_minutes, DEFAULT_MONITOR_DEFAULT_MINUTES);
  return new Date(nowMs + Math.max(MIN_LIVE_INTERVAL_MINUTES, minutes) * 60000).toISOString();
}
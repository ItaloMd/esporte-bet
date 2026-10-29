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

/** Detector ao vivo: 60 segundos com jogos em andamento (recomendação da documentação). */
export const DEFAULT_LIVE_INTERVAL_MINUTES = FOOTBALL_CADENCE.liveSeconds / 60;
export const DEFAULT_MONITOR_DEFAULT_MINUTES = 5;
export const DEFAULT_MONITOR_BETS_MINUTES = 1;
export const DEFAULT_MONITOR_FAVORITES_MINUTES = 1;
export const DEFAULT_MONITOR_CRITICAL_MINUTES = 0.5;
export const DEFAULT_CRITICAL_FROM_MINUTE = 80;

/** Intervalo do detector global, em minutos (mínimo 30 segundos). */
export function liveIntervalMinutes(settings) {
  return Math.max(0.5, numberOr(settings?.football_live_interval_minutes, DEFAULT_LIVE_INTERVAL_MINUTES));
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
  return new Date(nowMs + Math.max(0.5, minutes) * 60000).toISOString();
}
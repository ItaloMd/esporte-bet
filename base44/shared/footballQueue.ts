/**
 * Fila global de requisições da API-Football (plano Pro: 300 req/min).
 *
 * Toda chamada externa do sistema passa por aqui — placares, calendário,
 * cotações, auditoria, estatísticas, eventos e status da conta. O estado da
 * fila é compartilhado por todas as execuções (rotinas agendadas e ações do
 * painel) e vive no registro de cota do dia:
 *
 * - `last_slot_at`: último horário reservado na fila. Cada chamada reserva o
 *   slot seguinte com 200 ms de distância (5 req/s = 300/min), inclusive entre
 *   execuções diferentes;
 * - `minute_key` / `minute_used`: janela deslizante de 60 s;
 * - `provider_minute_remaining` / `provider_minute_at`: X-RateLimit-Remaining
 *   devolvido pelo provedor no minuto corrente. Abaixo do piso de segurança a
 *   janela é fechada e a fila espera o próximo minuto;
 * - `rate_pause_until`: pausa global (429 ou minuto fechado). Nenhuma rotina
 *   chama o provedor enquanto estiver ativa.
 *
 * Este módulo é puro: recebe o estado, devolve decisões. Quem persiste é o
 * cliente central (footballClient), que é o único ponto de chamada externa.
 */
import {
  BACKOFF_STEPS_MS,
  FOOTBALL_LIMITS,
  PROVIDER_MINUTE_LIMIT,
  PROVIDER_MINUTE_SAFETY,
  PROVIDER_REMAINING_FLOOR,
  REQUEST_GAP_MS,
} from './footballConfig.ts';

/** Teto interno por minuto (o painel pode reduzir, nunca aumentar). */
export const DEFAULT_MINUTE_LIMIT = FOOTBALL_LIMITS.minuteRequests;

/** Fração da janela reservada às cotações e insights (o resto é do essencial). */
export const NON_CRITICAL_MINUTE_SHARE = 0.9;

/** Piso de segurança lido de X-RateLimit-Remaining. */
export const MINUTE_REMAINING_FLOOR = PROVIDER_REMAINING_FLOOR;

/** Finalidades que nunca podem ser sacrificadas por prioridade. */
const CRITICAL_PURPOSES = [
  'live',
  'live_confirm',
  'audit',
  'results_audit',
  'statistics',
  'events',
  'emergency',
];

/** Chave do minuto corrente (UTC): contador compartilhado da janela de 60 s. */
export function minuteBucketKey(nowMs) {
  return new Date(Math.floor(nowMs / 60000) * 60000).toISOString().slice(0, 16);
}

/**
 * Início do próximo minuto, com folga e variação aleatória: a fila reabre
 * depois que o balde do provedor virou, sem que várias rotinas voltem no
 * mesmo milissegundo.
 */
export function nextMinuteStart(nowMs) {
  const base = Math.floor(nowMs / 60000) * 60000 + 60000;
  return base + 500 + Math.floor(Math.random() * 2000);
}

/**
 * Limite por minuto efetivo. O painel pode reduzir, nunca aumentar: o valor é
 * limitado pelo teto interno (90% de 300/min), pela margem do plano e pelo
 * limite que o provedor informou em X-RateLimit-Limit.
 */
export function effectiveMinuteLimit(settings, providerMinuteLimit = null) {
  const planCap = Math.max(1, Math.floor(PROVIDER_MINUTE_LIMIT * PROVIDER_MINUTE_SAFETY));
  const provider = Number(providerMinuteLimit);
  const providerCap =
    Number.isFinite(provider) && provider > 0
      ? Math.max(1, Math.floor(provider * PROVIDER_MINUTE_SAFETY))
      : planCap;
  const configured = Number(settings?.football_minute_limit);
  const base = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MINUTE_LIMIT;
  return Math.max(1, Math.min(base, DEFAULT_MINUTE_LIMIT, planCap, providerCap));
}

/** Verdadeiro quando a finalidade é essencial (não cede a janela por prioridade). */
export function isCriticalPurpose(purpose) {
  return CRITICAL_PURPOSES.includes(String(purpose || '').toLowerCase());
}

/**
 * Teto da janela para esta finalidade: o essencial usa a janela inteira e as
 * demais param nos 90%, preservando o último décimo do minuto para placares e
 * apuração de resultados.
 */
export function minuteAllowance(purpose, minuteLimit) {
  const limit = Math.max(1, Number(minuteLimit) || 1);
  if (isCriticalPurpose(purpose)) return limit;
  return Math.max(1, Math.floor(limit * NON_CRITICAL_MINUTE_SHARE));
}

/**
 * X-RateLimit-Remaining do minuto corrente. Só vale para o minuto em que foi
 * lido: cabeçalho de um minuto anterior é descartado.
 */
export function providerMinuteLeft(record, nowMs) {
  const atMs = Date.parse(record?.provider_minute_at || '');
  if (!Number.isFinite(atMs) || minuteBucketKey(atMs) !== minuteBucketKey(nowMs)) return null;
  const remaining = Number(record?.provider_minute_remaining);
  return Number.isFinite(remaining) ? remaining : null;
}

/** Verdadeiro quando o provedor já sinalizou pouco saldo no minuto corrente. */
export function providerMinuteBlocked(record, nowMs, cost = 1) {
  const left = providerMinuteLeft(record, nowMs);
  return left !== null && left - Number(cost) < MINUTE_REMAINING_FLOOR;
}

/**
 * Espaçamento efetivo entre chamadas. O piso é de 200 ms (300/min); depois de
 * um 429 o intervalo dobra por ocorrência e volta a 200 ms no primeiro sucesso.
 */
export function requestGapMs(strikes = 0) {
  const level = Math.min(Math.max(0, Number(strikes) || 0), 3);
  return REQUEST_GAP_MS * 2 ** level;
}

/**
 * Reserva do próximo slot da fila: um intervalo depois do último slot
 * reservado, nunca no passado. `waitMs` é o tempo que a execução aguarda antes
 * de chamar.
 */
export function planRequestSlot(lastSlotAtIso, nowMs, gapMs = REQUEST_GAP_MS) {
  const last = Date.parse(lastSlotAtIso || '');
  const gap = Math.max(REQUEST_GAP_MS, Number(gapMs) || REQUEST_GAP_MS);
  const earliest = Number.isFinite(last) ? last + gap : nowMs;
  const atMs = Math.max(nowMs, earliest);
  return { atMs, waitMs: Math.max(0, atMs - nowMs) };
}

/** Backoff exponencial entre retentativas após 429 (1s, 2s, 4s). */
export function retryDelayMs(attempt) {
  const index = Math.min(Math.max(0, Number(attempt) - 1), BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[index];
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

/** Espera assíncrona sem bloquear a execução. */
export function sleep(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
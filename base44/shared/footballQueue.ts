/**
 * Fila global de requisições da API-Football — decisões puras.
 *
 * O estado da fila é compartilhado por todas as execuções (rotinas agendadas e
 * ações do painel) e vive no registro de cota do dia:
 *
 * - `last_slot_at`: último horário reservado na fila. Cada chamada reserva o
 *   slot seguinte com o espaçamento calculado a partir do limite por minuto,
 *   inclusive entre execuções diferentes;
 * - `minute_key` / `minute_used`: janela de 60 s compartilhada;
 * - `provider_minute_remaining` / `provider_minute_at`: X-RateLimit-Remaining
 *   devolvido pelo provedor no minuto corrente. Perto de zero a janela é
 *   fechada e a fila espera o próximo minuto;
 * - `rate_pause_until`: pausa global (limite por minuto excedido).
 *
 * Este módulo é puro: recebe o estado, devolve decisões. Quem persiste é o
 * cliente central (footballClient), único ponto de chamada externa.
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
  return base + 1000 + Math.floor(Math.random() * 1500);
}

/**
 * Limite por minuto efetivo. O painel pode reduzir, nunca aumentar: o valor é
 * limitado pelo teto interno (90% de 300/min) e pelo limite que o provedor
 * informou em X-RateLimit-Limit.
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

/** Piso do espaçamento entre chamadas: 1 s, mesmo com o plano permitindo mais. */
export const MIN_SAFE_GAP_MS = 1000;

/**
 * Espaçamento entre chamadas para caber no limite por minuto: o minuto é
 * dividido pelo teto efetivo. O piso é 1 s (~60/min), bem abaixo dos 300/min do
 * plano: o provedor recusa requisições quase simultâneas de execuções
 * diferentes, e o espaçamento apertado (230 ms) fazia justamente isso.
 */
export function paceGapMs(minuteLimit) {
  const limit = Math.max(1, Number(minuteLimit) || DEFAULT_MINUTE_LIMIT);
  return Math.max(MIN_SAFE_GAP_MS, Math.ceil(60000 / limit));
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
  return left !== null && left - Number(cost) < PROVIDER_REMAINING_FLOOR;
}

/** Requisições já feitas no minuto corrente (0 quando o minuto virou). */
export function minuteWindowUsed(record, nowMs) {
  if (record?.minute_key !== minuteBucketKey(nowMs)) return 0;
  return Math.max(0, Number(record?.minute_used) || 0);
}

/**
 * Reserva do próximo slot da fila: um intervalo depois do último slot
 * reservado, nunca no passado. `waitMs` é o tempo que a execução aguarda antes
 * de chamar.
 *
 * Quando o slot já está no futuro, significa que outra execução o reservou:
 * uma variação curta evita que duas rotinas acordem no mesmo milissegundo.
 */
export function planRequestSlot(lastSlotAtIso, nowMs, gapMs = REQUEST_GAP_MS) {
  const last = Date.parse(lastSlotAtIso || '');
  const gap = Math.max(REQUEST_GAP_MS, Number(gapMs) || REQUEST_GAP_MS);
  const earliest = Number.isFinite(last) ? last + gap : nowMs;
  const base = Math.max(nowMs, earliest);
  const contention = earliest > nowMs ? Math.min(250, Math.floor(gap / 3)) : 0;
  const jitter = contention ? Math.floor(Math.random() * contention) : 0;
  const atMs = base + jitter;
  return { atMs, waitMs: Math.max(0, atMs - nowMs) };
}

/* ------------------------- espaçamento aprendido (AIMD) ------------------------- */

/** Piso do espaçamento entre chamadas (o mesmo da fila nominal). */
export const MIN_REQUEST_GAP_MS = REQUEST_GAP_MS;

/**
 * Teto do espaçamento aprendido: 12 s (~5 chamadas/min). O provedor recusa
 * rajadas bem menores que o limite anunciado (a conta já respondeu 429 com
 * saldo intacto); sem este teto mais largo, o espaçamento travava em 5 s e a
 * coleta apanhava 429 a cada minuto, sem nunca desacelerar o suficiente para
 * passar.
 */
export const MAX_REQUEST_GAP_MS = 12000;

/** Sucessos consecutivos necessários para voltar a acelerar. */
export const RECOVERY_SUCCESSES = 12;

/** Mantém o espaçamento dentro dos limites operacionais. */
export function clampGap(gapMs) {
  const value = Number(gapMs);
  if (!Number.isFinite(value) || value <= 0) return MIN_REQUEST_GAP_MS;
  return Math.min(MAX_REQUEST_GAP_MS, Math.max(MIN_REQUEST_GAP_MS, Math.round(value)));
}

/**
 * Depois de um limite do provedor: dobra o espaçamento. O provedor recusa
 * rajadas mesmo com saldo nos cabeçalhos, então o ritmo aprendido é o que
 * realmente importa — e ele é persistido, valendo para todas as execuções.
 */
export function gapAfterRateLimit(gapMs) {
  return clampGap(Math.max(800, clampGap(gapMs) * 2));
}

/**
 * Depois de uma sequência de sucessos: acelera 20% sem nunca passar do ritmo
 * configurado (`floorGapMs`). Assim a recuperação é gradual e converge para o
 * espaçamento nominal, em vez de disparar direto para o piso.
 */
export function gapAfterSuccess(gapMs, streak, floorGapMs = MIN_REQUEST_GAP_MS) {
  if (Number(streak) < RECOVERY_SUCCESSES) return clampGap(gapMs);
  const floor = Math.max(MIN_REQUEST_GAP_MS, Number(floorGapMs) || MIN_REQUEST_GAP_MS);
  return clampGap(Math.max(floor, clampGap(gapMs) * 0.8));
}

/**
 * Marcadores a zerar quando um bloqueio já expirou, para a coleta retomar
 * limpa: pausa e bloqueio vencidos saem, as janelas de minuto e segundo viram,
 * o slot antigo é descartado e o espaçamento volta ao ritmo configurado.
 *
 * Devolve `{}` quando não há nada vencido — é isso que torna a limpeza
 * idempotente: execuções simultâneas não limpam a fila repetidamente.
 */
export function resumeQueuePatch(record, { nowMs = Date.now(), minuteLimit = DEFAULT_MINUTE_LIMIT } = {}) {
  const patch = {};
  const pauseMs = Date.parse(record?.rate_pause_until || '');
  const blockMs = Date.parse(record?.daily_blocked_until || '');
  const expired = (Number.isFinite(pauseMs) && pauseMs <= nowMs) || (Number.isFinite(blockMs) && blockMs <= nowMs);

  if (expired) {
    patch.rate_pause_until = null;
    patch.daily_blocked_until = null;
    patch.daily_blocked_at = null;
    patch.rate_limit_strikes = 0;
    patch.success_streak = 0;
    patch.last_slot_at = null;
    // Retomada pelo ritmo configurado: nem o piso, nem o ritmo lento que o
    // bloqueio anterior impôs.
    patch.request_gap_ms = paceGapMs(minuteLimit);
  }

  const minuteKey = minuteBucketKey(nowMs);
  if (record?.minute_key !== minuteKey && Number(record?.minute_used)) {
    patch.minute_key = minuteKey;
    patch.minute_used = 0;
  }
  const secondKey = secondBucketKey(nowMs);
  if (record?.second_key !== secondKey && Number(record?.second_used)) {
    patch.second_key = secondKey;
    patch.second_used = 0;
  }
  return patch;
}

/** Backoff exponencial entre tentativas de rede/5xx (1s, 2s, 4s). */
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

/* ------------------------------ janela de 1 s ------------------------------ */

/** Chave do segundo corrente (UTC): janela de 1 s compartilhada por execuções. */
export function secondBucketKey(nowMs) {
  return String(Math.floor(nowMs / 1000));
}

/** Requisições já feitas no segundo corrente (0 quando o segundo virou). */
export function secondWindowUsed(record, nowMs) {
  if (record?.second_key !== secondBucketKey(nowMs)) return 0;
  return Math.max(0, Number(record?.second_used) || 0);
}

/**
 * Próximo segundo, com variação curta: a fila reabre depois que o segundo virou
 * sem que todas as execuções voltem no mesmo milissegundo.
 */
export function nextSecondStart(nowMs) {
  return Math.floor(nowMs / 1000) * 1000 + 1000 + Math.floor(Math.random() * 120);
}
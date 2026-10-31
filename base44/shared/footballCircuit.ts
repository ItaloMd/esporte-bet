/**
 * Disjuntor do provedor (circuit breaker).
 *
 * Enquanto o provedor devolve erro de limite, de chave ou de plano, o problema
 * tem tratamento próprio e não abre o disjuntor. O disjuntor existe para a outra
 * classe de falha: indisponibilidade (5xx), tempo esgotado e erro de rede — casos
 * em que repetir a chamada só gasta requisição e tempo de execução.
 *
 * Política: N falhas duras consecutivas abrem o disjuntor por um cooldown que
 * dobra a cada abertura seguida (5 min até 30 min). Uma chamada bem-sucedida
 * fecha o disjuntor e zera o histórico. O estado vive no registro de cota do dia,
 * portanto é compartilhado por todas as rotinas.
 */
import { FootballAuthError, FootballProviderError, FootballRateLimitError } from './apiFootball.ts';

export const BREAKER_POLICY = {
  /** Falhas duras consecutivas que abrem o disjuntor. */
  threshold: 4,
  /** Cooldown inicial; dobra a cada abertura consecutiva. */
  baseCooldownMs: 5 * 60 * 1000,
  /** Teto do cooldown. */
  maxCooldownMs: 30 * 60 * 1000,
};

const iso = (ms) => new Date(ms).toISOString();

/** Estado atual do disjuntor a partir do registro de cota. */
export function breakerState(record, nowMs = Date.now()) {
  const untilMs = Date.parse(record?.breaker_open_until || '');
  const open = Number.isFinite(untilMs) && untilMs > nowMs;
  return {
    open,
    until: open ? record.breaker_open_until : null,
    reason: open ? String(record?.breaker_reason || '') : '',
    failures: Number(record?.breaker_failures || 0),
    trips: Number(record?.breaker_trips || 0),
    opened_at: record?.breaker_opened_at || null,
    last_failure_at: record?.breaker_last_failure_at || null,
    threshold: BREAKER_POLICY.threshold,
  };
}

/**
 * Verdadeiro somente para falha transitória de infraestrutura. Limite (429),
 * chave inválida e plano sem o dado nunca contam como falha do disjuntor.
 */
export function isTransientFailure(error) {
  if (!error) return false;
  if (error instanceof FootballRateLimitError) return false;
  if (error instanceof FootballAuthError) return false;
  if (error instanceof FootballProviderError) return false;
  const status = Number(error?.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return false;
  return true;
}

/** Patch de uma falha dura: acumula ou abre o disjuntor. */
export function breakerFailurePatch(record, reason, nowMs = Date.now()) {
  const failures = Number(record?.breaker_failures || 0) + 1;
  const base = { breaker_failures: failures, breaker_last_failure_at: iso(nowMs) };
  if (failures < BREAKER_POLICY.threshold) return base;

  const trips = Number(record?.breaker_trips || 0) + 1;
  const cooldownMs = Math.min(
    BREAKER_POLICY.maxCooldownMs,
    BREAKER_POLICY.baseCooldownMs * 2 ** Math.min(trips - 1, 3),
  );
  return {
    breaker_failures: 0,
    breaker_trips: trips,
    breaker_open_until: iso(nowMs + cooldownMs),
    breaker_opened_at: iso(nowMs),
    breaker_reason: String(reason || 'provedor indisponível').slice(0, 240),
    breaker_last_failure_at: iso(nowMs),
  };
}

/** Patch de sucesso: fecha o disjuntor e zera o histórico. */
export function breakerSuccessPatch() {
  return {
    breaker_failures: 0,
    breaker_trips: 0,
    breaker_open_until: null,
    breaker_reason: '',
  };
}
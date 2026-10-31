/**
 * Fila única de requisições da API-Football.
 *
 * Toda chamada externa do sistema passa por aqui. Nenhuma rotina fala com o
 * provedor por conta própria, o que garante um único ponto de controle:
 *
 * - fila global com 200 ms entre chamadas consecutivas (300/min do plano Pro),
 *   compartilhada por rotinas agendadas e pelo painel administrativo;
 * - janela de 60 s com teto de 90% do plano e leitura de X-RateLimit-Remaining:
 *   abaixo de 50 a janela é fechada e a fila espera o próximo minuto;
 * - prioridade: placares, auditoria, estatísticas e eventos usam a janela
 *   inteira; cotações e insights param nos 90%, sem nunca competir com o
 *   essencial;
 * - orçamento diário dividido por finalidade (40% ao vivo, 30% cotações,
 *   20% apuração, 10% emergência) com contenção em 80% e 90%;
 * - 429: pausa até o próximo minuto, disjuntor por endpoint e retentativa com
 *   backoff exponencial (1s, 2s, 4s);
 * - registro de cada chamada com endpoint, finalidade, tempo de resposta,
 *   créditos e saldo informado pelo provedor.
 */
import { FootballRateLimitError, apiFootballFetch, isRateLimitErrorText } from './apiFootball.ts';
import {
  CIRCUIT_BREAKER_STEPS,
  FOOTBALL_BUDGET_GUARD,
  PROVIDER_REMAINING_FLOOR,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_PAUSE_MIN_MS,
  TOKEN_BUCKET_RESERVE,
} from './footballConfig.ts';
import {
  alertMessages,
  budgetPurpose,
  canSpend,
  canSpendPurpose,
  loadQuota,
  quotaLevel,
  saveQuota,
} from './footballQuota.ts';
import {
  DEFAULT_MINUTE_LIMIT,
  effectiveMinuteLimit,
  minuteAllowance,
  minuteBucketKey,
  nextMinuteStart,
  planRequestSlot,
  providerMinuteBlocked,
  retryDelayMs,
  sleep,
} from './footballQueue.ts';

export { DEFAULT_MINUTE_LIMIT, effectiveMinuteLimit, minuteBucketKey };

/** Marca das linhas de registro de cada requisição real enviada ao provedor. */
const LEDGER_NOTE = 'ledger';

/** Pausa pós-429 ainda ativa: nenhuma chamada é feita até este horário. */
export class FootballPausedError extends Error {
  constructor(untilIso) {
    super(`API-Football em pausa de segurança até ${untilIso}`);
    this.name = 'FootballPausedError';
    this.untilIso = untilIso;
  }
}

/** Limite por minuto atingido: rotinas param até o próximo minuto. */
export class FootballMinuteLimitError extends Error {
  constructor(limit) {
    super(`Limite interno de ${limit} requisições por minuto atingido`);
    this.name = 'FootballMinuteLimitError';
  }
}

/** Orçamento diário (total, por finalidade ou de tokens) esgotado. */
export class FootballBudgetError extends Error {
  constructor(used, limit) {
    super(`Orçamento reservado: ${used}/${limit}`);
    this.name = 'FootballBudgetError';
  }
}

/** Disjuntor aberto para o endpoint: usar apenas dados de cache. */
export class FootballCircuitOpenError extends Error {
  constructor(endpoint, untilIso) {
    super(`Disjuntor aberto em ${endpoint} até ${untilIso} — usando cache`);
    this.name = 'FootballCircuitOpenError';
    this.endpoint = endpoint;
    this.untilIso = untilIso;
  }
}

/** Erros que exigem parar imediatamente as chamadas (não são retentados). */
export function isThrottleError(error) {
  return (
    error instanceof FootballRateLimitError ||
    error instanceof FootballPausedError ||
    error instanceof FootballMinuteLimitError ||
    error instanceof FootballBudgetError ||
    error instanceof FootballCircuitOpenError
  );
}

/** Endpoint sem parâmetros: chave do disjuntor. */
function endpointKey(endpoint) {
  return String(endpoint || '').split('?')[0] || '/';
}

/** Disjuntores abertos (JSON tolerante a registros antigos). */
function readBreakers(record) {
  try {
    const parsed = JSON.parse(record?.blocked_endpoints || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Abre o cliente central da execução. O estado (registro de cota) é relido a
 * cada chamada: rotinas concorrentes compartilham o mesmo balde por minuto, o
 * mesmo slot de fila, os disjuntores e o orçamento por finalidade.
 */
export async function openFootballClient(db, { apiKey, base, settings, day, limit, reserve = 0, label = '' }) {
  let record = await loadQuota(db, day);
  let used = Number(record?.used || 0);

  async function persist(patch) {
    record = await saveQuota(db, record, { ...(record?.id ? {} : { day }), ...patch });
    if (Number.isFinite(Number(record?.used))) used = Number(record.used);
    return record;
  }

  /**
   * Registra o 429: pausa até o próximo minuto, disjuntor do endpoint e
   * contagem de ocorrências para o backoff exponencial.
   */
  async function registerRateLimit({ endpoint, retryAfterMs, message }) {
    const nowMs = Date.now();
    const strikes = Number(record?.rate_limit_strikes || 0) + 1;
    const pauseMs = Math.max(
      Number(retryAfterMs) || 0,
      nextMinuteStart(nowMs) - nowMs,
      RATE_LIMIT_PAUSE_MIN_MS,
    );
    const untilIso = new Date(nowMs + pauseMs).toISOString();

    const key = endpointKey(endpoint);
    const breakers = readBreakers(record);
    const previous = Number(breakers?.[key]?.strikes || 0) + 1;
    const openSeconds = CIRCUIT_BREAKER_STEPS[Math.min(previous - 1, CIRCUIT_BREAKER_STEPS.length - 1)];
    breakers[key] = { until: new Date(nowMs + openSeconds * 1000).toISOString(), strikes: previous };

    await persist({
      rate_pause_until: untilIso,
      rate_limit_strikes: strikes,
      blocked_endpoints: JSON.stringify(breakers),
      last_rate_limited_at: new Date(nowMs).toISOString(),
      last_status_at: new Date(nowMs).toISOString(),
      last_status_code: 429,
      last_error: `429 · ${String(message || 'Too many requests').slice(0, 160)} · pausa ${Math.round(pauseMs / 1000)}s`,
    });
    await db.ApiUsageLog.create({
      provider: 'api_football',
      endpoint: String(endpoint || ''),
      purpose: label || '',
      status_code: 429,
      cache_hit: false,
      credits_used: 0,
      params: label || '',
      note: `limite excedido · degrau ${strikes} · disjuntor ${openSeconds}s · pausa ${Math.round(pauseMs / 1000)}s`,
      error_message: String(message || 'Too many requests').slice(0, 240),
    }).catch(() => null);
    return { untilIso, waitMs: pauseMs };
  }

  /**
   * Fecha a janela do minuto: nenhuma rotina chama o provedor até o próximo
   * minuto virar. Usado quando o teto interno ou o X-RateLimit-Remaining manda
   * parar.
   */
  async function closeMinute({ minuteKey, minuteUsed, reason }) {
    const untilIso = new Date(nextMinuteStart(Date.now())).toISOString();
    await persist({
      rate_pause_until: untilIso,
      minute_key: minuteKey,
      minute_used: minuteUsed,
      last_error: String(reason).slice(0, 200),
    });
    return untilIso;
  }

  const client = {
    get record() {
      return record;
    },
    get used() {
      return used;
    },
    get remaining() {
      const value = Number(record?.provider_remaining);
      return Number.isFinite(value) ? value : null;
    },
    get minuteLimit() {
      return effectiveMinuteLimit(settings, record?.provider_minute_limit);
    },
    get pausedUntil() {
      return record?.rate_pause_until || null;
    },
    get breakers() {
      return readBreakers(record);
    },

    /**
     * Executa uma chamada passando por toda a fila. `charge: false` serve ao
     * /status, que não consome cota diária mas ocupa a janela do minuto.
     */
    async call(endpoint, params = {}, { cost = 1, timeoutMs, purpose = label, priority, charge = true } = {}) {
      const bucketPurpose = budgetPurpose(purpose);
      const key = endpointKey(endpoint);
      let attempt = 0;

      for (;;) {
        const fresh = await loadQuota(db, day);
        if (fresh) {
          record = fresh;
          used = Number(record.used || 0);
        }
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        // 1) Disjuntor do endpoint: a rotina usa o cache.
        const breaker = readBreakers(record)?.[key];
        if (breaker?.until && Date.parse(breaker.until) > nowMs) {
          throw new FootballCircuitOpenError(key, breaker.until);
        }

        // 2) Pausa global: 429 recente ou minuto fechado.
        const pauseMs = Date.parse(record?.rate_pause_until || '');
        if (Number.isFinite(pauseMs) && pauseMs > nowMs) {
          throw new FootballPausedError(record.rate_pause_until);
        }

        // 3) Janela de 60 s: contador compartilhado + registro real de chamadas,
        // com teto por prioridade (essencial usa a janela inteira).
        const bucket = minuteBucketKey(nowMs);
        const minuteLimit = effectiveMinuteLimit(settings, record?.provider_minute_limit);
        const ceiling = minuteAllowance(purpose, minuteLimit);
        const reserved = record?.minute_key === bucket ? Number(record?.minute_used || 0) : 0;
        const windowStartIso = new Date(nowMs - 60000).toISOString();
        const ledgerCalls =
          Number(await db.ApiUsageLog.count({ note: LEDGER_NOTE, created_date: { $gte: windowStartIso } })) || 0;
        const minuteUsed = Math.max(reserved, ledgerCalls);

        // 4) X-RateLimit-Remaining do minuto corrente: pouco saldo fecha o minuto.
        if (providerMinuteBlocked(record, nowMs, cost)) {
          const untilIso = await closeMinute({
            minuteKey: bucket,
            minuteUsed,
            reason: `X-RateLimit-Remaining abaixo de ${PROVIDER_REMAINING_FLOOR}`,
          });
          throw new FootballPausedError(untilIso);
        }
        if (minuteUsed + cost > ceiling) {
          await closeMinute({
            minuteKey: bucket,
            minuteUsed,
            reason: `teto de ${ceiling} requisições/minuto atingido`,
          });
          throw new FootballMinuteLimitError(ceiling);
        }

        // 5) Orçamento diário, contenção por faixa e cota da finalidade.
        if (charge) {
          if (!canSpend(used, limit, reserve, cost)) throw new FootballBudgetError(used, limit);
          const percent = Number(limit) > 0 ? (used / Number(limit)) * 100 : 0;
          const critical = priority === 'CRITICA';
          if (percent >= FOOTBALL_BUDGET_GUARD.criticalOnly) {
            const essential = bucketPurpose === 'live' || bucketPurpose === 'audit';
            if (!essential && !critical) throw new FootballBudgetError(used, limit);
          } else if (percent >= FOOTBALL_BUDGET_GUARD.suspendOdds) {
            if (bucketPurpose === 'odds' && !critical) throw new FootballBudgetError(used, limit);
          }
          if (!canSpendPurpose(record, limit, bucketPurpose, cost)) throw new FootballBudgetError(used, limit);
          const tokens = Number(record?.provider_remaining);
          if (Number.isFinite(tokens) && tokens - cost < TOKEN_BUCKET_RESERVE) {
            throw new FootballBudgetError(used, limit);
          }
        }

        // 6) Fila: reserva o próximo slot (200 ms após o anterior) e espera.
        const slot = planRequestSlot(record?.last_slot_at, nowMs);
        const slotIso = new Date(slot.atMs).toISOString();
        if (record?.last_slot_at !== slotIso) await persist({ last_slot_at: slotIso });
        await sleep(slot.waitMs);

        // 7) A chamada em si, cronometrada.
        const startedAt = Date.now();
        let result;
        try {
          result = await apiFootballFetch(apiKey, endpoint, params, {
            base,
            ...(timeoutMs ? { timeoutMs } : {}),
          });
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          if (error instanceof FootballRateLimitError) {
            const { waitMs } = await registerRateLimit({
              endpoint,
              retryAfterMs: error.retryAfterMs,
              message: error.message,
            });
            // Espera o próximo minuto e tenta de novo com backoff exponencial.
            if (attempt < RATE_LIMIT_MAX_RETRIES) {
              attempt += 1;
              await sleep(waitMs + retryDelayMs(attempt));
              continue;
            }
          }
          await db.ApiUsageLog.create({
            provider: 'api_football',
            endpoint: String(endpoint || ''),
            purpose: bucketPurpose,
            status_code: error?.status || 0,
            duration_ms: durationMs,
            cache_hit: false,
            credits_used: 0,
            retry_count: attempt,
            params: purpose || label || '',
            note: attempt ? `falha na chamada após ${attempt} retentativa(s)` : 'falha na chamada',
            error_message: String(error?.message || error).slice(0, 240),
          }).catch(() => null);
          throw error;
        }
        const durationMs = Date.now() - startedAt;

        if (result.errors.some(isRateLimitErrorText)) {
          const message = result.errors.filter(isRateLimitErrorText).join(' | ');
          const { waitMs } = await registerRateLimit({ endpoint, retryAfterMs: null, message });
          if (attempt < RATE_LIMIT_MAX_RETRIES) {
            attempt += 1;
            await sleep(waitMs + retryDelayMs(attempt));
            continue;
          }
          throw new FootballRateLimitError(message);
        }

        // 8) Cobrança diária + por finalidade + tokens + janela do minuto, numa escrita.
        if (charge) used += cost;
        const purposeUsage = (() => {
          try {
            return JSON.parse(record?.purpose_used || '{}') || {};
          } catch {
            return {};
          }
        })();
        if (charge) purposeUsage[bucketPurpose] = (Number(purposeUsage[bucketPurpose]) || 0) + cost;
        const breakers = readBreakers(record);
        delete breakers[key];
        const { messages, alerts } = charge ? alertMessages(used, limit, record?.alerts || []) : { messages: [], alerts: record?.alerts || [] };

        await persist({
          ...(charge ? { used, limit, level: quotaLevel(used, limit) } : {}),
          purpose_used: JSON.stringify(purposeUsage),
          blocked_endpoints: JSON.stringify(breakers),
          ...(messages.length ? { alerts, notes: messages.join(' · ').slice(0, 400) } : {}),
          minute_key: bucket,
          minute_used: minuteUsed + cost,
          rate_limit_strikes: 0,
          ...(result.quota?.limit !== null && result.quota?.limit !== undefined ? { provider_limit: result.quota.limit } : {}),
          ...(result.quota?.remaining !== null && result.quota?.remaining !== undefined ? { provider_remaining: result.quota.remaining } : {}),
          ...(result.quota?.used !== null && result.quota?.used !== undefined ? { provider_used: result.quota.used } : {}),
          ...(result.quota?.minuteLimit !== null && result.quota?.minuteLimit !== undefined
            ? { provider_minute_limit: result.quota.minuteLimit }
            : {}),
          ...(result.quota?.minuteRemaining !== null && result.quota?.minuteRemaining !== undefined
            ? { provider_minute_remaining: result.quota.minuteRemaining, provider_minute_at: nowIso }
            : {}),
          last_status_at: nowIso,
          last_status_code: 200,
        });

        // 9) Registro da requisição real: base da janela por minuto e do painel.
        await db.ApiUsageLog.create({
          provider: 'api_football',
          endpoint: String(endpoint || ''),
          purpose: bucketPurpose,
          status_code: result.status || 200,
          duration_ms: durationMs,
          records_returned: Number(result.results) || 0,
          cache_hit: false,
          credits_used: charge ? cost : 0,
          rate_limit_remaining: result.quota?.remaining ?? null,
          retry_count: attempt,
          params: purpose || label || '',
          note: LEDGER_NOTE,
          error_message: '',
        }).catch(() => null);

        return result;
      }
    },
  };
  return client;
}
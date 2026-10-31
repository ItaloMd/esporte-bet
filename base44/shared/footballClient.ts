/**
 * Collector único da API-Football: toda chamada externa do sistema passa por
 * aqui. Nenhuma rotina fala com o provedor por conta própria, o que garante um
 * único ponto de controle de consumo:
 *
 * - token bucket global alimentado pelos cabeçalhos do provedor
 *   (x-ratelimit-requests-limit / -remaining): sem token, não há chamada;
 * - janela deslizante de 60 s sobre o registro real de chamadas enviadas;
 * - orçamento diário dividido por finalidade (40% ao vivo, 30% cotações,
 *   20% apuração, 10% emergência) com contenção em 80% e 90%;
 * - disjuntor por endpoint: ao receber 429 o endpoint fica bloqueado com
 *   backoff de 30/60/120/300 s e as rotinas seguem servindo o cache;
 * - pausa global pós-429, para que nenhuma rotina insista enquanto o minuto
 *   do provedor está saturado;
 * - registro de cada chamada com endpoint, finalidade, tempo de resposta,
 *   créditos, tokens restantes, cache hit e tentativas.
 */
import { FootballRateLimitError, apiFootballFetch, isRateLimitErrorText } from './apiFootball.ts';
import {
  CIRCUIT_BREAKER_STEPS,
  THROTTLE_PAUSE_STEPS,
  FOOTBALL_BUDGET_GUARD,
  FOOTBALL_LIMITS,
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

/** Limite interno de requisições por minuto (definido em footballConfig). */
export const DEFAULT_MINUTE_LIMIT = FOOTBALL_LIMITS.minuteRequests;
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

/** Chave do minuto corrente (UTC): contador por minuto compartilhado. */
export function minuteBucketKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 16);
}

/** Limite por minuto configurado no painel (fallback conservador). */
export function effectiveMinuteLimit(settings) {
  const configured = Number(settings?.football_minute_limit);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MINUTE_LIMIT;
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
 * cada chamada: rotinas concorrentes compartilham token bucket, contador por
 * minuto, disjuntores e orçamento por finalidade.
 */
export async function openFootballClient(db, { apiKey, base, settings, day, limit, reserve = 0, label = '' }) {
  let record = await loadQuota(db, day);
  let used = Number(record?.used || 0);

  async function persist(patch) {
    record = await saveQuota(db, record, { ...(record?.id ? {} : { day }), ...patch });
    if (Number.isFinite(Number(record?.used))) used = Number(record.used);
    return record;
  }

  /** Registra o 429: pausa global progressiva + disjuntor do endpoint. */
  async function registerRateLimit({ endpoint, retryAfterMs, message }) {
    const nowMs = Date.now();
    const strikes = Number(record?.rate_limit_strikes || 0) + 1;
    const stepSeconds = THROTTLE_PAUSE_STEPS[Math.min(strikes - 1, THROTTLE_PAUSE_STEPS.length - 1)];
    const jitter = 0.9 + Math.random() * 0.2;
    const pauseMs = Math.max(Number(retryAfterMs) || 0, Math.round(stepSeconds * 1000 * jitter));
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
      last_error: `429 · ${String(message || 'Too many requests').slice(0, 180)} · pausa ${Math.round(pauseMs / 1000)}s`,
    });
    await db.ApiUsageLog.create({
      provider: 'api_football',
      endpoint: String(endpoint || ''),
      purpose: label || '',
      status_code: 429,
      cache_hit: false,
      credits_used: 0,
      params: label || '',
      note: `limite excedido · degrau ${strikes} · disjuntor ${openSeconds}s`,
      error_message: String(message || 'Too many requests').slice(0, 240),
    }).catch(() => null);
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
      return effectiveMinuteLimit(settings);
    },
    get pausedUntil() {
      return record?.rate_pause_until || null;
    },
    get breakers() {
      return readBreakers(record);
    },

    /**
     * Executa uma chamada passando por todos os controles. Pausa, limite por
     * minuto, orçamento e disjuntor são lançados como exceções tipadas: a
     * rotina chamadora para imediatamente e serve o cache.
     */
    async call(endpoint, params = {}, { cost = 1, timeoutMs, purpose = label, priority } = {}) {
      const fresh = await loadQuota(db, day);
      if (fresh) {
        record = fresh;
        used = Number(record.used || 0);
      }
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const bucketPurpose = budgetPurpose(purpose);

      // 1) Disjuntor do endpoint aberto: a rotina usa o cache.
      const key = endpointKey(endpoint);
      const breaker = readBreakers(record)?.[key];
      if (breaker?.until && Date.parse(breaker.until) > nowMs) {
        throw new FootballCircuitOpenError(key, breaker.until);
      }

      // 2) Pausa global pós-429.
      const pauseMs = Date.parse(record?.rate_pause_until || '');
      if (Number.isFinite(pauseMs) && pauseMs > nowMs) {
        throw new FootballPausedError(record.rate_pause_until);
      }

      // 3) Janela deslizante de 60 s sobre o registro real de chamadas.
      const bucket = minuteBucketKey(nowMs);
      const minuteLimit = effectiveMinuteLimit(settings);
      const windowStartIso = new Date(nowMs - 60000).toISOString();
      const recentCalls = await db.ApiUsageLog.count({ note: LEDGER_NOTE, created_date: { $gte: windowStartIso } });
      if (recentCalls >= minuteLimit) {
        const untilIso = new Date(nowMs - (nowMs % 60000) + 60000 + 1000 + Math.floor(Math.random() * 4000)).toISOString();
        await persist({ rate_pause_until: untilIso, minute_key: bucket, minute_used: recentCalls });
        throw new FootballMinuteLimitError(minuteLimit);
      }

      // 4) Orçamento diário total, com a reserva da faixa.
      if (!canSpend(used, limit, reserve, cost)) {
        throw new FootballBudgetError(used, limit);
      }

      // 5) Contenção por faixa: 80% suspende cotações normais, 90% mantém só
      // o essencial (jogos críticos e apuração de resultados).
      const percent = Number(limit) > 0 ? (used / Number(limit)) * 100 : 0;
      const critical = priority === 'CRITICA';
      if (percent >= FOOTBALL_BUDGET_GUARD.criticalOnly) {
        const essential = bucketPurpose === 'live' || bucketPurpose === 'audit';
        if (!essential && !critical) throw new FootballBudgetError(used, limit);
      } else if (percent >= FOOTBALL_BUDGET_GUARD.suspendOdds) {
        if (bucketPurpose === 'odds' && !critical) throw new FootballBudgetError(used, limit);
      }

      // 6) Orçamento próprio da finalidade.
      if (!canSpendPurpose(record, limit, bucketPurpose, cost)) {
        throw new FootballBudgetError(used, limit);
      }

      // 7) Token bucket global: sem token do provedor, nenhuma chamada.
      const tokens = Number(record?.provider_remaining);
      if (Number.isFinite(tokens) && tokens - cost < TOKEN_BUCKET_RESERVE) {
        throw new FootballBudgetError(used, limit);
      }

      // 8) A chamada em si, cronometrada.
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
          await registerRateLimit({ endpoint, retryAfterMs: error.retryAfterMs, message: error.message });
        }
        await db.ApiUsageLog.create({
          provider: 'api_football',
          endpoint: String(endpoint || ''),
          purpose: bucketPurpose,
          status_code: error?.status || 0,
          duration_ms: durationMs,
          cache_hit: false,
          credits_used: 0,
          rate_limit_remaining: Number.isFinite(tokens) ? tokens : null,
          retry_count: 0,
          params: purpose || label || '',
          note: 'falha na chamada',
          error_message: String(error?.message || error).slice(0, 240),
        }).catch(() => null);
        throw error;
      }
      const durationMs = Date.now() - startedAt;

      if (result.errors.some(isRateLimitErrorText)) {
        const message = result.errors.filter(isRateLimitErrorText).join(' | ');
        await registerRateLimit({ endpoint, retryAfterMs: null, message });
        throw new FootballRateLimitError(message);
      }

      // 9) Cobrança diária + por finalidade + tokens do provedor numa escrita.
      used += cost;
      const purposeUsage = (() => {
        try {
          return JSON.parse(record?.purpose_used || '{}') || {};
        } catch {
          return {};
        }
      })();
      purposeUsage[bucketPurpose] = (Number(purposeUsage[bucketPurpose]) || 0) + cost;
      const breakers = readBreakers(record);
      delete breakers[key];
      const { messages, alerts } = alertMessages(used, limit, record?.alerts || []);

      await persist({
        used,
        limit,
        level: quotaLevel(used, limit),
        purpose_used: JSON.stringify(purposeUsage),
        blocked_endpoints: JSON.stringify(breakers),
        ...(messages.length ? { alerts, notes: messages.join(' · ').slice(0, 400) } : {}),
        minute_key: bucket,
        minute_used: recentCalls + cost,
        rate_limit_strikes: 0,
        ...(result.quota?.limit !== null && result.quota?.limit !== undefined ? { provider_limit: result.quota.limit } : {}),
        ...(result.quota?.remaining !== null && result.quota?.remaining !== undefined ? { provider_remaining: result.quota.remaining } : {}),
        ...(result.quota?.used !== null && result.quota?.used !== undefined ? { provider_used: result.quota.used } : {}),
        last_status_at: nowIso,
        last_status_code: 200,
      });

      // 10) Registro da requisição real: base da janela por minuto e do
      // dashboard de consumo por endpoint e finalidade.
      await db.ApiUsageLog.create({
        provider: 'api_football',
        endpoint: String(endpoint || ''),
        purpose: bucketPurpose,
        status_code: result.status || 200,
        duration_ms: durationMs,
        records_returned: Number(result.results) || 0,
        cache_hit: false,
        credits_used: cost,
        rate_limit_remaining: result.quota?.remaining ?? null,
        retry_count: 0,
        params: purpose || label || '',
        note: LEDGER_NOTE,
        error_message: '',
      }).catch(() => null);

      return result;
    },
  };
  return client;
}
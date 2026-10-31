/**
 * Coletor único da API-Football: toda chamada externa do sistema passa por
 * aqui. Nenhuma rotina fala com o provedor por conta própria, o que garante um
 * único ponto de controle de consumo.
 *
 * Plano contratado: Pro — 300 requisições/minuto e 7.500/dia. A camada aplica,
 * nesta ordem, antes de cada chamada:
 *
 * 1. **disjuntor por endpoint** — endpoint que recebeu 429 fica bloqueado com
 *    backoff de 30/60/120/300 s e as rotinas seguem servindo o cache;
 * 2. **pausa global** — após 429, ou quando o minuto está saturado, nenhuma
 *    rotina chama a API até o horário registrado;
 * 3. **teto por minuto** — 240 (80% dos 300 do plano), reduzido ao que o
 *    provedor informar em X-RateLimit-Limit. Contador compartilhado no dia;
 * 4. **X-RateLimit-Remaining** — abaixo de 50 requisições restantes o minuto
 *    está comprometido: pausa até o próximo minuto, sem gastar a folga;
 * 5. **orçamento diário** por faixa e por finalidade (40/30/20/10%) e token
 *    bucket global a partir de x-ratelimit-requests-remaining;
 * 6. **fila serializada com 200 ms entre chamadas** (requestQueue), que
 *    sozinha limita o ritmo a 300 req/min e prioriza placar ao vivo;
 * 7. **cache por execução** — a mesma chamada (endpoint + parâmetros) nunca é
 *    repetida dentro da mesma execução.
 *
 * Em 429 a chamada é retentada **somente depois do minuto seguinte**, com
 * backoff exponencial; se essa espera não couber no orçamento de tempo da
 * execução, a rotina para e o ciclo agendado seguinte assume.
 */
import { FootballRateLimitError, apiFootballFetch, isRateLimitErrorText } from './apiFootball.ts';
import {
  CIRCUIT_BREAKER_STEPS,
  FOOTBALL_BUDGET_GUARD,
  FOOTBALL_LIMITS,
  MIN_CALL_GAP_MS,
  PROVIDER_MINUTE_LIMIT,
  PROVIDER_MINUTE_SAFETY,
  RATE_LIMIT_MINUTE_RESERVE,
  RETRY_POLICY,
  THROTTLE_PAUSE_STEPS,
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
import { priorityFor, requestQueue, sleep } from './requestQueue.ts';

/** Limite interno de requisições por minuto (definido em footballConfig). */
export const DEFAULT_MINUTE_LIMIT = FOOTBALL_LIMITS.minuteRequests;
/** Marca das linhas de registro de cada requisição real enviada ao provedor. */
const LEDGER_NOTE = 'ledger';

/** Pausa pós-429 ainda ativa: nenhuma chamada é feita até este horário. */
export class FootballPausedError extends Error {
  untilIso: string;
  constructor(untilIso: string) {
    super(`API-Football em pausa de segurança até ${untilIso}`);
    this.name = 'FootballPausedError';
    this.untilIso = untilIso;
  }
}

/** Limite por minuto atingido: rotinas param até o próximo minuto. */
export class FootballMinuteLimitError extends Error {
  constructor(limit: number) {
    super(`Limite interno de ${limit} requisições por minuto atingido`);
    this.name = 'FootballMinuteLimitError';
  }
}

/** Orçamento diário (total, por finalidade ou de tokens) esgotado. */
export class FootballBudgetError extends Error {
  constructor(used: number, limit: number) {
    super(`Orçamento reservado: ${used}/${limit}`);
    this.name = 'FootballBudgetError';
  }
}

/** Disjuntor aberto para o endpoint: usar apenas dados de cache. */
export class FootballCircuitOpenError extends Error {
  endpoint: string;
  untilIso: string;
  constructor(endpoint: string, untilIso: string) {
    super(`Disjuntor aberto em ${endpoint} até ${untilIso} — usando cache`);
    this.name = 'FootballCircuitOpenError';
    this.endpoint = endpoint;
    this.untilIso = untilIso;
  }
}

/** Erros que exigem parar imediatamente as chamadas (não são retentados). */
export function isThrottleError(error: any) {
  return (
    error instanceof FootballRateLimitError ||
    error instanceof FootballPausedError ||
    error instanceof FootballMinuteLimitError ||
    error instanceof FootballBudgetError ||
    error instanceof FootballCircuitOpenError
  );
}

/** Chave do minuto corrente (UTC): contador por minuto compartilhado. */
export function minuteBucketKey(nowMs: number) {
  return new Date(nowMs).toISOString().slice(0, 16);
}

/** Instante em que o minuto corrente libera, com folga e variação aleatória. */
export function nextMinuteAt(nowMs = Date.now()) {
  return nowMs - (nowMs % 60000) + 60000 + 1000 + Math.floor(Math.random() * 2000);
}

/**
 * Limite por minuto efetivo. O painel pode reduzir, nunca aumentar: o valor é
 * limitado pelo teto interno (240/min), pela margem do plano Pro (300/min) e
 * pelo limite que o provedor informou em X-RateLimit-Limit.
 */
export function effectiveMinuteLimit(settings: any, providerMinuteLimit: number | null = null) {
  const planCap = Math.floor(PROVIDER_MINUTE_LIMIT * PROVIDER_MINUTE_SAFETY);
  const provider = Number(providerMinuteLimit);
  const providerCap =
    Number.isFinite(provider) && provider > 0 ? Math.floor(provider * PROVIDER_MINUTE_SAFETY) : planCap;
  const configured = Number(settings?.football_minute_limit);
  const base = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MINUTE_LIMIT;
  return Math.max(1, Math.min(base, DEFAULT_MINUTE_LIMIT, planCap, providerCap));
}

/** Endpoint sem parâmetros: chave do disjuntor. */
function endpointKey(endpoint: string) {
  return String(endpoint || '').split('?')[0] || '/';
}

/** Disjuntores abertos (JSON tolerante a registros antigos). */
function readBreakers(record: any) {
  try {
    const parsed = JSON.parse(record?.blocked_endpoints || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** X-RateLimit-Remaining do minuto corrente, quando a leitura é do mesmo minuto. */
function providerMinuteLeft(record: any, bucket: string) {
  const atMs = Date.parse(record?.provider_minute_at || '');
  if (!Number.isFinite(atMs) || minuteBucketKey(atMs) !== bucket) return null;
  const left = Number(record?.provider_minute_remaining);
  return Number.isFinite(left) ? left : null;
}

/**
 * Abre o cliente central da execução. O estado (registro de cota) é relido a
 * cada chamada: rotinas concorrentes compartilham token bucket, contador por
 * minuto, disjuntores e orçamento por finalidade.
 */
export async function openFootballClient(
  db: any,
  { apiKey, base, settings, day, limit, reserve = 0, label = '' }: any,
) {
  const queue = requestQueue();
  let record = await loadQuota(db, day);
  let used = Number(record?.used || 0);
  /** Cache da execução: a mesma chamada nunca sai duas vezes. */
  const memo = new Map<string, any>();

  async function persist(patch: any) {
    record = await saveQuota(db, record, { ...(record?.id ? {} : { day }), ...patch });
    if (Number.isFinite(Number(record?.used))) used = Number(record.used);
    return record;
  }

  /** Registra o 429: pausa global (até o próximo minuto) + disjuntor do endpoint. */
  async function registerRateLimit({ endpoint, retryAfterMs, message }: any) {
    const nowMs = Date.now();
    const strikes = Number(record?.rate_limit_strikes || 0) + 1;
    const stepSeconds = THROTTLE_PAUSE_STEPS[Math.min(strikes - 1, THROTTLE_PAUSE_STEPS.length - 1)];
    const untilNextMinute = nextMinuteAt(nowMs) - nowMs;
    const jitter = 0.9 + Math.random() * 0.2;
    const pauseMs = Math.max(
      Number(retryAfterMs) || 0,
      untilNextMinute,
      Math.round(stepSeconds * 1000 * jitter),
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
      note: `limite excedido · degrau ${strikes} · disjuntor ${openSeconds}s · espera até o próximo minuto`,
      error_message: String(message || 'Too many requests').slice(0, 240),
    }).catch(() => null);
    return untilIso;
  }

  /**
   * Uma tentativa completa: todos os controles, a reserva do minuto e a
   * chamada. Nunca retenta — a retentativa é decidida em `call`.
   */
  async function sendOnce(
    endpoint: string,
    params: any = {},
    { cost = 1, timeoutMs, purpose = label } = {} as any,
  ) {
    const fresh = await loadQuota(db, day);
    if (fresh) {
      record = fresh;
      used = Number(record.used || 0);
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const bucket = minuteBucketKey(nowMs);
    const bucketPurpose = budgetPurpose(purpose);

    // 1) Disjuntor do endpoint aberto: a rotina usa o cache.
    const key = endpointKey(endpoint);
    const breaker = readBreakers(record)?.[key];
    if (breaker?.until && Date.parse(breaker.until) > nowMs) {
      throw new FootballCircuitOpenError(key, breaker.until);
    }

    // 2) Pausa global (429 ou minuto saturado).
    const pauseMs = Date.parse(record?.rate_pause_until || '');
    if (Number.isFinite(pauseMs) && pauseMs > nowMs) {
      throw new FootballPausedError(record.rate_pause_until);
    }

    // 3) Teto por minuto: contador compartilhado por todas as rotinas.
    const minuteLimit = effectiveMinuteLimit(settings, record?.provider_minute_limit);
    const reserved = record?.minute_key === bucket ? Number(record?.minute_used || 0) : 0;
    if (reserved + cost > minuteLimit) {
      const untilIso = new Date(nextMinuteAt(nowMs)).toISOString();
      await persist({ rate_pause_until: untilIso, minute_key: bucket, minute_used: reserved });
      throw new FootballMinuteLimitError(minuteLimit);
    }

    // 4) X-RateLimit-Remaining: abaixo da reserva, o minuto está comprometido.
    const providerLeft = providerMinuteLeft(record, bucket);
    if (providerLeft !== null && providerLeft - cost < RATE_LIMIT_MINUTE_RESERVE) {
      const untilIso = new Date(nextMinuteAt(nowMs)).toISOString();
      await persist({
        rate_pause_until: untilIso,
        minute_key: bucket,
        minute_used: reserved,
        last_error: `X-RateLimit-Remaining ${providerLeft} < ${RATE_LIMIT_MINUTE_RESERVE} · pausa até o próximo minuto`,
      });
      throw new FootballPausedError(untilIso);
    }

    // 5) Orçamento diário total, com a reserva da faixa.
    if (!canSpend(used, limit, reserve, cost)) {
      throw new FootballBudgetError(used, limit);
    }

    // 6) Contenção por faixa: 80% suspende cotações normais, 90% mantém só
    // o essencial (jogos críticos e apuração de resultados).
    const percent = Number(limit) > 0 ? (used / Number(limit)) * 100 : 0;
    const critical = String(purpose || '').toUpperCase() === 'CRITICA';
    if (percent >= FOOTBALL_BUDGET_GUARD.criticalOnly) {
      const essential = bucketPurpose === 'live' || bucketPurpose === 'audit';
      if (!essential) throw new FootballBudgetError(used, limit);
    } else if (percent >= FOOTBALL_BUDGET_GUARD.suspendOdds) {
      if (bucketPurpose === 'odds') throw new FootballBudgetError(used, limit);
    }

    // 7) Orçamento próprio da finalidade.
    if (!canSpendPurpose(record, limit, bucketPurpose, cost)) {
      throw new FootballBudgetError(used, limit);
    }

    // 8) Token bucket global: sem token do provedor, nenhuma chamada.
    const tokens = Number(record?.provider_remaining);
    if (Number.isFinite(tokens) && tokens - cost < TOKEN_BUCKET_RESERVE) {
      throw new FootballBudgetError(used, limit);
    }

    // 9) Espaçamento global: 200 ms entre a chamada anterior e esta.
    const lastCallMs = Date.parse(record?.last_call_at || '');
    if (Number.isFinite(lastCallMs)) {
      const gapWait = lastCallMs + MIN_CALL_GAP_MS - Date.now();
      if (gapWait > 0) await sleep(gapWait);
    }

    // 10) Reserva do minuto antes de enviar: nenhuma execução concorrente
    // enxerga o mesmo espaço livre.
    await persist({
      last_call_at: new Date().toISOString(),
      minute_key: bucket,
      minute_used: reserved + cost,
    });

    // 11) A chamada em si, cronometrada.
    const startedAt = Date.now();
    let result: any;
    try {
      result = await apiFootballFetch(apiKey, endpoint, params, {
        base,
        ...(timeoutMs ? { timeoutMs } : {}),
      });
    } catch (error: any) {
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

    // 12) Limite reportado no corpo (HTTP 200): mesmo tratamento do 429.
    if (result.errors.some(isRateLimitErrorText)) {
      const message = result.errors.filter(isRateLimitErrorText).join(' | ');
      await registerRateLimit({ endpoint, retryAfterMs: null, message });
      throw new FootballRateLimitError(message);
    }

    // 13) Cobrança diária + por finalidade + tokens do provedor numa escrita.
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
      rate_limit_strikes: 0,
      // A chamada passou: o minuto tem folga novamente.
      rate_pause_until: null,
      ...(result.quota?.limit !== null && result.quota?.limit !== undefined
        ? { provider_limit: result.quota.limit }
        : {}),
      ...(result.quota?.remaining !== null && result.quota?.remaining !== undefined
        ? { provider_remaining: result.quota.remaining }
        : {}),
      ...(result.quota?.used !== null && result.quota?.used !== undefined
        ? { provider_used: result.quota.used }
        : {}),
      ...(result.quota?.minuteLimit !== null && result.quota?.minuteLimit !== undefined
        ? { provider_minute_limit: result.quota.minuteLimit }
        : {}),
      ...(result.quota?.minuteRemaining !== null && result.quota?.minuteRemaining !== undefined
        ? { provider_minute_remaining: result.quota.minuteRemaining, provider_minute_at: nowIso }
        : {}),
      last_status_at: nowIso,
      last_status_code: 200,
    });

    // 14) Registro da requisição real: base do dashboard de consumo.
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
  }

  /**
   * Enfileira a chamada (200 ms de espaçamento, prioridade por finalidade) e
   * trata o 429: espera o próximo minuto com backoff exponencial e retenta uma
   * única vez. Se a espera não couber no orçamento da execução, devolve o erro
   * para a rotina servir o cache e o ciclo seguinte assumir.
   */
  async function call(
    endpoint: string,
    params: any = {},
    { cost = 1, timeoutMs, purpose = label, priority, attempts } = {} as any,
  ) {
    const memoKey = `${endpoint}|${JSON.stringify(params)}`;
    if (memo.has(memoKey)) return memo.get(memoKey);

    const maxAttempts = Math.max(1, Math.min(Number(attempts) || RETRY_POLICY.maxAttempts, 4));
    const jobPriority = priorityFor(purpose, priority);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await queue.push(jobPriority, () =>
          sendOnce(endpoint, params, { cost, timeoutMs, purpose }),
        );
        memo.set(memoKey, result);
        return result;
      } catch (error: any) {
        // Somente 429 é retentado: repetir qualquer outro erro não ajuda.
        if (!(error instanceof FootballRateLimitError) || attempt >= maxAttempts) throw error;

        const pauseAtMs = Date.parse(record?.rate_pause_until || '');
        const untilNextMinute = nextMinuteAt() - Date.now();
        const backoffMs = RETRY_POLICY.baseMs * 2 ** (attempt - 1) * (0.9 + Math.random() * 0.2);
        const waitMs = Math.max(
          Number.isFinite(pauseAtMs) ? pauseAtMs - Date.now() + 250 : 0,
          untilNextMinute,
          backoffMs,
        );
        // Fora do orçamento da execução: parar é melhor que estourar o tempo.
        if (waitMs > RETRY_POLICY.maxWaitMs) throw error;
        await sleep(waitMs);
      }
    }
    throw new FootballBudgetError(used, limit);
  }

  return {
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
    call,
  };
}
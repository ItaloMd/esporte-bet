/**
 * Portão único de requisições da API-Football.
 *
 * Toda chamada externa do sistema passa por aqui. Nenhuma rotina fala com o
 * provedor por conta própria — o que garante um único ponto de controle:
 *
 * - FILA GLOBAL: cada chamada reserva o próximo slot com o espaçamento
 *   calculado a partir do limite por minuto (230 ms, ~260/min). O slot vive no
 *   registro de cota do dia e vale para rotinas agendadas e para o painel.
 * - JANELA DE 60 s: contador compartilhado com teto de 90% do plano (270/min) e
 *   leitura de `X-RateLimit-Remaining`. Perto de zero, a janela é fechada e a
 *   fila espera o próximo minuto — sem tentar de novo às cegas.
 * - DOIS LIMITES DISTINTOS, como na documentação: `x-ratelimit-requests-*` é o
 *   saldo DIÁRIO e `X-RateLimit-*` é o limite POR MINUTO. Estourar o diário
 *   para toda a coleta até a virada do dia (00:00 UTC); estourar o minuto
 *   apenas pausa até o próximo minuto. Confundir os dois era o que gerava a
 *   cascata de 429.
 * - 429 NUNCA É RETENTADO: repetir a chamada só consome mais uma requisição do
 *   mesmo minuto. A rotina para e serve o cache; o próximo ciclo retoma.
 * - ORÇAMENTO DIÁRIO interno com reserva por finalidade (placar 40%, cotações
 *   35%, apuração 25%) para que uma rotina nunca consuma a cota de outra.
 * - REGISTRO de cada requisição real (endpoint, finalidade, tempo, créditos e
 *   saldo informado pelo provedor) — base do painel administrativo.
 */
import {
  FootballAuthError,
  FootballProviderError,
  FootballRateLimitError,
  apiFootballFetch,
} from './apiFootball.ts';
import {
  FOOTBALL_BUDGET_GUARD,
  FOOTBALL_LIMITS,
  PROVIDER_DAILY_FLOOR,
  RATE_LIMIT_PAUSE_MIN_MS,
  cacheKeyFor,
  cacheTtlSeconds,
  nextProviderDayStartMs,
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
import { breakerFailurePatch, breakerState, breakerSuccessPatch, isTransientFailure } from './footballCircuit.ts';
import {
  DEFAULT_MINUTE_LIMIT,
  RECOVERY_SUCCESSES,
  clampGap,
  effectiveMinuteLimit,
  gapAfterRateLimit,
  gapAfterSuccess,
  minuteBucketKey,
  minuteWindowUsed,
  nextMinuteStart,
  nextSecondStart,
  paceGapMs,
  planRequestSlot,
  providerMinuteBlocked,
  secondBucketKey,
  secondWindowUsed,
  sleep,
} from './footballQueue.ts';

export { DEFAULT_MINUTE_LIMIT, effectiveMinuteLimit, minuteBucketKey };

/** Marca das linhas de registro de cada requisição real enviada ao provedor. */
const LEDGER_NOTE = 'ledger';

/** Validade da marca de "busca em andamento" usada contra chamadas simultâneas. */
const INFLIGHT_TTL_MS = 25000;

/** Teto de tamanho do payload guardado no cache compartilhado (caracteres). */
const MAX_CACHE_CHARS = 250000;

/** Intervalo mínimo entre gravações de métricas (evita excesso de escritas). */
const METRICS_FLUSH_MS = 5000;

/** Espera pela resposta de outra execução: tentativas e intervalo. */
const SHARED_WAIT_ATTEMPTS = 3;
const SHARED_WAIT_MS = 350;

/** Rodadas de espera quando a janela de 1 s está cheia. */
const SECOND_WAIT_ROUNDS = 4;

/** Pausa por limite de minuto ainda ativa: nenhuma chamada até este horário. */
export class FootballPausedError extends Error {
  constructor(untilIso) {
    super(`API-Football em pausa até ${untilIso} (limite por minuto)`);
    this.name = 'FootballPausedError';
    this.untilIso = untilIso;
  }
}

/** Limite por minuto atingido: rotinas param até o próximo minuto. */
export class FootballMinuteLimitError extends Error {
  constructor(limit, untilIso = null) {
    super(
      `Teto de ${limit} requisições/minuto atingido${untilIso ? ` · fila reabre em ${untilIso}` : ''}`,
    );
    this.name = 'FootballMinuteLimitError';
    this.limit = limit;
    this.untilIso = untilIso;
  }
}

/**
 * Saldo diário do provedor esgotado. Diferente do limite por minuto: nenhuma
 * chamada é feita até a virada do dia na conta API-SPORTS.
 */
export class FootballDailyLimitError extends Error {
  constructor(message, untilIso = null) {
    super(String(message || 'Saldo diário da API-Football esgotado'));
    this.name = 'FootballDailyLimitError';
    this.untilIso = untilIso;
  }
}

/** Orçamento diário interno (total ou por finalidade) esgotado. */
export class FootballBudgetError extends Error {
  constructor(used, limit) {
    super(`Orçamento reservado: ${used}/${limit}`);
    this.name = 'FootballBudgetError';
  }
}

/**
 * Disjuntor aberto: o provedor falhou de forma repetida (indisponibilidade,
 * tempo esgotado ou rede). Nenhuma chamada é feita até o fim do cooldown —
 * repetir aqui só gastaria requisição e tempo de execução.
 */
export class FootballCircuitError extends Error {
  constructor(untilIso, reason = '') {
    super(`Disjuntor do provedor aberto até ${untilIso}${reason ? ` · ${reason}` : ''}`);
    this.name = 'FootballCircuitError';
    this.untilIso = untilIso;
  }
}

/** Erros que exigem parar imediatamente as chamadas (não são retentados). */
export function isThrottleError(error) {
  return (
    error instanceof FootballRateLimitError ||
    error instanceof FootballPausedError ||
    error instanceof FootballMinuteLimitError ||
    error instanceof FootballDailyLimitError ||
    error instanceof FootballBudgetError ||
    error instanceof FootballCircuitError
  );
}

/** Verdadeiro quando o erro é de configuração (chave/plano) e exige correção. */
export function isConfigurationError(error) {
  return error instanceof FootballAuthError || error instanceof FootballProviderError;
}

/**
 * Abre o cliente central da execução. O estado (registro de cota) é relido a
 * cada chamada: rotinas concorrentes compartilham o mesmo balde por minuto, o
 * mesmo slot de fila e o mesmo orçamento.
 */
export async function openFootballClient(db, { apiKey, base, settings, day, limit, reserve = 0, label = '' }) {
  let record = await loadQuota(db, day);
  let used = Number(record?.used || 0);
  const dailyLimit = Number(limit) || 0;

  async function persist(patch) {
    record = await saveQuota(db, record, { ...(record?.id ? {} : { day }), ...patch });
    if (Number.isFinite(Number(record?.used))) used = Number(record.used);
    return record;
  }

  function log(entry) {
    return db.ApiUsageLog.create({ provider: 'api_football', ...entry }).catch(() => null);
  }

  /* --------------- métricas reais do dia (base do painel) --------------- */

  const pendingMetrics = {};
  let metricsFlushedAt = 0;

  /** Acumula uma contagem: as escritas são agrupadas, nunca uma por evento. */
  function countMetric(key, amount = 1) {
    pendingMetrics[key] = (pendingMetrics[key] || 0) + Number(amount);
  }

  /** Contagens pendentes como valores absolutos, prontas para o próximo persist. */
  function metricsFields() {
    const patch = {};
    Object.keys(pendingMetrics).forEach((key) => {
      patch[key] = Number(record?.[key] || 0) + pendingMetrics[key];
      delete pendingMetrics[key];
    });
    return patch;
  }

  /** Grava as contagens pendentes (limitado a uma escrita a cada 5 s). */
  async function flushMetrics({ force = false } = {}) {
    if (!Object.keys(pendingMetrics).length) return;
    if (!force && Date.now() - metricsFlushedAt < METRICS_FLUSH_MS) return;
    const latest = await loadQuota(db, day).catch(() => null);
    if (latest) {
      record = latest;
      used = Number(latest.used || 0);
    }
    metricsFlushedAt = Date.now();
    await persist(metricsFields());
  }

  /* ------------- cache compartilhado e deduplicação de chamadas ------------- */

  const inflightKeyOf = (key) => `inflight:${key}`;

  /** Lê, numa única consulta, o payload em cache e a marca de busca paralela. */
  async function readCacheState(key) {
    const page = await db.ApiCache
      .filter({ provider: 'api_football', key: { $in: [key, inflightKeyOf(key)] } }, { limit: 2 })
      .catch(() => null);
    const rows = page?.items || [];
    const payloadRow = rows.find((row) => row.key === key) || null;
    const inflightRow = rows.find((row) => row.key === inflightKeyOf(key)) || null;
    let payload = null;
    if (payloadRow?.note && payloadRow.note.startsWith('{')) {
      try {
        payload = JSON.parse(payloadRow.note);
      } catch {
        payload = null;
      }
    }
    const fresh = Boolean(payload && payloadRow?.expires_at && Date.parse(payloadRow.expires_at) > Date.now());
    return {
      payload: fresh ? payload : null,
      fetched_at: payloadRow?.fetched_at || null,
      row_id: payloadRow?.id || null,
      inflight: Boolean(
        inflightRow?.fetched_at && Date.parse(inflightRow.fetched_at) > Date.now() - INFLIGHT_TTL_MS,
      ),
    };
  }

  /** Grava a resposta no cache compartilhado com a validade da classe de dado. */
  async function writeCached(key, endpoint, params, ttlSeconds, payload, rowId) {
    let encoded = '';
    try {
      encoded = JSON.stringify(payload);
    } catch {
      encoded = '';
    }
    const now = new Date();
    const data = {
      provider: 'api_football',
      key,
      endpoint,
      params: JSON.stringify(params || {}),
      records: Number(payload?.results) || 0,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + Number(ttlSeconds) * 1000).toISOString(),
      last_ok_at: now.toISOString(),
      note: encoded && encoded.length <= MAX_CACHE_CHARS ? encoded : 'resposta grande demais para o cache compartilhado',
    };
    if (rowId) return db.ApiCache.update(rowId, data).catch(() => null);
    return db.ApiCache.create(data).catch(() => null);
  }

  async function markInflight(key) {
    return db.ApiCache
      .create({
        provider: 'api_football',
        key: inflightKeyOf(key),
        endpoint: 'inflight',
        params: String(key).slice(0, 400),
        records: 0,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + INFLIGHT_TTL_MS).toISOString(),
        note: 'busca em andamento por outra execução',
      })
      .catch(() => null);
  }

  async function clearInflight(key) {
    return db.ApiCache.deleteMany({ provider: 'api_football', key: inflightKeyOf(key) }).catch(() => null);
  }

  /** Espera a resposta da execução que já está buscando o mesmo dado. */
  async function waitForShared(key) {
    for (let attempt = 0; attempt < SHARED_WAIT_ATTEMPTS; attempt += 1) {
      await sleep(SHARED_WAIT_MS);
      const state = await readCacheState(key);
      if (state.payload) return state;
      if (!state.inflight) return null;
    }
    return null;
  }

  /**
   * Fecha o minuto corrente: nenhuma rotina chama o provedor até o próximo.
   * Quando o provedor informa `Retry-After`, esse tempo é respeitado — esperar
   * menos que o pedido garante outro 429 na volta.
   */
  async function pauseMinute(reason, { countStrike = true, retryAfterMs = null } = {}) {
    const nowMs = Date.now();
    const requested = Number.isFinite(retryAfterMs) ? nowMs + Math.max(0, Number(retryAfterMs)) : 0;
    const strikes = countStrike ? Number(record?.rate_limit_strikes || 0) + 1 : Number(record?.rate_limit_strikes || 0);
    // Recusas seguidas: o silêncio cresce além do próximo minuto (2, 4, 8… até
    // 30 min). Tentar de novo a cada minuto gastava uma requisição por ciclo e
    // recebia outro 429 — o provedor conta a rajada além da janela do minuto.
    const escalationMs = strikes <= 2 ? 0 : Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** (strikes - 2));
    const until = new Date(
      Math.max(nextMinuteStart(nowMs), nowMs + RATE_LIMIT_PAUSE_MIN_MS, requested, nowMs + escalationMs),
    ).toISOString();
    await persist({
      rate_pause_until: until,
      rate_limit_strikes: strikes,
      last_rate_limited_at: new Date(nowMs).toISOString(),
      last_rate_scope: 'minute',
      last_error: String(reason).slice(0, 240),
      last_error_scope: 'minute',
      // O espaçamento aprendido dobra a cada recusa e fica gravado: o próximo
      // ciclo (ou o painel) já sai mais lento, sem repetir a rajada.
      request_gap_ms: gapAfterRateLimit(
        record?.request_gap_ms || paceGapMs(effectiveMinuteLimit(settings, record?.provider_minute_limit)),
      ),
      success_streak: 0,
    });
    return until;
  }

  /**
   * Bloqueia a coleta. O provedor usa a mesma mensagem ("limite diário") tanto
   * para a cota do dia quanto para o bloqueio temporário do firewall por
   * excesso de requisições. Quando ainda há saldo nos cabeçalhos, o bloqueio é
   * tratado como temporário, com espera escalonada (30 min dobrando até 6 h) em
   * vez de parar o dia inteiro; sem saldo, vale até a virada do dia.
   */
  async function blockDay(reason, { quotaEmpty = false } = {}) {
    const nowMs = Date.now();
    const strikes = Number(record?.rate_limit_strikes || 0) + 1;
    const cooldownMs = Math.min(6 * 60 * 60 * 1000, 30 * 60 * 1000 * 2 ** Math.min(strikes - 1, 3));
    const untilIso = new Date(
      quotaEmpty
        ? nextProviderDayStartMs(nowMs)
        : Math.min(nextProviderDayStartMs(nowMs), nowMs + cooldownMs),
    ).toISOString();
    await persist({
      daily_blocked_until: untilIso,
      daily_blocked_at: new Date(nowMs).toISOString(),
      rate_limit_strikes: strikes,
      last_rate_limited_at: new Date(nowMs).toISOString(),
      last_rate_scope: 'daily',
      last_error: String(reason).slice(0, 240),
      last_error_scope: quotaEmpty ? 'daily' : 'throttle',
      request_gap_ms: gapAfterRateLimit(
        record?.request_gap_ms || paceGapMs(effectiveMinuteLimit(settings, record?.provider_minute_limit)),
      ),
      success_streak: 0,
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
    get limit() {
      return dailyLimit;
    },
    get remaining() {
      const raw = record?.provider_remaining;
      const providerRemaining =
        raw === null || raw === undefined || raw === '' ? null : Number(raw);
      if (providerRemaining !== null && Number.isFinite(providerRemaining)) return providerRemaining;
      return Math.max(0, dailyLimit - used);
    },
    get minuteLimit() {
      return effectiveMinuteLimit(settings, record?.provider_minute_limit);
    },
    get pausedUntil() {
      return record?.rate_pause_until || null;
    },
    /** Estado do disjuntor (aberto/fechado, falhas, cooldown). */
    get breaker() {
      return breakerState(record);
    },
    get dailyBlockedUntil() {
      return record?.daily_blocked_until || null;
    },

    /**
     * Executa uma chamada passando por todo o portão. `charge: false` serve ao
     * `/status`, que não consome cota diária mas ocupa a janela do minuto.
     */
    async call(endpoint, params = {}, { cost = 1, timeoutMs, purpose = label, priority, charge = true, cache = true } = {}) {
      const bucketPurpose = budgetPurpose(purpose);
      const path = String(endpoint || '');

      // Estado sempre fresco: várias execuções compartilham o mesmo registro.
      const fresh = await loadQuota(db, day);
      if (fresh) {
        record = fresh;
        used = Number(record.used || 0);
      }

      // 0) Cache compartilhado ANTES de qualquer trava: servir cache não
      // consome cota, não entra na fila e mantém as telas de pé mesmo com o
      // provedor em 429. A chave é o endpoint + parâmetros ordenados.
      const ttlSeconds = cacheTtlSeconds(path, params);
      const cacheKey = cacheKeyFor(path, params);
      const useCache = Boolean(charge && cache && ttlSeconds > 0);
      let cacheRowId = null;
      if (useCache) {
        const state = await readCacheState(cacheKey);
        cacheRowId = state.row_id;
        if (state.payload) {
          countMetric('cache_hits');
          await flushMetrics();
          return {
            data: state.payload,
            quota: null,
            status: 200,
            errors: [],
            results: Number(state.payload?.results) || 0,
            cached: true,
            cached_at: state.fetched_at,
          };
        }
        countMetric('cache_misses');
        // Mesma consulta já em andamento em outra execução: espera o resultado
        // dela em vez de disparar uma segunda requisição idêntica.
        if (state.inflight) {
          const shared = await waitForShared(cacheKey);
          if (shared?.payload) {
            countMetric('dedupe_hits');
            countMetric('cache_hits');
            await flushMetrics();
            return {
              data: shared.payload,
              quota: null,
              status: 200,
              errors: [],
              results: Number(shared.payload?.results) || 0,
              cached: true,
              shared: true,
              cached_at: shared.fetched_at,
            };
          }
        }
        await markInflight(cacheKey);
      }

      const nowMs = Date.now();
      const bucket = minuteBucketKey(nowMs);

      // 0b) Disjuntor: falha repetida de infraestrutura suspende as chamadas.
      // Fica depois do cache de propósito — servir cache continua funcionando
      // com o provedor fora do ar.
      const circuit = breakerState(record, nowMs);
      if (circuit.open) throw new FootballCircuitError(circuit.until, circuit.reason);

      // 1) Bloqueio ativo (cota do dia esgotada ou recusa temporária do
      // provedor): nada é chamado até o horário registrado.
      const dayBlockMs = Date.parse(record?.daily_blocked_until || '');
      if (Number.isFinite(dayBlockMs) && dayBlockMs > nowMs) {
        const throttled = record?.last_error_scope === 'throttle';
        throw new FootballDailyLimitError(
          throttled
            ? `Provedor recusando o tráfego · coleta retoma em ${record.daily_blocked_until}`
            : `Saldo diário da API-Football esgotado · coleta retoma em ${record.daily_blocked_until}`,
          record.daily_blocked_until,
        );
      }

      // 2) Minuto fechado por limite: espera o próximo minuto.
      const pauseMs = Date.parse(record?.rate_pause_until || '');
      if (Number.isFinite(pauseMs) && pauseMs > nowMs) {
        throw new FootballPausedError(record.rate_pause_until);
      }

      // 3) Saldo diário informado pelo provedor é a fonte da verdade. Valor
      // nulo significa "desconhecido" (não zero): não bloqueia por aqui.
      const rawRemaining = record?.provider_remaining;
      const providerRemaining =
        rawRemaining === null || rawRemaining === undefined || rawRemaining === '' ? null : Number(rawRemaining);
      if (charge && providerRemaining !== null && Number.isFinite(providerRemaining) && providerRemaining <= PROVIDER_DAILY_FLOOR) {
        const untilIso = await blockDay(
          `saldo diário do provedor em ${providerRemaining} requisição(ões)`,
          { quotaEmpty: true },
        );
        throw new FootballDailyLimitError(
          `Saldo diário da API-Football em ${providerRemaining} · coleta retoma em ${untilIso}`,
          untilIso,
        );
      }

      // 4) Orçamento interno: total, faixas de contenção e cota da finalidade.
      if (charge) {
        if (!canSpend(used, dailyLimit, reserve, cost)) throw new FootballBudgetError(used, dailyLimit);
        const percent = dailyLimit > 0 ? (used / dailyLimit) * 100 : 0;
        const essential = bucketPurpose === 'live' || bucketPurpose === 'audit';
        const critical = priority === 'CRITICA';
        if (percent >= FOOTBALL_BUDGET_GUARD.criticalOnly && !essential && !critical) {
          throw new FootballBudgetError(used, dailyLimit);
        }
        if (percent >= FOOTBALL_BUDGET_GUARD.suspendOdds && bucketPurpose === 'odds' && !critical) {
          throw new FootballBudgetError(used, dailyLimit);
        }
        if (!canSpendPurpose(record, dailyLimit, bucketPurpose, cost)) throw new FootballBudgetError(used, dailyLimit);
      }

      // 5) Janela de 60 s: contador compartilhado + saldo do minuto no provedor.
      const minuteLimit = effectiveMinuteLimit(settings, record?.provider_minute_limit);
      const windowUsed = minuteWindowUsed(record, nowMs);
      if (providerMinuteBlocked(record, nowMs, cost)) {
        const untilIso = await pauseMinute('X-RateLimit-Remaining do minuto próximo de zero');
        throw new FootballMinuteLimitError(minuteLimit, untilIso);
      }
      if (windowUsed + cost > minuteLimit) {
        const untilIso = await pauseMinute(`teto de ${minuteLimit} requisições/minuto atingido`);
        throw new FootballMinuteLimitError(minuteLimit, untilIso);
      }

      // 6) Janela de 1 s: o plano permite 5/s e o teto interno é 4/s. O
      // espaçamento sozinho não protege duas execuções simultâneas, que podem
      // disparar no mesmo segundo.
      const secondLimit = FOOTBALL_LIMITS.secondRequests;
      let secondNow = Date.now();
      let secondUsed = secondWindowUsed(record, secondNow);
      for (let attempt = 0; secondUsed + cost > secondLimit && attempt < SECOND_WAIT_ROUNDS; attempt += 1) {
        await sleep(Math.max(60, nextSecondStart(secondNow) - secondNow));
        const afterSecond = await loadQuota(db, day).catch(() => null);
        if (afterSecond) {
          record = afterSecond;
          used = Number(record.used || 0);
        }
        secondNow = Date.now();
        secondUsed = secondWindowUsed(record, secondNow);
      }

      // 7) Fila: o espaçamento aprendido (persistido no registro do dia) define
      // o próximo slot. O piso é 230 ms; depois de uma recusa ele dobra.
      const gap = clampGap(Number(record?.request_gap_ms) || paceGapMs(minuteLimit));
      const slot = planRequestSlot(record?.last_slot_at, secondNow, gap);
      const slotIso = new Date(slot.atMs).toISOString();
      await persist({
        last_slot_at: slotIso,
        second_key: secondBucketKey(secondNow),
        second_used: Math.min(secondLimit, secondUsed + cost),
      });
      await sleep(slot.waitMs);

      // 6b) Enquanto esperávamos, outra execução pode ter fechado o minuto.
      const afterWait = await loadQuota(db, day);
      if (afterWait) {
        record = afterWait;
        used = Number(record.used || 0);
        const pausedMs = Date.parse(record?.rate_pause_until || '');
        if (Number.isFinite(pausedMs) && pausedMs > Date.now()) {
          throw new FootballPausedError(record.rate_pause_until);
        }
      }

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

        // Falha: libera a marca de busca paralela (senão os demais ficariam
        // esperando uma resposta que nunca vai chegar) e contabiliza o erro.
        if (useCache) await clearInflight(cacheKey);
        if (error instanceof FootballRateLimitError || Number(error?.status) === 429) countMetric('count_429');
        else if (Number(error?.status) >= 500) countMetric('errors_5xx');
        await flushMetrics();

        // Falha dura de infraestrutura conta para o disjuntor; limite, chave e
        // plano têm tratamento próprio e não abrem o disjuntor.
        if (isTransientFailure(error)) {
          await persist(breakerFailurePatch(record, error?.message || String(error)));
        }

        if (error instanceof FootballRateLimitError) {
          const scope = error.scope === 'daily' ? 'daily' : 'minute';
          if (scope === 'daily') {
            // Saldo conhecido e acima do piso ⇒ o provedor está bloqueando o
            // tráfego por excesso de requisições, não por cota esgotada.
            const rawRemaining = record?.provider_remaining;
            const remainingNow =
              rawRemaining === null || rawRemaining === undefined || rawRemaining === '' ? null : Number(rawRemaining);
            const quotaEmpty =
              remainingNow !== null && Number.isFinite(remainingNow) && remainingNow <= PROVIDER_DAILY_FLOOR;
            const untilIso = await blockDay(error.message, { quotaEmpty });
            // O saldo real fica desconhecido enquanto o provedor recusa: zerar
            // aqui envenenaria o painel e o próprio bloqueio (0 ⇒ "esgotado").
            await persist({ provider_remaining: null });
            await log({
              endpoint: String(endpoint || ''),
              purpose: bucketPurpose,
              status_code: error.status || 429,
              duration_ms: durationMs,
              cache_hit: false,
              credits_used: 0,
              params: purpose || label || '',
              note: quotaEmpty
                ? 'cota diária esgotada · coleta bloqueada até a virada do dia'
                : 'bloqueio temporário do provedor · espera escalonada',
              error_message: String(error.message).slice(0, 240),
            });
            throw new FootballDailyLimitError(
              quotaEmpty
                ? error.message
                : `${error.message} · bloqueio temporário, coleta retoma em ${untilIso}`,
              untilIso,
            );
          }
          const untilIso = await pauseMinute(error.message, { retryAfterMs: error.retryAfterMs || null });
          await log({
            endpoint: String(endpoint || ''),
            purpose: bucketPurpose,
            status_code: error.status || 429,
            duration_ms: durationMs,
            cache_hit: false,
            credits_used: 0,
            params: purpose || label || '',
            note: 'limite por minuto · fila fechada até o próximo minuto',
            error_message: String(error.message).slice(0, 240),
          });
          throw new FootballMinuteLimitError(minuteLimit, untilIso);
        }

        if (error instanceof FootballAuthError || error instanceof FootballProviderError) {
          await persist({
            last_error: String(error.message).slice(0, 240),
            last_error_scope: error instanceof FootballAuthError ? 'auth' : 'plan',
          });
        }

        await log({
          endpoint: String(endpoint || ''),
          purpose: bucketPurpose,
          status_code: error?.status || 0,
          duration_ms: durationMs,
          cache_hit: false,
          credits_used: 0,
          params: purpose || label || '',
          note: 'falha na chamada',
          error_message: String(error?.message || error).slice(0, 240),
        });
        throw error;
      }
      const durationMs = Date.now() - startedAt;

      // 8) Cobrança interna + saldo do provedor + janela do minuto, numa escrita.
      countMetric('call_count');
      countMetric('total_duration_ms', durationMs);
      if (charge) used += cost;
      const purposeUsage = (() => {
        try {
          return JSON.parse(record?.purpose_used || '{}') || {};
        } catch {
          return {};
        }
      })();
      if (charge) purposeUsage[bucketPurpose] = (Number(purposeUsage[bucketPurpose]) || 0) + cost;
      const { messages, alerts } = charge
        ? alertMessages(used, dailyLimit, record?.alerts || [])
        : { messages: [], alerts: record?.alerts || [] };

      await persist({
        ...(charge ? { used, limit: dailyLimit, level: quotaLevel(used, dailyLimit) } : {}),
        purpose_used: JSON.stringify(purposeUsage),
        ...(messages.length ? { alerts, notes: messages.join(' · ').slice(0, 400) } : {}),
        minute_key: bucket,
        minute_used: windowUsed + cost,
        rate_limit_strikes: 0,
        ...breakerSuccessPatch(),
        ...(() => {
          const streak = Number(record?.success_streak || 0) + 1;
          const recovered = streak >= RECOVERY_SUCCESSES;
          return {
            success_streak: recovered ? 0 : streak,
            request_gap_ms: gapAfterSuccess(gap, streak),
          };
        })(),
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
          ? { provider_minute_remaining: result.quota.minuteRemaining, provider_minute_at: new Date().toISOString() }
          : {}),
        last_status_at: new Date().toISOString(),
        last_status_code: 200,
        last_error: '',
        last_error_scope: '',
        ...metricsFields(),
      });

      // 9) Cache compartilhado: a próxima consulta idêntica sai daqui, sem
      // tocar no provedor e sem consumir cota.
      if (useCache) {
        await writeCached(cacheKey, path, params, ttlSeconds, result.data, cacheRowId);
        await clearInflight(cacheKey);
      }

      // 10) Registro da requisição real: base do painel e da conciliação.
      await log({
        endpoint: String(endpoint || ''),
        purpose: bucketPurpose,
        status_code: result.status || 200,
        duration_ms: durationMs,
        records_returned: Number(result.results) || 0,
        cache_hit: false,
        credits_used: charge ? cost : 0,
        rate_limit_remaining: result.quota?.remaining ?? null,
        params: purpose || label || '',
        note: LEDGER_NOTE,
        error_message: '',
      });

      return result;
    },
  };

  return client;
}
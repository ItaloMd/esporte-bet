/**
 * Camada central de requisições à API-Football.
 *
 * Toda chamada externa de todas as rotinas passa por aqui (detector ao vivo,
 * auditoria, calendário, cotações, insights e painel de mercados). Nenhuma
 * rotina fala com o provedor por conta própria — assim o controle é único:
 *
 * - orçamento diário compartilhado (contador central com reserva);
 * - contador por minuto: nenhuma rotina drena a cota do minuto sozinha;
 * - pausa progressiva após HTTP 429 (backoff exponencial com jitter,
 *   respeitando Retry-After): a próxima execução nem tenta, evitando o ciclo
 *   de 429 → retentativa → 429 que consumia requisições sem entregar dados;
 * - registro de cada falha (endpoint, código HTTP, mensagem e horário) no log
 *   de uso, identificando qual rotina consumiu.
 *
 * Falha da fonte não significa ausência de partidas: os erros de pausa/limite
 * abortam a rotina sem apagar estado algum — os dados confirmados permanecem
 * e a revalidação é idempotente quando a fonte volta a responder.
 */
import { FootballRateLimitError, apiFootballFetch, isRateLimitErrorText } from './apiFootball.ts';
import { FOOTBALL_LIMITS } from './footballConfig.ts';
import { alertMessages, canSpend, loadQuota, quotaLevel, saveQuota } from './footballQuota.ts';

/** Limite interno de requisições por minuto (definido em footballConfig). */
export const DEFAULT_MINUTE_LIMIT = FOOTBALL_LIMITS.minuteRequests;
/** Marca das linhas de registro de cada requisição real enviada ao provedor. */
const LEDGER_NOTE = 'ledger';
/**
 * Pausa após 429: o limite do provedor é por minuto (a conta é Pro, com folga
 * diária), então a espera é de um a dois minutos. Pausas longas travavam todas
 * as rotinas por meia hora por causa de um único minuto saturado.
 */
const PAUSE_BASE_MS = 45 * 1000;
const PAUSE_CAP_MS = 90 * 1000;

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

/** Orçamento diário esgotado ou dentro da reserva. */
export class FootballBudgetError extends Error {
  constructor(used, limit) {
    super(`Orçamento diário reservado: ${used}/${limit}`);
    this.name = 'FootballBudgetError';
  }
}

/** Erros que exigem parar imediatamente as chamadas (não são retentados). */
export function isThrottleError(error) {
  return (
    error instanceof FootballRateLimitError ||
    error instanceof FootballPausedError ||
    error instanceof FootballMinuteLimitError ||
    error instanceof FootballBudgetError
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

/**
 * Abre o cliente central da execução. O estado (registro de cota) é relido a
 * cada chamada: rotinas concorrentes compartilham os mesmos contadores por
 * minuto e a mesma pausa pós-429.
 */
export async function openFootballClient(db, { apiKey, base, settings, day, limit, reserve = 0, label = '' }) {
  let record = await loadQuota(db, day);
  let used = Number(record?.used || 0);

  async function persist(patch) {
    record = await saveQuota(db, record, { ...(record?.id ? {} : { day }), ...patch });
    if (Number.isFinite(Number(record?.used))) used = Number(record.used);
    return record;
  }

  /** Registra o 429: pausa progressiva com jitter + log com endpoint e horário. */
  async function registerRateLimit({ endpoint, retryAfterMs, message }) {
    const strikes = Number(record?.rate_limit_strikes || 0) + 1;
    const backoffMs = Math.min(PAUSE_BASE_MS * 2 ** Math.min(strikes - 1, 4), PAUSE_CAP_MS);
    const jitter = 0.8 + Math.random() * 0.4;
    const pauseMs = Math.max(Number(retryAfterMs) || 0, Math.round(backoffMs * jitter));
    const untilIso = new Date(Date.now() + pauseMs).toISOString();
    const nowIso = new Date().toISOString();
    await persist({
      rate_pause_until: untilIso,
      rate_limit_strikes: strikes,
      last_rate_limited_at: nowIso,
      last_status_at: nowIso,
      last_status_code: 429,
      last_error: `429 · ${String(message || 'Too many requests').slice(0, 200)} · pausa ${Math.round(pauseMs / 1000)}s`,
    });
    await db.ApiUsageLog.create({
      provider: 'api_football',
      endpoint: String(endpoint || ''),
      status_code: 429,
      cache_hit: false,
      credits_used: 0,
      params: label || '',
      note: `limite excedido · tentativa ${strikes} · pausa progressiva ${Math.round(pauseMs / 1000)}s`,
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
    get minuteLimit() {
      return effectiveMinuteLimit(settings);
    },
    get pausedUntil() {
      return record?.rate_pause_until || null;
    },

    /**
     * Executa uma chamada passando por todos os controles. Erros de pausa,
     * limite por minuto e orçamento são lançados como exceções tipadas: a
     * rotina chamadora deve parar imediatamente (nada de ciclos de retentativa).
     */
    async call(endpoint, params = {}, { cost = 1, timeoutMs, purpose = label } = {}) {
      // Relê o estado: execuções concorrentes compartilham os contadores.
      const fresh = await loadQuota(db, day);
      if (fresh) {
        record = fresh;
        used = Number(record.used || 0);
      }
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      // 1) Pausa progressiva pós-429 ainda ativa.
      const pauseMs = Date.parse(record?.rate_pause_until || '');
      if (Number.isFinite(pauseMs) && pauseMs > nowMs) {
        throw new FootballPausedError(record.rate_pause_until);
      }

      // 2) Limite por minuto: janela deslizante de 60s sobre o registro real de
      // chamadas enviadas. O balde por minuto perdia contagem quando execuções
      // concorrentes liam o mesmo valor e gravavam por cima (o teto efetivo
      // ficava indefinido, e era isso que produzia pausas fora de hora).
      const bucket = minuteBucketKey(nowMs);
      const minuteLimit = effectiveMinuteLimit(settings);
      const windowStartIso = new Date(nowMs - 60000).toISOString();
      const recentCalls = await db.ApiUsageLog.count({ note: LEDGER_NOTE, created_date: { $gte: windowStartIso } });
      if (recentCalls >= minuteLimit) {
        // Pausa até o próximo minuto (+1-5s de jitter): todas as rotinas
        // param juntas em vez de continuarem batendo no mesmo limite.
        const untilIso = new Date(nowMs - (nowMs % 60000) + 60000 + 1000 + Math.floor(Math.random() * 4000)).toISOString();
        await persist({ rate_pause_until: untilIso, minute_key: bucket, minute_used: recentCalls });
        throw new FootballMinuteLimitError(minuteLimit);
      }

      // 3) Orçamento diário com reserva.
      if (!canSpend(used, limit, reserve, cost)) {
        throw new FootballBudgetError(used, limit);
      }

      // 4) A chamada em si.
      let result;
      try {
        result = await apiFootballFetch(apiKey, endpoint, params, {
          base,
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      } catch (error) {
        if (error instanceof FootballRateLimitError) {
          await registerRateLimit({ endpoint, retryAfterMs: error.retryAfterMs, message: error.message });
        }
        throw error;
      }
      if (result.errors.some(isRateLimitErrorText)) {
        const message = result.errors.filter(isRateLimitErrorText).join(' | ');
        await registerRateLimit({ endpoint, retryAfterMs: null, message });
        throw new FootballRateLimitError(message);
      }

      // 5) Cobrança diária + por minuto numa única escrita; a contagem oficial
      // dos cabeçalhos do provedor é preservada junto.
      used += cost;
      const { messages, alerts } = alertMessages(used, limit, record?.alerts || []);
      await persist({
        used,
        limit,
        level: quotaLevel(used, limit),
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

      // 6) Registro da requisição real: base da janela deslizante por minuto e
      // do inventário de consumo por endpoint, rotina e período.
      await db.ApiUsageLog.create({
        provider: 'api_football',
        endpoint: String(endpoint || ''),
        status_code: 200,
        cache_hit: false,
        credits_used: cost,
        params: purpose || label || '',
        note: LEDGER_NOTE,
        error_message: '',
      }).catch(() => null);

      return result;
    },
  };
  return client;
}
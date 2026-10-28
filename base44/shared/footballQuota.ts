/**
 * Controlador de consumo da API-Football e cache compartilhado.
 *
 * O orçamento diário é interno e conservador: os limites abaixo são decisões
 * operacionais da aplicação, não limites oficiais do provedor. Todo consumo é
 * registrado por endpoint e finalidade, e as respostas ficam em cache para que
 * todas as telas e todos os usuários reutilizem a mesma chamada.
 */
import { localDateString } from "./oddsApi.ts";

export const QUOTA_PROVIDER = "api_football";
export const QUOTA_ALERTS = [50, 75, 90, 95];
export const DEFAULT_DAILY_LIMIT = 100;

/** Dia operacional no calendário brasileiro. */
export function quotaDayKey(date, timeZone = "America/Sao_Paulo") {
  return localDateString(date, timeZone);
}

/** Faixa de consumo: 0 normal · 1 reduzido · 2 essencial · 3 contingência. */
export function quotaLevel(used, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const percent = (Number(used) / limit) * 100;
  if (percent > 95) return 3;
  if (percent > 80) return 2;
  if (percent > 60) return 1;
  return 0;
}

export function quotaPercent(used, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.round(((Number(used) || 0) / limit) * 1000) / 10;
}

/**
 * Política por faixa:
 * - `calendarDays`: quantos dias do calendário podem ser sincronizados na execução.
 * - `reserve`: chamadas mantidas de reserva para contingência.
 * - `live`: true sempre que a atualização de placares é permitida.
 */
export function quotaPolicy(level) {
  if (level >= 3) return { level: 3, live: true, calendarDays: 0, reserve: 3, criticalOnly: true };
  if (level === 2) return { level: 2, live: true, calendarDays: 1, reserve: 2, criticalOnly: false };
  if (level === 1) return { level: 1, live: true, calendarDays: 3, reserve: 1, criticalOnly: false };
  return { level: 0, live: true, calendarDays: 7, reserve: 0, criticalOnly: false };
}

/** Verdadeiro quando ainda há orçamento acima da reserva para a chamada. */
export function canSpend(used, limit, reserve = 0, cost = 1) {
  return Number(used) + Number(cost) + Number(reserve) <= Number(limit);
}

/**
 * Orçamento efetivo do dia: o menor entre o limite interno e o limite real do
 * plano contratado (cabeçalhos do provedor ou /status). Enquanto a conta está
 * no plano Free, o orçamento cai para o limite real; ao upgradear o plano, o
 * valor sobe automaticamente — as rotinas nunca gastam além do plano.
 */
export function effectiveDailyLimit(internalLimit, providerLimit) {
  const provider = Number(providerLimit);
  if (Number.isFinite(provider) && provider > 0) {
    return Math.min(Number(internalLimit), provider);
  }
  return Number(internalLimit);
}

export function alertMessages(used, limit, previousAlerts = []) {
  const percent = quotaPercent(used, limit);
  const raised = QUOTA_ALERTS.filter((threshold) => percent >= threshold && !previousAlerts.includes(String(threshold)));
  return {
    messages: raised.map((threshold) => `Consumo da API-Football em ${threshold}% do orçamento diário`),
    alerts: [...new Set([...previousAlerts, ...raised.map(String)])],
  };
}

/* ------------------------------ persistência ------------------------------ */

export async function loadQuota(db, day) {
  const page = await db.ApiQuota.filter({ provider: QUOTA_PROVIDER, day }, { limit: 1 });
  return page.items?.[0] || null;
}

export async function saveQuota(db, record, patch) {
  if (record?.id) return db.ApiQuota.update(record.id, patch);
  return db.ApiQuota.create({ provider: QUOTA_PROVIDER, day: patch.day, ...patch });
}

/**
 * Registra o consumo de uma chamada e devolve o estado atualizado da faixa.
 * A reserva é respeitada: quando o orçamento restante é menor que a reserva da
 * faixa, a chamada é recusada em vez de consumida.
 */
export async function chargeQuota(db, { record, day, limit, cost = 1, purpose, endpoint, reserve = 0 }) {
  const used = Number(record?.used || 0);
  if (!canSpend(used, limit, reserve, cost)) {
    return { allowed: false, used, level: quotaLevel(used, limit), percent: quotaPercent(used, limit), alerts: [] };
  }
  const nextUsed = used + Number(cost);
  const level = quotaLevel(nextUsed, limit);
  const { messages, alerts } = alertMessages(nextUsed, limit, record?.alerts || []);
  const saved = await saveQuota(db, record, {
    ...(record?.id ? {} : { day }),
    used: nextUsed,
    limit,
    level,
    alerts,
    ...(messages.length ? { notes: messages.join(" · ").slice(0, 400) } : {}),
  });
  return { allowed: true, record: saved, used: nextUsed, level, percent: quotaPercent(nextUsed, limit), alerts: messages };
}

/* --------------------------------- cache --------------------------------- */

/**
 * O cache é compartilhado por todos os usuários e vive nas partidas
 * armazenadas: este registro guarda apenas a validade da última coleta, para
 * que nenhuma tela ou execução repita uma consulta ainda válida. A resposta
 * bruta não é guardada em campo de entidade (limite de tamanho do banco).
 */
export async function readCache(db, key) {
  const page = await db.ApiCache.filter({ provider: QUOTA_PROVIDER, key }, { limit: 1 });
  const row = page.items?.[0] || null;
  if (!row) return null;
  const fresh = Boolean(row.expires_at && Date.parse(row.expires_at) > Date.now());
  return { row, fresh };
}

export async function writeCache(db, { key, endpoint, params, ttlSeconds, records, note }) {
  const now = new Date();
  const data = {
    provider: QUOTA_PROVIDER,
    key,
    endpoint,
    params: params || "",
    records: Number(records) || 0,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + Math.max(0, Number(ttlSeconds) || 0) * 1000).toISOString(),
    last_ok_at: now.toISOString(),
    note: note || "",
  };
  const existing = await db.ApiCache.filter({ provider: QUOTA_PROVIDER, key }, { limit: 1 });
  const row = existing.items?.[0];
  if (row) return db.ApiCache.update(row.id, data);
  return db.ApiCache.create(data);
}

/* ------------------------- execução simultânea (lock) ------------------------- */

/** Verdadeiro quando outra execução ainda detém o lock. */
export function lockHeld(record, nowMs = Date.now()) {
  return Boolean(record?.lock_until && Date.parse(record.lock_until) > nowMs);
}

export async function acquireLock(db, record, day, owner, ttlMs = 4 * 60 * 1000) {
  const until = new Date(Date.now() + ttlMs).toISOString();
  return saveQuota(db, record, { ...(record?.id ? {} : { day }), lock_until: until, lock_owner: owner });
}

export async function releaseLock(db, record) {
  if (!record?.id) return null;
  return db.ApiQuota.update(record.id, { lock_until: null, lock_owner: "" });
}
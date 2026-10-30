/**
 * Fila de auditoria de resultados pendentes.
 *
 * A regra é simples e vale para todas as rotinas: a API só é consultada para
 * partidas que possuem apostas abertas. As apostas são agrupadas pelo evento e
 * os eventos pelo `fixture_id`, então uma partida com 200 apostas gera uma
 * consulta de resultado — nunca 200.
 *
 * Aqui vivem somente funções puras de decisão (prioridade, espera progressiva)
 * e o acesso à fila `ResultAuditQueue`. Nenhuma chamada externa é feita neste
 * módulo: quem consulta a API é a rotina centralizada, sempre pelo cliente
 * compartilhado.
 */
import { FOOTBALL_CADENCE } from './footballConfig.ts';
import { chunkArray } from './matchLifecycle.ts';
import { numberOr } from './footballSync.ts';

/** Partidas por chamada de resultado (/fixtures?ids): limite da API. */
export const IDS_PER_RESULT_CALL = 20;
/** Teto de partidas analisadas por execução da rotina. */
export const MAX_FIXTURES_PER_RUN = 200;
/** Tentativas sem resultado confirmado antes de enviar para revisão humana. */
export const MAX_RESULT_ATTEMPTS = 12;
/** Partida ao vivo atualizada pelo detector há menos disso não é reconsultada. */
export const LIVE_STALE_MS = 15 * 60 * 1000;

/** Espera progressiva entre tentativas (minutos), com teto de 60. */
const BACKOFF_MINUTES = [2, 5, 10, 20, 40, 60];

/**
 * Agrupa as seleções abertas por partida, com a contagem de apostas, os
 * bilhetes relacionados e os mercados apostados. Uma única passagem pelo banco
 * resume todas as pendências da plataforma.
 */
export async function groupPendingByEvent(db) {
  const byEvent = new Map();
  let cursor = null;
  for (let round = 0; round < 40; round += 1) {
    const page = await db.SimulationSelection.filter(
      { status: 'open' },
      { limit: 500, ...(cursor ? { cursor } : {}) },
    );
    (page.items || []).forEach((row) => {
      const key = row.event_id;
      if (!key) return;
      if (!byEvent.has(key)) {
        byEvent.set(key, { eventId: key, selections: 0, tickets: new Set(), markets: new Set() });
      }
      const entry = byEvent.get(key);
      entry.selections += 1;
      if (row.ticket_id) entry.tickets.add(row.ticket_id);
      if (row.market_key) entry.markets.add(String(row.market_key));
    });
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return byEvent;
}

/** Carrega os eventos pelo id, em blocos de 100. */
export async function loadEventsByIds(db, ids) {
  const map = new Map();
  for (const chunk of chunkArray([...new Set(ids.filter(Boolean))], 100)) {
    const page = await db.Event.filter({ id: { $in: chunk } }, { limit: chunk.length + 5 });
    (page.items || []).forEach((row) => map.set(row.id, row));
  }
  return map;
}

/** Verdadeiro quando o resultado já foi confirmado por fonte oficial ou revisão. */
export function hasConfirmedResult(event) {
  if (!event) return false;
  if (event.result_confirmed_at) return true;
  return false;
}

/** Partida que não será disputada: as seleções são anuladas, sem consultar a API. */
export function isVoidEvent(event) {
  return event?.status === 'postponed' || event?.status === 'cancelled';
}

/**
 * Prioridade da fila de auditoria:
 * 1 encerrada com apostas aguardando liquidação · 2 tentativa anterior falhou ·
 * 3 em andamento com apostas (só quando o detector está defasado) ·
 * 4 futura com apostas registradas.
 */
export function auditPriorityFor(event, attempts = 0) {
  if (event?.status === 'finished' || isVoidEvent(event)) return 1;
  if (numberOr(attempts, 0) > 0) return 2;
  if (event?.status === 'live') return 3;
  return 4;
}

/** Primeira verificação: início previsto + offset configurado (padrão 2 horas). */
export function firstAttemptAt(event, settings, nowMs = Date.now()) {
  const start = Date.parse(event?.start_time || '');
  const offsetHours = numberOr(settings?.football_audit_offset_hours, FOOTBALL_CADENCE.auditOffsetHours);
  if (!Number.isFinite(start)) return new Date(nowMs).toISOString();
  return new Date(start + offsetHours * 3600000).toISOString();
}

/**
 * Próxima tentativa conforme a prioridade e o número de tentativas já feitas.
 * Resultado confirmado devolve `null`: a partida nunca mais é consultada.
 */
export function nextAttemptAt(priority, attempts, nowMs) {
  if (priority === 1) {
    const index = Math.min(BACKOFF_MINUTES.length - 1, Math.max(0, numberOr(attempts, 0)));
    return new Date(nowMs + BACKOFF_MINUTES[index] * 60000).toISOString();
  }
  const minutes = priority === 3 ? 5 : 10;
  return new Date(nowMs + minutes * 60000).toISOString();
}

/** Verdadeiro quando a linha da fila já pode ser tentada. */
export function isAttemptDue(row, nowMs) {
  if (!row) return false;
  if (row.status !== 'pending') return false;
  const next = Date.parse(row.next_attempt_at || '');
  if (!Number.isFinite(next)) return true;
  return next <= nowMs;
}

/**
 * Patch de resultado a partir do item oficial da API. Nada é inventado: campo
 * ausente na fonte não sobrescreve o que já está gravado, e um placar parcial
 * nunca vira resultado final (só `finished` confirma).
 */
export function buildResultPatch(fixture, event, nowIso) {
  const patch = { live_updated_at: nowIso, last_sync_at: nowIso };
  if (!fixture) return patch;
  if (fixture.status && fixture.status !== event.status) patch.status = fixture.status;
  if (fixture.phase && (fixture.phase !== event.phase || fixture.phase_label !== event.phase_label)) {
    patch.phase = fixture.phase;
    patch.phase_label = fixture.phase_label;
  }
  if (fixture.minute !== null && fixture.minute !== undefined && fixture.minute !== event.minute) {
    patch.minute = fixture.minute;
  }
  if (fixture.home_score !== null && fixture.away_score !== null) {
    if (fixture.home_score !== event.home_score) patch.home_score = fixture.home_score;
    if (fixture.away_score !== event.away_score) patch.away_score = fixture.away_score;
  }
  if (fixture.ht_home_score !== null && fixture.ht_away_score !== null) {
    if (fixture.ht_home_score !== event.ht_home_score || fixture.ht_away_score !== event.ht_away_score) {
      patch.ht_home_score = fixture.ht_home_score;
      patch.ht_away_score = fixture.ht_away_score;
    }
  }
  if (fixture.reg_home_score !== null && fixture.reg_away_score !== null) {
    if (fixture.reg_home_score !== event.reg_home_score || fixture.reg_away_score !== event.reg_away_score) {
      patch.reg_home_score = fixture.reg_home_score;
      patch.reg_away_score = fixture.reg_away_score;
    }
  }
  if (fixture.extra_time) patch.extra_time = true;
  if (fixture.penalties) patch.penalties = true;

  if (fixture.finished) {
    patch.status = 'finished';
    patch.tracking = 'finished';
    patch.published = false;
    patch.odds_status = 'unavailable';
    patch.next_check_at = null;
    patch.result_confirmed_at = nowIso;
    patch.result_source = 'api_football';
    if (event.settlement_state !== 'settled') patch.settlement_state = 'waiting';
  } else if (fixture.void) {
    patch.tracking = 'finished';
    patch.published = false;
    patch.odds_status = 'unavailable';
    patch.next_check_at = null;
  } else if (fixture.review) {
    patch.settlement_state = 'review';
  }
  return patch;
}

/** Cria ou atualiza a linha da fila para cada partida com pendência. */
export async function syncAuditQueue(db, rows) {
  if (!rows.length) return { created: 0, updated: 0 };
  const existing = new Map();
  const fixtureIds = rows.map((row) => row.fixture_id).filter(Boolean);
  for (const ids of chunkArray(fixtureIds, 100)) {
    const page = await db.ResultAuditQueue.filter({ fixture_id: { $in: ids } }, { limit: ids.length + 5 });
    (page.items || []).forEach((row) => existing.set(row.fixture_id, row));
  }
  const updates = [];
  const creates = [];
  rows.forEach((row) => {
    const found = existing.get(row.fixture_id);
    if (found) updates.push({ id: found.id, ...row });
    else creates.push(row);
  });
  for (const batch of chunkArray(updates, 200)) {
    if (batch.length) await db.ResultAuditQueue.bulkUpdate(batch);
  }
  for (const batch of chunkArray(creates, 100)) {
    if (batch.length) await db.ResultAuditQueue.bulkCreate(batch);
  }
  return { created: creates.length, updated: updates.length };
}

/** Retira da fila as partidas que não têm mais nenhuma aposta pendente. */
export async function closeAuditQueueRows(db, activeFixtureIds) {
  const active = new Set(activeFixtureIds.filter(Boolean));
  let removed = 0;
  let cursor = null;
  for (let round = 0; round < 8; round += 1) {
    const page = await db.ResultAuditQueue.filter(
      { status: 'pending' },
      { limit: 200, ...(cursor ? { cursor } : {}) },
    );
    const stale = (page.items || []).filter((row) => !active.has(row.fixture_id));
    if (stale.length) {
      await db.ResultAuditQueue.updateMany(
        { id: { $in: stale.map((row) => row.id) } },
        { $set: { status: 'removed', next_attempt_at: null } },
      );
      removed += stale.length;
    }
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return removed;
}
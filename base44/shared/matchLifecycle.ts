/**
 * Ciclo de vida das partidas: fechamento de apostas, marcação de "ao vivo" pelo
 * horário previsto e liquidação das seleções a partir do placar confirmado.
 *
 * Nada aqui consulta a fonte de odds: a decisão é sempre tomada pelo horário
 * previsto da partida e pelo placar final devolvido pelo provedor.
 */
import { slugify } from './oddsApi.ts';

/** Apostas encerram 10 minutos antes do horário previsto de início. */
export const BET_CLOSE_LEAD_MS = 10 * 60 * 1000;

/**
 * Intervalo mínimo entre consultas de placar de uma mesma modalidade. Cada
 * chamada de placar cobre todos os eventos da modalidade e custa créditos, então
 * o intervalo é o principal controle de consumo.
 */
export const SCORE_RECHECK_MS = 30 * 60 * 1000;

/** Espera maior quando a modalidade não devolve placar (evita gasto repetido). */
export const SCORE_BACKOFF_MS = 60 * 60 * 1000;

export function chunkArray(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

export function betCloseAt(event) {
  const start = Date.parse(event?.start_time);
  return Number.isFinite(start) ? start - BET_CLOSE_LEAD_MS : null;
}

/** Verdadeiro quando a partida já está dentro dos 10 minutos finais ou começou. */
export function bettingClosed(event, nowMs) {
  const close = betCloseAt(event);
  if (close === null) return true;
  return nowMs >= close;
}

/** Extrai o placar de um time da resposta de scores, com fallback pela ordem. */
export function readScore(scoreEvent, teamName, index) {
  const list = Array.isArray(scoreEvent?.scores) ? scoreEvent.scores : [];
  const match = teamName ? list.find((entry) => slugify(entry?.name) === slugify(teamName)) : null;
  const chosen = match || list[index];
  const value = Number(chosen?.score);
  return Number.isFinite(value) ? value : null;
}

/**
 * Decide o resultado de uma seleção a partir do placar final da partida.
 * Devolve `null` quando não é possível decidir — a seleção permanece aberta.
 */
export function settleSelection(selection, event) {
  const marketKey = selection?.market_key;
  const code = selection?.odd_code;
  const home = Number(event?.home_score);
  const away = Number(event?.away_score);
  if (!code || !Number.isFinite(home) || !Number.isFinite(away)) return null;

  const homeSlug = slugify(event.home_team_name);
  const awaySlug = slugify(event.away_team_name);

  if (marketKey === 'h2h') {
    if (code === 'draw') return home === away ? 'won' : 'lost';
    if (code === homeSlug) return home > away ? 'won' : 'lost';
    if (code === awaySlug) return away > home ? 'won' : 'lost';
    return null;
  }

  if (marketKey === 'totals') {
    const parsed = /^(over|under)_(-?\d+(?:\.\d+)?)$/.exec(code);
    if (!parsed) return null;
    const line = Number(parsed[2]);
    const total = home + away;
    if (total === line) return 'void';
    const isOver = total > line;
    return (parsed[1] === 'over') === isOver ? 'won' : 'lost';
  }

  if (marketKey === 'spreads') {
    const parsed = /^(.*)_(-?\d+(?:\.\d+)?)$/.exec(code);
    if (!parsed) return null;
    const teamSlug = parsed[1];
    const point = Number(parsed[2]);
    if (teamSlug === homeSlug) {
      const margin = home + point - away;
      return margin === 0 ? 'void' : margin > 0 ? 'won' : 'lost';
    }
    if (teamSlug === awaySlug) {
      const margin = away + point - home;
      return margin === 0 ? 'void' : margin > 0 ? 'won' : 'lost';
    }
    return null;
  }

  return null;
}

/**
 * Marca como "ao vivo" toda partida já iniciada e retira as cotações do ar.
 * O status é definido pelo horário previsto, sem consultar odds durante o jogo.
 */
export async function markStartedEventsLive(db, nowIso) {
  const startedIds = [];
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter(
      { source: 'provider', status: 'scheduled', start_time: { $lte: nowIso } },
      { limit: 500 },
    );
    const items = page.items || [];
    if (!items.length) break;
    await db.Event.updateMany(
      { id: { $in: items.map((row) => row.id) } },
      { $set: { status: 'live', published: false, odds_status: 'unavailable', next_check_at: nowIso } },
    );
    startedIds.push(...items.map((row) => row.id));
  }

  // Partidas que já começaram não ficam mais publicadas para apostas.
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter({ source: 'provider', status: 'live', published: true }, { limit: 500 });
    const items = page.items || [];
    if (!items.length) break;
    await db.Event.updateMany({ id: { $in: items.map((row) => row.id) } }, { $set: { published: false } });
  }

  for (const ids of chunkArray(startedIds, 100)) {
    await db.Odd.updateMany({ event_id: { $in: ids }, status: 'open' }, { $set: { status: 'closed' } });
    await db.Market.updateMany({ event_id: { $in: ids }, status: 'open' }, { $set: { status: 'closed' } });
  }

  return startedIds;
}
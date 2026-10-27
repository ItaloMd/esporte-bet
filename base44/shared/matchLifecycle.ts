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

/**
 * Janela em que uma partida iniciada ainda pode ser considerada "ao vivo".
 * Passado esse tempo ela já terminou, então sai da lista de ao vivo e para de
 * ser consultada — é o que impede que jogos de dias anteriores reapareçam.
 */
export const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

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
 * Fases em que o resultado não decide a aposta sozinho: suspensa, interrompida,
 * abandonada, decisão administrativa ou W.O. Exigem revisão manual.
 */
export const REVIEW_PHASES = new Set(['SUSP', 'INT', 'ABD', 'AWD', 'WO']);

/**
 * Placar usado na liquidação dos mercados principais. Quando houve prorrogação
 * ou pênaltis, vale o placar dos 90 minutos; caso contrário, o placar final.
 */
export function regulationScore(event) {
  const regHome = Number(event?.reg_home_score);
  const regAway = Number(event?.reg_away_score);
  if (Number.isFinite(regHome) && Number.isFinite(regAway)) return { home: regHome, away: regAway };
  return { home: Number(event?.home_score), away: Number(event?.away_score) };
}

/**
 * Decide o resultado de uma seleção a partir do placar confirmado da partida.
 * Devolve `null` quando não é possível decidir — a seleção permanece aberta e a
 * partida é marcada para revisão. Nunca decide por ausência de dados.
 */
export function settleSelection(selection, event) {
  const marketKey = selection?.market_key;
  const code = selection?.odd_code;

  // Partida adiada ou cancelada: a seleção é anulada, sem placar inventado.
  if (event?.status === 'postponed' || event?.status === 'cancelled') return 'void';
  // Situações indefinidas ficam pendentes até decisão humana.
  if (event?.settlement_state === 'review' || REVIEW_PHASES.has(String(event?.phase || '').toUpperCase())) return null;

  const { home, away } = regulationScore(event);
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
    // Linha fracionária não existe: empate exato é anulado (push).
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
  const nowMs = Date.parse(nowIso);
  const staleIso = new Date(nowMs - LIVE_WINDOW_MS).toISOString();
  const staleUpdate = {
    status: 'finished',
    tracking: 'finished',
    published: false,
    odds_status: 'unavailable',
    next_check_at: null,
  };
  const startedIds = [];

  // 1) Partidas antigas ainda marcadas como "ao vivo" já terminaram: saem da
  // listagem de ao vivo e deixam de consumir consultas de placar.
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter(
      { source: 'provider', status: 'live', start_time: { $lt: staleIso } },
      { limit: 500 },
    );
    const items = page.items || [];
    if (!items.length) break;
    await db.Event.updateMany({ id: { $in: items.map((row) => row.id) } }, { $set: staleUpdate });
  }

  // 2) Partidas cujo horário previsto já passou viram "ao vivo". As que
  // começaram antes da janela são encerradas direto, sem passar por "ao vivo".
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter(
      { source: 'provider', status: 'scheduled', start_time: { $lte: nowIso } },
      { limit: 500 },
    );
    const items = page.items || [];
    if (!items.length) break;
    const recent = items.filter((row) => Date.parse(row.start_time) >= nowMs - LIVE_WINDOW_MS);
    const stale = items.filter((row) => Date.parse(row.start_time) < nowMs - LIVE_WINDOW_MS);
    if (recent.length) {
      await db.Event.updateMany(
        { id: { $in: recent.map((row) => row.id) } },
        { $set: { status: 'live', published: false, odds_status: 'unavailable' } },
      );
      startedIds.push(...recent.map((row) => row.id));
    }
    if (stale.length) {
      await db.Event.updateMany({ id: { $in: stale.map((row) => row.id) } }, { $set: staleUpdate });
    }
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
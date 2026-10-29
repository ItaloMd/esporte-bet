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

  /* --------- mercados de intervalo, estatísticas e especiais --------- */
  const htHome = Number(event?.ht_home_score);
  const htAway = Number(event?.ht_away_score);
  const htAvailable = Number.isFinite(htHome) && Number.isFinite(htAway);
  const htTotal = htAvailable ? htHome + htAway : null;
  const secondHalfTotal = htAvailable ? home + away - htTotal : null;

  if (marketKey === 'btts') {
    if (code === 'yes') return home > 0 && away > 0 ? 'won' : 'lost';
    if (code === 'no') return home === 0 || away === 0 ? 'won' : 'lost';
    return null;
  }

  if (marketKey === 'ht_result') {
    if (!htAvailable) return null;
    if (code === 'draw') return htHome === htAway ? 'won' : 'lost';
    if (code === homeSlug) return htHome > htAway ? 'won' : 'lost';
    if (code === awaySlug) return htAway > htHome ? 'won' : 'lost';
    return null;
  }

  if (marketKey === 'ht_btts') {
    if (!htAvailable) return null;
    if (code === 'yes') return htHome > 0 && htAway > 0 ? 'won' : 'lost';
    if (code === 'no') return htHome === 0 || htAway === 0 ? 'won' : 'lost';
    return null;
  }

  if (marketKey === 'ht_totals') {
    if (htTotal === null) return null;
    const parsed = /^(over|under)_(-?\d+(?:\.\d+)?)$/.exec(code);
    if (!parsed) return null;
    const line = Number(parsed[2]);
    if (htTotal === line) return 'void';
    return (parsed[1] === 'over') === (htTotal > line) ? 'won' : 'lost';
  }

  if (marketKey === 'goal_both_halves') {
    if (htTotal === null || secondHalfTotal === null) return null;
    if (code === 'yes') return htTotal > 0 && secondHalfTotal > 0 ? 'won' : 'lost';
    if (code === 'no') return htTotal === 0 || secondHalfTotal === 0 ? 'won' : 'lost';
    return null;
  }

  if (marketKey === 'first_goal') {
    const firstTeam = String(event?.first_goal_team || '').toLowerCase();
    if (!firstTeam) return null;
    if (code !== homeSlug && code !== awaySlug) return null;
    return code === (firstTeam === 'home' ? homeSlug : awaySlug) ? 'won' : 'lost';
  }

  const statisticTotals = {
    corners: [Number(event?.corners_home), Number(event?.corners_away)],
    corners_home: [Number(event?.corners_home), 0],
    corners_away: [Number(event?.corners_away), 0],
    cards: [Number(event?.cards_home), Number(event?.cards_away)],
    cards_home: [Number(event?.cards_home), 0],
    cards_away: [Number(event?.cards_away), 0],
  };
  if (statisticTotals[marketKey]) {
    const [first, second] = statisticTotals[marketKey];
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    const statTotal = first + second;
    const parsed = /^(over|under)_(-?\d+(?:\.\d+)?)$/.exec(code);
    if (!parsed) return null;
    const line = Number(parsed[2]);
    if (statTotal === line) return 'void';
    return (parsed[1] === 'over') === (statTotal > line) ? 'won' : 'lost';
  }

  return null;
}

/**
 * Fecha as apostas das partidas cujo horário previsto passou e reconcilia o
 * status "ao vivo" com a fase oficial gravada pela fonte.
 *
 * O relógio apenas encerra a aposta: o status de jogo ativo vem somente da
 * API-Football (detector ao vivo e auditoria), nunca do horário programado,
 * da existência de odds ou do minuto armazenado.
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

  // 0) Higiene da aba ao vivo (reconciliação, sem chamadas à API): o status
  // "ao vivo" só a fonte confirma. Partida "ao vivo" com fase gravada de
  // encerramento sai da lista preservando o placar; com fase de jogo não
  // iniciado (NS/TBD) volta a agendada — a fonte diz que ela não começou.
  for (const [phases, mode] of [
    [['FT', 'AET', 'PEN'], 'finished'],
    [['AWD', 'WO', 'ABD'], 'review'],
    [['NS', 'TBD'], 'scheduled'],
  ]) {
    for (let round = 0; round < 4; round += 1) {
      const page = await db.Event.filter(
        { source: 'provider', status: 'live', phase: { $in: phases } },
        { limit: 500 },
      );
      const items = page.items || [];
      if (!items.length) break;
      const patch =
        mode === 'scheduled'
          ? { status: 'scheduled', published: false, odds_status: 'unavailable' }
          : { ...staleUpdate, ...(mode === 'review' ? { settlement_state: 'review' } : {}) };
      await db.Event.updateMany({ id: { $in: items.map((row) => row.id) } }, { $set: patch });
    }
  }

  // 1) Partidas antigas ainda marcadas como "ao vivo" já terminaram: saem da
  // listagem de ao vivo e deixam de consumir consultas de placar. Sem
  // confirmação do provedor o encerramento não é "resultado confirmado":
  // nada é liquidado a partir de um placar ao vivo congelado.
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter(
      { source: 'provider', status: 'live', start_time: { $lt: staleIso } },
      { limit: 500 },
    );
    const items = page.items || [];
    if (!items.length) break;
    await db.Event.updateMany(
      { id: { $in: items.map((row) => row.id) } },
      { $set: { ...staleUpdate, settlement_state: 'review' } },
    );
  }

  // 2) Partidas cujo horário previsto passou não aceitam mais apostas: saem da
  // publicação e têm as cotações encerradas. O status "ao vivo", porém, nunca
  // vem do relógio: só a fonte (API-Football) confirma que o jogo está ativo —
  // o horário programado não é prova de jogo em andamento.
  for (let round = 0; round < 8; round += 1) {
    const page = await db.Event.filter(
      {
        source: 'provider',
        status: 'scheduled',
        start_time: { $lte: nowIso },
        $or: [{ published: true }, { odds_status: { $ne: 'unavailable' } }],
      },
      { limit: 500 },
    );
    const items = page.items || [];
    if (!items.length) break;
    const recent = items.filter((row) => Date.parse(row.start_time) >= nowMs - LIVE_WINDOW_MS);
    const stale = items.filter((row) => Date.parse(row.start_time) < nowMs - LIVE_WINDOW_MS);
    if (recent.length) {
      await db.Event.updateMany(
        { id: { $in: recent.map((row) => row.id) } },
        { $set: { published: false, odds_status: 'unavailable' } },
      );
      startedIds.push(...recent.map((row) => row.id));
    }
    if (stale.length) {
      await db.Event.updateMany(
        { id: { $in: stale.map((row) => row.id) } },
        { $set: { ...staleUpdate, settlement_state: 'review' } },
      );
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
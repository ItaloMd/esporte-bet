/**
 * Cotações da API-Football v3 (`/odds`).
 *
 * A resposta já vem com a cotação de cada seleção, por casa de apostas. A
 * aplicação usa uma única casa como referência — a primeira da lista de
 * preferência que traga mercados — e aplica a margem da casa sobre o mercado
 * completo, exatamente como no restante da plataforma.
 *
 * Nenhum segredo é lido aqui: a chave chega por parâmetro, sempre do backend.
 */
import { apiFootballFetch, FOOTBALL_TIMEZONE } from './apiFootball.ts';
import { BET_NAME_TO_MARKET_KEY } from './footballMarkets.ts';
import { selectionCode, selectionLabel } from './oddsApi.ts';

/**
 * Páginas consultadas por data. A fonte entrega as cotações paginadas (10
 * partidas por página) e o plano gratuito aceita no máximo 3 páginas por data,
 * o que cobre até 30 partidas por dia. A coleta para assim que a fonte recusa
 * uma página, então planos maiores não são prejudicados.
 */
export const MAX_ODDS_PAGES = 3;

/** Casas preferidas como referência de preço, quando presentes na resposta. */
export const BOOKMAKER_PREFERENCE = [
  'Bet365',
  'Pinnacle',
  'Betano',
  'Betfair',
  '1xBet',
  'William Hill',
  'Marathonbet',
  'Betway',
  '10Bet',
  'Unibet',
];

/**
 * Cotações de uma página da data. Sem filtro de mercado: uma única consulta já
 * traz todos os mercados disponíveis, então a mesma chamada serve vencedor da
 * partida, gols acima/abaixo e handicap asiático.
 */
export function fetchOddsByDate(apiKey, base, date, page = 1) {
  const params = { date, timezone: FOOTBALL_TIMEZONE };
  if (page > 1) params.page = page;
  return apiFootballFetch(apiKey, '/odds', params, { base, timeoutMs: 25000 });
}

/** Erros que indicam que o plano atual não libera mais páginas desta data. */
export function pageLimitReached(errors = []) {
  return errors.some((message) => /page/i.test(String(message)));
}

/** Casa de referência: a preferida que tiver mercados; senão a mais completa. */
export function pickBookmaker(bookmakers = []) {
  const withBets = bookmakers.filter((book) => (book?.bets || []).length);
  if (!withBets.length) return null;
  for (const name of BOOKMAKER_PREFERENCE) {
    const found = withBets.find((book) => String(book.name || '').trim().toLowerCase() === name.toLowerCase());
    if (found) return found;
  }
  return withBets.slice().sort((a, b) => (b.bets || []).length - (a.bets || []).length)[0];
}

const OVER_UNDER = /^(over|under)\s+(-?\d+(?:\.\d+)?)$/i;
const HANDICAP = /^(home|away)\s+([+-]?\d+(?:\.\d+)?)$/i;

/** Nome do mercado na API-Football → chave interna da aplicação (catálogo oficial). */
function marketKeyFor(betName) {
  return BET_NAME_TO_MARKET_KEY.get(String(betName || '').trim().toLowerCase()) || null;
}

/**
 * Traduz o valor de uma aposta para o formato interno (`name`/`point`), para
 * reaproveitar os mesmos rótulo e código usados nas demais cotações.
 */
function outcomeFor(marketKey, value, teams) {
  const raw = String(value || '').trim();
  if (marketKey === 'h2h' || marketKey === 'ht_result' || marketKey === 'first_goal') {
    if (/^home$/i.test(raw)) return { name: teams.home };
    if (/^away$/i.test(raw)) return { name: teams.away };
    if (marketKey !== 'first_goal' && /^draw$/i.test(raw)) return { name: 'Draw' };
    return null;
  }
  if (
    marketKey === 'totals' || marketKey === 'ht_totals' ||
    marketKey === 'corners' || marketKey === 'corners_home' || marketKey === 'corners_away' ||
    marketKey === 'cards' || marketKey === 'cards_home' || marketKey === 'cards_away'
  ) {
    const match = OVER_UNDER.exec(raw);
    if (!match) return null;
    return { name: `${match[1]} ${match[2]}`, point: Number(match[2]) };
  }
  if (marketKey === 'double_chance' || marketKey === 'ht_double_chance') {
    if (/^home\/draw$/i.test(raw)) return { name: 'Casa ou Empate', code: '1x' };
    if (/^home\/away$/i.test(raw)) return { name: 'Casa ou Visitante', code: '12' };
    if (/^draw\/away$/i.test(raw)) return { name: 'Empate ou Visitante', code: 'x2' };
    return null;
  }
  if (marketKey === 'btts' || marketKey === 'ht_btts' || marketKey === 'goal_both_halves') {
    if (/^yes$/i.test(raw)) return { name: 'Sim', code: 'yes' };
    if (/^no$/i.test(raw)) return { name: 'Não', code: 'no' };
    return null;
  }
  const match = HANDICAP.exec(raw);
  if (!match) return null;
  const side = match[1].toLowerCase() === 'home' ? teams.home : teams.away;
  return { name: side, point: Number(match[2]) };
}

/**
 * Mercados e seleções de uma partida, já no formato aceito pelo gravador.
 * Devolve `null` quando a casa escolhida não traz nenhum mercado conhecido.
 */
export function mapOddsEntry(entry, bookmaker, { homeTeam, awayTeam }) {
  if (!entry || !bookmaker) return null;
  const teams = { home: homeTeam, away: awayTeam };
  const markets = new Map();

  (bookmaker.bets || []).forEach((bet) => {
    const marketKey = marketKeyFor(bet.name);
    if (!marketKey) return;
    const byLine = new Map();
    (bet.values || []).forEach((item) => {
      const outcome = outcomeFor(marketKey, item.value, teams);
      if (!outcome) return;
      const price = Number(item.odd);
      if (!Number.isFinite(price) || price <= 1) return;
      const line = outcome.point === undefined || outcome.point === null ? null : Number(outcome.point);
      const lineKey = line === null ? 'principal' : String(line);
      if (!byLine.has(lineKey)) byLine.set(lineKey, { universe: new Set(), quotes: new Map() });
      const group = byLine.get(lineKey);
      const code = selectionCode(marketKey, outcome);
      group.universe.add(code);
      if (!group.quotes.has(code)) {
        group.quotes.set(code, {
          code,
          line,
          label: selectionLabel(marketKey, outcome),
          original_value: price,
          bookmaker: bookmaker.name || '',
        });
      }
    });
    if (byLine.size) markets.set(marketKey, byLine);
  });

  if (!markets.size) return null;
  return { markets };
}
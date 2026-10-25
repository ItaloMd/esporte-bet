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
import { selectionCode, selectionLabel } from './oddsApi.ts';

/**
 * Mercados solicitados na coleta (identificadores oficiais de `bets`):
 * 1 = Match Winner · 4 = Asian Handicap · 5 = Goals Over/Under.
 */
export const ODDS_BET_IDS = '1,4,5';

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

/** Cotações de uma data inteira em uma única chamada. */
export function fetchOddsByDate(apiKey, base, date) {
  return apiFootballFetch(
    apiKey,
    '/odds',
    { date, timezone: FOOTBALL_TIMEZONE, bet: ODDS_BET_IDS },
    { base, timeoutMs: 25000 },
  );
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

/** Nome do mercado na API-Football → chave interna da aplicação. */
function marketKeyFor(betName) {
  const value = String(betName || '').trim().toLowerCase();
  if (value === 'match winner') return 'h2h';
  if (value === 'goals over/under') return 'totals';
  if (value === 'asian handicap') return 'spreads';
  return null;
}

/**
 * Traduz o valor de uma aposta para o formato interno (`name`/`point`), para
 * reaproveitar os mesmos rótulo e código usados nas demais cotações.
 */
function outcomeFor(marketKey, value, teams) {
  const raw = String(value || '').trim();
  if (marketKey === 'h2h') {
    if (/^home$/i.test(raw)) return { name: teams.home };
    if (/^away$/i.test(raw)) return { name: teams.away };
    if (/^draw$/i.test(raw)) return { name: 'Draw' };
    return null;
  }
  if (marketKey === 'totals') {
    const match = OVER_UNDER.exec(raw);
    if (!match) return null;
    return { name: `${match[1]} ${match[2]}`, point: Number(match[2]) };
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
/**
 * Catálogo de mercados de futebol alimentados pela API-Football (plano Pro).
 *
 * Cada mercado declara o nome oficial do bet em `/odds` e o que a liquidação
 * precisa (placar do intervalo, estatísticas ou eventos). A validação de
 * suporte confere o bet na resposta real da API — nunca presume.
 */
import { slugify } from './oddsApi.ts';

export const MARKET_CATALOG = [
  { key: 'h2h', name: 'Resultado', group: 'principal', provider_bet: 'Match Winner', needs: [], priority: 1 },
  { key: 'btts', name: 'Ambas Marcam', group: 'ambas_marcam', provider_bet: 'Both Teams Score', needs: [], priority: 3 },
  { key: 'totals', name: 'Gols (Mais/Menos)', group: 'gols', provider_bet: 'Goals Over/Under', needs: [], priority: 4 },
  { key: 'spreads', name: 'Handicap', group: 'handicap', provider_bet: 'Asian Handicap', needs: [], priority: 5 },
  { key: 'ht_result', name: 'Resultado 1º Tempo', group: 'intervalo', provider_bet: 'First Half Winner', needs: ['halftime'], priority: 6 },
  { key: 'ht_totals', name: 'Gols 1º Tempo (Mais/Menos)', group: 'intervalo', provider_bet: 'Goals Over/Under First Half', needs: ['halftime'], priority: 8 },
  { key: 'ht_btts', name: 'Ambas Marcam 1º Tempo', group: 'intervalo', provider_bet: 'Both Teams Score - First Half', needs: ['halftime'], priority: 9 },
  { key: 'corners', name: 'Escanteios (Mais/Menos)', group: 'escanteios', provider_bet: 'Corners Over Under', needs: ['statistics'], priority: 10 },
  { key: 'corners_home', name: 'Escanteios Casa (Mais/Menos)', group: 'escanteios', provider_bet: 'Home Corners Over/Under', needs: ['statistics'], priority: 11 },
  { key: 'corners_away', name: 'Escanteios Visitante (Mais/Menos)', group: 'escanteios', provider_bet: 'Away Corners Over/Under', needs: ['statistics'], priority: 12 },
  { key: 'cards', name: 'Cartões (Mais/Menos)', group: 'cartoes', provider_bet: 'Cards Over/Under', needs: ['statistics'], priority: 13 },
  { key: 'cards_home', name: 'Cartões Casa (Mais/Menos)', group: 'cartoes', provider_bet: 'Home Team Total Cards', needs: ['statistics'], priority: 14 },
  { key: 'cards_away', name: 'Cartões Visitante (Mais/Menos)', group: 'cartoes', provider_bet: 'Away Team Total Cards', needs: ['statistics'], priority: 15 },
  { key: 'first_goal', name: 'Time Marca o Primeiro Gol', group: 'especiais', provider_bet: 'Team To Score First', needs: ['events'], priority: 16 },
  { key: 'goal_both_halves', name: 'Gol nos Dois Tempos', group: 'especiais', provider_bet: 'To Score in Both Halves', needs: ['halftime'], priority: 17 },
];

export const MARKET_CATALOG_BY_KEY = new Map(MARKET_CATALOG.map((row) => [row.key, row]));

/** Nome oficial do bet na API-Football → chave interna da aplicação. */
export const BET_NAME_TO_MARKET_KEY = new Map(
  MARKET_CATALOG.map((row) => [row.provider_bet.toLowerCase(), row.key]),
);

/** Chave da liga: id da competição quando vinculado, senão o nome normalizado. */
export function leagueKeyOf(event) {
  return String(event?.competition_id || slugify(event?.competition_name) || 'sem-liga');
}

/** Temporada da partida, com fallback para o ano do jogo. */
export function seasonOf(event) {
  if (event?.season) return String(event.season);
  const year = new Date(event?.start_time || '').getFullYear();
  return Number.isFinite(year) && year > 1990 ? String(year) : '';
}

/**
 * Descoberta de capacidade por liga/temporada: registra se a fonte realmente
 * fornece estatísticas (escanteios, cartões) e eventos (gols) para aquela
 * liga. Ligas sem cobertura ficam visíveis no painel — e a auditoria nunca
 * decide um mercado sem os dados confirmados aqui.
 */
export async function upsertMarketCapability(db, event, statistics, events) {
  const leagueKey = leagueKeyOf(event);
  const season = seasonOf(event);
  if (!season) return null;
  const page = await db.MarketCapability.filter({ league_key: leagueKey, season }, { limit: 1 });
  const existing = page.items?.[0] || null;
  const payload = {
    league_key: leagueKey,
    league_name: event.competition_name || '',
    season,
    statistics_available: Boolean(statistics),
    corners_available: Boolean(statistics && statistics.corners_home !== null && statistics.corners_away !== null),
    cards_available: Boolean(statistics && statistics.cards_home !== null && statistics.cards_away !== null),
    events_available: Boolean(events),
    goals_events_available: Boolean(events && events.goal_count > 0),
    samples: Number(existing?.samples || 0) + 1,
    last_checked_at: new Date().toISOString(),
  };
  if (existing) await db.MarketCapability.update(existing.id, payload);
  else await db.MarketCapability.create(payload);
  return payload;
}
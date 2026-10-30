/**
 * Configuração centralizada das competições brasileiras.
 *
 * A seção Ao Vivo mostra somente partidas brasileiras. A identificação usa o
 * país oficial devolvido pela API-Football (`league.country`), os IDs oficiais
 * das competições nacionais e, como último recurso, tokens de nome para os
 * campeonatos estaduais e regionais que não estão na lista fixa. Não depende
 * exclusivamente da comparação de nomes.
 *
 * Para incluir uma competição nova, basta acrescentar o `league_id` oficial
 * (GET /leagues) na lista abaixo — nenhuma rotina precisa ser alterada.
 */

/** País oficial das competições brasileiras na API-Football. */
export const BRAZIL_COUNTRY = 'Brazil';

/** IDs oficiais das competições nacionais brasileiras. */
export const BRAZILIAN_NATIONAL_LEAGUE_IDS = ['71', '72', '73', '74', '75', '76'];

/** Competições nacionais prioritárias (Série A, Série B e Copa do Brasil). */
export const BRAZILIAN_PRIORITY_LEAGUE_IDS = ['71', '72', '73'];

/**
 * Tokens de nome usados apenas como reforço para estaduais, regionais e
 * copas que mudam de ID a cada temporada. Comparação em minúsculas, sem
 * acentos.
 */
export const BRAZILIAN_NAME_TOKENS = [
  'brasileir',
  'copa do brasil',
  'copa verde',
  'copa do nordeste',
  'supercopa do brasil',
  'paulista',
  'carioca',
  'mineiro',
  'gaucho',
  'baiano',
  'pernambucano',
  'cearense',
  'paranaense',
  'catarinense',
  'goiano',
  'matogrossense',
  'sul-matogrossense',
  'paraense',
  'potiguar',
  'sergipano',
  'alagoano',
  'maranhense',
  'paraibano',
  'piauiense',
  'acreano',
  'amapaense',
  'amazonense',
  'rondoniense',
  'roraimense',
  'tocantinense',
  'capixaba',
  'brasiliense',
  'serie a',
  'serie b',
  'serie c',
  'serie d',
];

/** Remove acentos e normaliza para comparação por token. */
function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Verdadeiro quando a partida pertence a uma competição brasileira.
 * Aceita tanto o registro da entidade Event quanto o item mapeado da API.
 */
export function isBrazilianMatch({ leagueId, country, competitionName } = {}) {
  const league = String(leagueId || '');
  if (league && BRAZILIAN_NATIONAL_LEAGUE_IDS.includes(league)) return true;
  if (normalize(country) === normalize(BRAZIL_COUNTRY)) return true;
  const name = normalize(competitionName);
  if (!name) return false;
  return BRAZILIAN_NAME_TOKENS.some((token) => name.includes(token));
}

/** Mesmo critério, aplicado a um registro de Event já gravado. */
export function isBrazilianEvent(event) {
  return isBrazilianMatch({
    leagueId: event?.league_id || event?.competition_id,
    country: event?.country,
    competitionName: event?.competition_name,
  });
}

/** Verdadeiro quando a competição é uma das nacionais prioritárias. */
export function isPriorityBrazilianLeague(leagueId) {
  return BRAZILIAN_PRIORITY_LEAGUE_IDS.includes(String(leagueId || ''));
}
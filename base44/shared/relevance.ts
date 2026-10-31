/**
 * Pontuação de relevância das partidas (0 a 100), calculada no backend.
 *
 * A pontuação combina cinco componentes configuráveis (entidade
 * RelevanceSettings, sem exigir alteração no frontend):
 *
 * - Competição (até 50): tabela de competições prioritárias usando os IDs
 *   oficiais da API-Football (league.id), com sobreposição por país e nome
 *   para não depender só do rótulo.
 * - Interesse regional (até 20): destaque para o Brasil.
 * - Fase decisiva ou partida ao vivo (até 15): finais, semifinais e
 *   partidas em andamento pontuam mais.
 * - Disponibilidade de odds (até 10): funciona também como critério de
 *   confiabilidade — uma partida sem cotação não recebe pontos artificiais.
 * - Outros (até 5): hoje, o destaque editorial (is_featured).
 *
 * Nenhuma popularidade de clube é presumida: o que não tem critério
 * verificável não pontua. A pontuação é armazenada no evento
 * (relevance_score / relevance_breakdown) e só é recalculada quando os dados
 * relevantes mudam — nunca em cada renderização da interface.
 */
import { slugify } from './oddsApi.ts';

export const DEFAULT_WEIGHTS = {
  competition: 40,
  regional: 15,
  importance: 15,
  data: 10,
  team: 15,
  other: 5,
};

/** Pontuação de competição fora da tabela de prioridades. */
export const DEFAULT_COMPETITION_SCORE = 10;

/** Pontuação padrão de uma equipe marcada como de alta relevância. */
export const DEFAULT_TEAM_SCORE = 40;

/** Estaduais brasileiras: prioridade média por país + token, sem depender de ID. */
const BRAZIL_STATE_TOKENS = [
  'paulista', 'paulistao', 'carioca', 'mineiro', 'gaucho', 'baiano', 'pernambucano',
  'cearense', 'goiano', 'paranaense', 'capixaba', 'paraibano', 'potiguar', 'alagoano',
  'sergipano', 'piauiense', 'maranhense', 'matogrossense', 'brasiliense', 'amazonense',
];

/**
 * Competições prioritárias. `league_id` é o ID oficial da API-Football
 * (league.id); `tokens` são o fallback por país + nome.
 */
export const DEFAULT_PRIORITY_COMPETITIONS = [
  { league_id: '71', name: 'Campeonato Brasileiro Série A', country: 'Brazil', group: 'br', score: 50, tokens: ['serie a', 'brasileirão'] },
  { league_id: '65', name: 'Copa do Brasil', country: 'Brazil', group: 'br', score: 46, tokens: ['copa do brasil'] },
  { league_id: '72', name: 'Campeonato Brasileiro Série B', country: 'Brazil', group: 'br', score: 44, tokens: ['serie b'] },
  { league_id: '475', name: 'Campeonato Paulista', country: 'Brazil', group: 'br', score: 38, tokens: ['paulista', 'paulistao'] },
  { league_id: '416', name: 'Campeonato Carioca', country: 'Brazil', group: 'br', score: 38, tokens: ['carioca'] },
  { league_id: '433', name: 'Campeonato Mineiro', country: 'Brazil', group: 'br', score: 38, tokens: ['mineiro'] },
  { league_id: '419', name: 'Campeonato Gaúcho', country: 'Brazil', group: 'br', score: 38, tokens: ['gaucho'] },
  { league_id: '437', name: 'Campeonato Baiano', country: 'Brazil', group: 'br', score: 38, tokens: ['baiano'] },
  { league_id: '639', name: 'Copa do Nordeste', country: 'Brazil', group: 'br', score: 36, tokens: ['nordeste'] },
  { league_id: '2', name: 'UEFA Champions League', country: 'World', group: 'intl', score: 48, tokens: ['champions league'] },
  { league_id: '1', name: 'Copa do Mundo', country: 'World', group: 'intl', score: 48, tokens: ['world cup', 'copa do mundo'] },
  { league_id: '13', name: 'Copa Libertadores', country: 'World', group: 'intl', score: 46, tokens: ['libertadores'] },
  { league_id: '9', name: 'Copa América', country: 'World', group: 'intl', score: 46, tokens: ['copa america'] },
  { league_id: '39', name: 'Premier League', country: 'England', group: 'intl', score: 44, tokens: ['premier league'] },
  { league_id: '140', name: 'La Liga', country: 'Spain', group: 'intl', score: 43, tokens: ['la liga', 'laliga'] },
  { league_id: '135', name: 'Serie A (Itália)', country: 'Italy', group: 'intl', score: 42, tokens: ['serie a'] },
  { league_id: '78', name: 'Bundesliga', country: 'Germany', group: 'intl', score: 42, tokens: ['bundesliga'] },
  { league_id: '61', name: 'Ligue 1', country: 'France', group: 'intl', score: 40, tokens: ['ligue 1'] },
  { league_id: '128', name: 'Copa Sul-Americana', country: 'World', group: 'intl', score: 40, tokens: ['sul-americana', 'sudamericana'] },
];

export const DEFAULT_COUNTRY_WEIGHTS = { Brazil: 20 };

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBreakdown(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function findPriority(leagueId, competitionName, country, list) {
  const id = String(leagueId || '');
  if (id) {
    const byId = (list || []).find((row) => row?.league_id && String(row.league_id) === id);
    if (byId) return byId;
  }
  const nameKey = slugify(competitionName || '');
  const countryKey = String(country || '').toLowerCase();
  if (!nameKey || !countryKey) return null;
  const byToken = (list || []).find((row) => {
    if (String(row?.country || '').toLowerCase() !== countryKey) return false;
    return (row?.tokens || []).some((token) => nameKey.includes(slugify(token)));
  });
  if (byToken) return byToken;
  if (countryKey === 'brazil' && BRAZIL_STATE_TOKENS.some((token) => nameKey.includes(slugify(token)))) {
    return { league_id: '', name: 'Estadual brasileiro', country: 'Brazil', group: 'br', score: 38, tokens: [] };
  }
  return null;
}

/**
 * Equipe de alta relevância: casa primeiro pelo ID oficial da API-Football e,
 * como reserva, pelo nome normalizado (o ID é sempre a chave confiável).
 */
function findPriorityTeam(teamIds, teamNames, list) {
  const ids = (teamIds || []).map((value) => String(value || '')).filter(Boolean);
  const names = (teamNames || []).map((value) => slugify(value || '')).filter(Boolean);
  return (
    (list || []).find((row) => {
      if (row?.team_id && ids.includes(String(row.team_id))) return true;
      const key = slugify(row?.name || '');
      return Boolean(key) && names.includes(key);
    }) || null
  );
}

/**
 * Fase decisiva (league.round) e partida ao vivo. 'Semi-final' contém 'final',
 * então a ordem dos testes importa.
 */
export function importancePoints(roundLabel, isLive) {
  const label = String(roundLabel || '').toLowerCase();
  if (!label) return isLive ? 8 : 0;
  if (/semi/.test(label)) return 12;
  if (/quarter|8th/.test(label)) return 10;
  if (/16th/.test(label)) return 8;
  if (/final/.test(label)) return 15;
  return isLive ? 8 : 0;
}

export function computeRelevance(input, config, previous = null) {
  const weights = config.weights;
  const entry = findPriority(input.leagueId, input.competitionName, input.country, config.priorityCompetitions);
  const teamEntry = findPriorityTeam(
    [input.homeTeamId, input.awayTeamId],
    [input.homeTeamName, input.awayTeamName],
    config.priorityTeams,
  );
  const scale = (raw, cap, weight) => Math.round(raw * 10 * (weight / cap)) / 10;

  const competition = scale(entry ? entry.score : DEFAULT_COMPETITION_SCORE, 50, weights.competition);
  const regionalRaw = Number(config.countryWeights[String(input.country || '')]) || 0;
  const regional = scale(regionalRaw, 20, weights.regional);

  const roundKey = String(input.roundLabel || '').toLowerCase();
  let importanceRaw;
  if (roundKey) importanceRaw = importancePoints(roundKey, input.isLive);
  else if (previous && Number.isFinite(Number(previous.importance))) importanceRaw = Number(previous.importance);
  else importanceRaw = input.isLive ? 8 : 0;
  const importance = scale(Math.min(importanceRaw, 15), 15, weights.importance);

  const dataRaw = input.oddsAvailable ? (input.published ? 10 : 7) : 0;
  const data = scale(dataRaw, 10, weights.data);
  // Equipe de alta relevância: pontua só quando um dos times foi escolhido no painel.
  const team = teamEntry ? scale(Number(teamEntry.score) || DEFAULT_TEAM_SCORE, 50, weights.team) : 0;
  const other = input.isFeatured ? scale(5, 5, weights.other) : 0;

  const breakdown = {
    competition,
    regional,
    importance,
    data,
    team,
    other,
    group: entry?.group || 'other',
    team_name: teamEntry?.name || '',
    round: String(input.roundLabel || ''),
  };
  const score = Math.min(100, Math.round(competition + regional + importance + data + team + other));
  return { score, breakdown };
}

export function defaultRelevanceConfig() {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    priorityCompetitions: DEFAULT_PRIORITY_COMPETITIONS.map((row) => ({ ...row })),
    priorityTeams: [],
    countryWeights: { ...DEFAULT_COUNTRY_WEIGHTS },
  };
}

/** Lê a configuração salva (RelevanceSettings) ou devolve os padrões. */
export async function loadRelevanceConfig(db) {
  const config = defaultRelevanceConfig();
  try {
    const page = await db.RelevanceSettings.list({ limit: 1 });
    const row = (page.items || [])[0];
    if (!row) return config;
    config.weights = {
      competition: numberOr(row.weight_competition, DEFAULT_WEIGHTS.competition),
      regional: numberOr(row.weight_regional, DEFAULT_WEIGHTS.regional),
      importance: numberOr(row.weight_importance, DEFAULT_WEIGHTS.importance),
      data: numberOr(row.weight_data, DEFAULT_WEIGHTS.data),
      team: numberOr(row.weight_team, DEFAULT_WEIGHTS.team),
      other: numberOr(row.weight_other, DEFAULT_WEIGHTS.other),
    };
    const priority = parseBreakdown(row.priority_competitions);
    if (Array.isArray(priority) && priority.length) config.priorityCompetitions = priority;
    const priorityTeams = parseBreakdown(row.priority_teams);
    if (Array.isArray(priorityTeams)) config.priorityTeams = priorityTeams;
    const countries = parseBreakdown(row.country_weights);
    if (countries && !Array.isArray(countries)) config.countryWeights = countries;
  } catch {
    // Sem configuração salva: usa os padrões.
  }
  return config;
}

/**
 * Pontua um evento (ou um fixture da fonte com os mesmos campos). `extras`
 * sobrepõe dados que só existem no contexto da chamada (rodada da partida ao
 * vivo, cotação recém-escrita etc.). O componente de fase decisiva é reusado do
 * último cálculo quando a rodada não está disponível na fonte consultada.
 */
export function scoreEvent(event, config, extras = {}) {
  const previous = parseBreakdown(event?.relevance_breakdown);
  const roundLabel = extras.round !== undefined ? String(extras.round || '') : String(previous?.round || '');
  const { score, breakdown } = computeRelevance(
    {
      leagueId: extras.leagueId || event?.league_id || event?.competition_id,
      competitionName: extras.competitionName || event?.competition_name,
      country: extras.country || event?.country,
      homeTeamId: event?.home_team_id,
      awayTeamId: event?.away_team_id,
      homeTeamName: event?.home_team_name,
      awayTeamName: event?.away_team_name,
      roundLabel,
      isFeatured: Boolean(event?.is_featured),
      isLive: extras.isLive ?? event?.status === 'live',
      oddsAvailable: extras.oddsAvailable ?? event?.odds_status === 'available',
      published: extras.published ?? Boolean(event?.published),
    },
    config,
    previous,
  );
  return { score, breakdown };
}

/** Grava a nova pontuação no patch quando ela mudou. Retorna o próprio patch. */
export function applyRelevancePatch(patch, event, config, extras = {}) {
  const rel = scoreEvent(event, config, extras);
  if (Number(event?.relevance_score) === rel.score) return patch;
  patch.relevance_score = rel.score;
  patch.relevance_breakdown = JSON.stringify(rel.breakdown);
  patch.relevance_updated_at = new Date().toISOString();
  return patch;
}
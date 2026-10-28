/**
 * Auditoria de apostas de uma partida encerrada: mercado a mercado, a partir
 * do placar confirmado nos 90 minutos (mercados de gols, resultado e BTTS) e
 * das estatísticas oficiais (escanteios e cartões), consultadas após o FT.
 */

const TOTAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const LINE_SUFFIX = { 0.5: '05', 1.5: '15', 2.5: '25', 3.5: '35', 4.5: '45' };

/**
 * Constrói o registro completo de auditoria de uma partida encerrada.
 * Os mercados de gols usam o placar do tempo regulamentar (prorrogação e
 * pênaltis não contam); escanteios e cartões só entram quando as estatísticas
 * foram consultadas.
 */
export function buildBetAudit(event, fixture, { betCount = 0, statistics = null, statisticsSource = '' } = {}) {
  const regHome =
    fixture.reg_home_score !== null && fixture.reg_home_score !== undefined
      ? fixture.reg_home_score
      : fixture.home_score;
  const regAway =
    fixture.reg_away_score !== null && fixture.reg_away_score !== undefined
      ? fixture.reg_away_score
      : fixture.away_score;
  const hasScore = Number.isFinite(regHome) && Number.isFinite(regAway);
  const total = hasScore ? regHome + regAway : null;

  const audit = {
    event_id: event.id,
    fixture_id: fixture.fixture_id,
    competition_name: event.competition_name || fixture.competition_name || '',
    home_team_name: event.home_team_name || fixture.home_team_name || '',
    away_team_name: event.away_team_name || fixture.away_team_name || '',
    home_score: fixture.home_score,
    away_score: fixture.away_score,
    reg_home_score: hasScore ? regHome : 0,
    reg_away_score: hasScore ? regAway : 0,
    total_goals: total === null ? 0 : total,
    btts: Boolean(hasScore && regHome > 0 && regAway > 0),
    home_win: Boolean(hasScore && regHome > regAway),
    draw: Boolean(hasScore && regHome === regAway),
    away_win: Boolean(hasScore && regAway > regHome),
    statistics_fetched: Boolean(statistics),
    statistics_source: statisticsSource,
    events_fetched: false,
    bet_count: Number(betCount) || 0,
    audited_at: new Date().toISOString(),
    note: `Resultado confirmado pela API-Football (${fixture.phase}).${
      statistics
        ? ' Escanteios e cartões lidos das estatísticas oficiais.'
        : ' Sem consulta de estatísticas nesta execução.'
    }`,
  };

  TOTAL_LINES.forEach((line) => {
    const suffix = LINE_SUFFIX[line];
    audit[`over_${suffix}`] = Boolean(total !== null && total > line);
    audit[`under_${suffix}`] = Boolean(total !== null && total < line);
  });

  if (statistics) {
    audit.corners_home = Number(statistics.corners_home) || 0;
    audit.corners_away = Number(statistics.corners_away) || 0;
    audit.cards_home = Number(statistics.cards_home) || 0;
    audit.cards_away = Number(statistics.cards_away) || 0;
  }
  return audit;
}
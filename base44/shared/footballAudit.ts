/**
 * Auditoria de apostas de uma partida encerrada: mercado a mercado, a partir do
 * placar confirmado nos 90 minutos, do placar do intervalo, das estatísticas
 * oficiais (escanteios e cartões, com amarelos e vermelhos separados) e dos
 * eventos da partida (gols, com o primeiro gol e seu minuto).
 */

const TOTAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const CORNER_LINES = [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5];
const CARD_LINES = [1.5, 2.5, 3.5, 4.5, 5.5];
const LINE_SUFFIX = {
  0.5: '05', 1.5: '15', 2.5: '25', 3.5: '35', 4.5: '45',
  5.5: '55', 6.5: '65', 7.5: '75', 8.5: '85', 9.5: '95', 10.5: '105', 11.5: '115',
};

/**
 * Constrói o registro completo de auditoria de uma partida encerrada, com o
 * relatório textual: resultado, mercados vencedores e perdedores, estatísticas
 * e eventos utilizados, horário da auditoria e fonte dos dados.
 */
export function buildBetAudit(event, fixture, {
  betCount = 0,
  statistics = null,
  statisticsSource = '',
  events = null,
  eventsSource = '',
} = {}) {
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
  const htHome = Number(fixture.ht_home_score);
  const htAway = Number(fixture.ht_away_score);
  const htAvailable = Number.isFinite(htHome) && Number.isFinite(htAway);
  const htTotal = htAvailable ? htHome + htAway : null;
  const secondHalfTotal = hasScore && htAvailable ? total - htTotal : null;
  const firstGoal = events?.first_goal || null;

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
    events_fetched: Boolean(events),
    events_source: eventsSource,
    bet_count: Number(betCount) || 0,
    audited_at: new Date().toISOString(),
  };

  if (htAvailable) {
    audit.ht_home_score = htHome;
    audit.ht_away_score = htAway;
  }
  if (htTotal !== null) audit.goal_first_half = htTotal;
  if (secondHalfTotal !== null) audit.goal_second_half = secondHalfTotal;
  if (firstGoal) {
    audit.first_goal_minute = firstGoal.minute;
    audit.first_goal_team = firstGoal.side;
    audit.first_goal_detail = `${firstGoal.team_name} · ${firstGoal.detail}`;
  }

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
    audit.yellow_home = Number(statistics.yellow_home) || 0;
    audit.yellow_away = Number(statistics.yellow_away) || 0;
    audit.red_home = Number(statistics.red_home) || 0;
    audit.red_away = Number(statistics.red_away) || 0;
  }

  /* Relatório completo: resultado, mercados vencedores/perdedores, dados
     utilizados, horário e fonte — gravado junto à auditoria estruturada. */
  const won = [];
  const lost = [];
  if (hasScore) {
    if (audit.home_win) won.push('casa vence');
    else lost.push('casa vence');
    if (audit.draw) won.push('empate');
    else lost.push('empate');
    if (audit.away_win) won.push('visitante vence');
    else lost.push('visitante vence');
    if (audit.btts) won.push('ambas marcam');
    else lost.push('ambas marcam');
    if (regHome >= regAway) won.push('dupla chance 1x');
    else lost.push('dupla chance 1x');
    if (regHome !== regAway) won.push('dupla chance 12');
    else lost.push('dupla chance 12');
    if (regAway >= regHome) won.push('dupla chance x2');
    else lost.push('dupla chance x2');
    TOTAL_LINES.forEach((line) => {
      if (audit[`over_${LINE_SUFFIX[line]}`]) won.push(`mais de ${line} gols`);
      else lost.push(`mais de ${line} gols`);
    });
  }
  if (htAvailable) {
    const htWinner = htHome > htAway ? 'casa' : htHome < htAway ? 'visitante' : 'empate';
    won.push(`resultado 1º tempo: ${htWinner}`);
    if (htHome >= htAway) won.push('dupla chance 1x 1º tempo');
    else lost.push('dupla chance 1x 1º tempo');
    if (htHome > 0 && htAway > 0) won.push('ambas marcam 1º tempo');
    else lost.push('ambas marcam 1º tempo');
    if (secondHalfTotal !== null) {
      if (htTotal > 0 && secondHalfTotal > 0) won.push('gol nos dois tempos');
      else lost.push('gol nos dois tempos');
    }
  }
  if (firstGoal) {
    won.push(`primeiro gol: ${firstGoal.side === 'home' ? 'casa' : 'visitante'} aos ${firstGoal.minute}'`);
  }
  if (statistics && statistics.corners_home !== null && statistics.corners_away !== null) {
    const cornersTotal = Number(statistics.corners_home) + Number(statistics.corners_away);
    CORNER_LINES.forEach((line) => {
      if (cornersTotal > line) won.push(`escanteios mais de ${line}`);
      else if (cornersTotal < line) lost.push(`escanteios mais de ${line}`);
    });
  }
  if (statistics && statistics.cards_home !== null && statistics.cards_away !== null) {
    const cardsTotal = Number(statistics.cards_home) + Number(statistics.cards_away);
    CARD_LINES.forEach((line) => {
      if (cardsTotal > line) won.push(`cartões mais de ${line}`);
      else if (cardsTotal < line) lost.push(`cartões mais de ${line}`);
    });
  }

  audit.audit_report = [
    `Auditoria automática concluída em ${audit.audited_at}`,
    `Fonte dos dados: API-Football (/fixtures${statisticsSource ? ', /fixtures/statistics' : ''}${eventsSource ? ', /fixtures/events' : ''})`,
    `Resultado: ${hasScore ? `${regHome} x ${regAway} (tempo regulamentar)` : 'sem placar confirmado'}${htAvailable ? ` · 1º tempo ${htHome} x ${htAway}` : ''}`,
    `Mercados vencedores: ${won.join(', ') || '—'}`,
    `Mercados perdedores: ${lost.join(', ') || '—'}`,
    statistics
      ? `Estatísticas utilizadas: escanteios ${audit.corners_home} x ${audit.corners_away} · cartões ${audit.cards_home} x ${audit.cards_away} (amarelos ${audit.yellow_home + audit.yellow_away}, vermelhos ${audit.red_home + audit.red_away})`
      : 'Estatísticas utilizadas: não consultadas nesta auditoria',
    firstGoal
      ? `Eventos utilizados: ${events.goal_count} gol(s) · primeiro gol de ${firstGoal.team_name} aos ${firstGoal.minute}' (${firstGoal.detail})`
      : 'Eventos utilizados: não consultados nesta auditoria',
  ].join(' · ').slice(0, 2000);

  return audit;
}
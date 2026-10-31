/**
 * Simulador de consumo da API-Football — cálculo puro, no navegador.
 *
 * Espelha a arquitetura real: o detector global (live=all) cobre todas as
 * partidas ao vivo em uma única chamada; checagens extras só acontecem para
 * partidas em minutos finais quando o intervalo crítico é menor que o do
 * detector; auditorias consultam até 20 partidas por chamada; estatísticas
 * só são consultadas para partidas com apostas.
 */
export const SIM_DEFAULTS = {
  liveIntervalMinutes: 10,
  monitorDefaultMinutes: 10,
  monitorBetsMinutes: 10,
  monitorFavoritesMinutes: 10,
  monitorCriticalMinutes: 10,
  criticalFromMinute: 80,
  gamesPerDay: 40,
  liveSimultaneous: 8,
  betGames: 10,
  favoriteGames: 5,
  calendarDays: 7,
  oddsCallsPerDay: 96,
  planLimit: 7500,
};

export function simulateConsumption(input) {
  const p = { ...SIM_DEFAULTS, ...input };
  const gamesPerDay = Math.max(0, Number(p.gamesPerDay));
  const liveSimultaneous = Math.max(1, Number(p.liveSimultaneous));

  // Janela em que existe algum jogo ao vivo: ~2h por jogo, distribuída pelas partidas simultâneas.
  const coverageHours = Math.min(24, Math.max(1, (gamesPerDay * 2) / liveSimultaneous));
  const liveCallsPerDay = Math.ceil((coverageHours * 60) / Math.max(0.5, Number(p.liveIntervalMinutes)));

  // Checagens extras de minutos finais, em lote de até 20 partidas por chamada,
  // só quando o intervalo crítico é menor que o do detector.
  const criticalSimultaneous = Math.max(0, Math.round(liveSimultaneous * 0.1));
  const criticalCallsPerDay =
    Number(p.monitorCriticalMinutes) < Number(p.liveIntervalMinutes) && criticalSimultaneous > 0
      ? Math.ceil(criticalSimultaneous / 20) * liveCallsPerDay
      : 0;

  // Auditoria de encerramento: ~1,3 consultas por partida, 20 partidas por chamada.
  const auditCallsPerDay = Math.ceil((gamesPerDay * 1.3) / 20);
  // Estatísticas oficiais: 1 consulta por partida com apostas pendentes.
  const statsCallsPerDay = Math.max(0, Number(p.betGames));
  const calendarCallsPerDay = Math.max(0, Number(p.calendarDays));
  const oddsCallsPerDay = Math.max(0, Number(p.oddsCallsPerDay));

  const perDay = liveCallsPerDay + criticalCallsPerDay + auditCallsPerDay + statsCallsPerDay + calendarCallsPerDay + oddsCallsPerDay;
  const perHour = Math.round((perDay / 24) * 10) / 10;
  const perWeek = perDay * 7;
  const perMonth = perDay * 30;

  const planLimit = Math.max(1, Number(p.planLimit));
  const percentOfDay = Math.round((perDay / planLimit) * 1000) / 10;
  const percentOfMonth = Math.round((perMonth / (planLimit * 30)) * 1000) / 10;
  const safetyMargin = Math.max(0, Math.round((100 - percentOfMonth) * 10) / 10);

  const breakdown = [
    { name: "Detector ao vivo", calls: liveCallsPerDay },
    { name: "Críticos", calls: criticalCallsPerDay },
    { name: "Auditoria", calls: auditCallsPerDay },
    { name: "Estatísticas", calls: statsCallsPerDay },
    { name: "Calendário", calls: calendarCallsPerDay },
    { name: "Odds", calls: oddsCallsPerDay },
  ];

  return {
    perHour,
    perDay,
    perWeek,
    perMonth,
    percentOfDay,
    percentOfMonth,
    safetyMargin,
    coverageHours: Math.round(coverageHours * 10) / 10,
    breakdown,
    risk: percentOfMonth >= 90 ? "critical" : percentOfMonth >= 75 ? "high" : percentOfMonth >= 50 ? "medium" : "low",
  };
}
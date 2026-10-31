/**
 * Custo estimado das duas estratégias de coleta de cotações.
 *
 * `/odds` entrega 10 partidas por página e aceita `date` (lote do dia) ou
 * `fixture` (uma partida). Nenhuma das duas é sempre mais barata: um dia com 40
 * jogos custa 4 páginas para trazer 2 partidas curadas, enquanto consultar
 * apenas as 2 partidas curadas custa 2 chamadas. A escolha é feita antes da
 * execução, comparando as duas estimativas — sempre com o custo expresso em
 * requisições HTTP, nunca em número de odds.
 */
export const ODDS_STRATEGY = {
  /** Partidas por página na resposta oficial de `/odds`. */
  fixturesPerPage: 10,
  /** Acima deste número consultar partida por partida deixa de valer a pena. */
  maxFixtureCalls: 4,
};

/**
 * Compara as duas estratégias para um lote (competição + temporada + data).
 *
 * - `date`: páginas necessárias para cobrir todas as partidas do lote no dia.
 * - `fixture`: uma chamada por partida curada, trazendo só o que interessa.
 */
export function chooseOddsStrategy({ fixturesInLot = 0, curatedFixtures = 0, maxPages = 3 } = {}) {
  const pageCap = Math.max(1, Number(maxPages) || 1);
  const total = Math.max(1, Number(fixturesInLot) || 0);
  const datePages = Math.min(pageCap, Math.max(1, Math.ceil(total / ODDS_STRATEGY.fixturesPerPage)));
  const fixtureCalls = Math.max(0, Number(curatedFixtures) || 0);

  if (fixtureCalls > 0 && fixtureCalls <= ODDS_STRATEGY.maxFixtureCalls && fixtureCalls < datePages) {
    return {
      strategy: 'fixture',
      calls: fixtureCalls,
      date_pages: datePages,
      reason: `${fixtureCalls} partida(s) curada(s) contra ${datePages} página(s) do dia inteiro`,
    };
  }
  return {
    strategy: 'date',
    calls: datePages,
    date_pages: datePages,
    reason: `${datePages} página(s) do dia cobrem ${total} partida(s) do lote`,
  };
}
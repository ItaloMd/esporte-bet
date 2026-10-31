/**
 * Parâmetros da integração API-Football em um único lugar.
 *
 * Base: documentação v3 (API-SPORTS) e o manual "How to optimize API-SPORTS
 * calls and quota usage". Três fatos da documentação guiam este arquivo:
 *
 * 1. Existem DOIS limites independentes e ambos vêm nos cabeçalhos de toda
 *    resposta: diário (`x-ratelimit-requests-limit/remaining`) e por minuto
 *    (`X-RateLimit-Limit/Remaining`). O provedor avisa que excesso de tráfego
 *    por minuto pode bloquear o acesso no firewall — então a fila precisa
 *    ficar sempre abaixo do limite por minuto, com folga.
 * 2. `/status` não consome cota diária e é a fonte oficial do consumo.
 * 3. Dados têm ritmos diferentes (estáticos, semidinâmicos e dinâmicos): cada
 *    classe tem sua própria validade de cache e nenhuma rotina repete uma
 *    chamada ainda válida.
 *
 * Regra da casa: nenhuma rotina define intervalo, validade de cache ou teto de
 * requisição por conta própria. Tudo que controla frequência e consumo vive
 * aqui; o painel (ProviderSettings) só ajusta o que é operacional.
 *
 * Plano contratado: 7.500 requisições/dia e 300/minuto.
 */

/** Frequência das rotinas de coleta (segundos / minutos / dias). */
export const FOOTBALL_CADENCE = {
  /** Detector ao vivo: uma chamada global a cada 10 minutos (cadência padrão). */
  liveSeconds: 600,
  /** Detector sem partida em andamento: desacelera para não gastar cota. */
  liveIdleSeconds: 900,
  /** Janela de partidas futuras mantida no sistema. */
  calendarDays: 7,
  /** Importação do calendário: uma vez ao dia, sem reconsultar datas já importadas. */
  calendarRefreshSeconds: 86400,
  /** Validade das cotações pré-jogo de um lote (competição + data). */
  oddsRefreshSeconds: 3600,
  /** Janela de datas com cotação mantida no sistema. */
  oddsWindowDays: 7,
  /**
   * Páginas de `/odds` por lote. A fonte entrega 10 partidas por página e
   * informa o total em `paging.total`: sem ler as páginas seguintes, uma
   * competição com mais de 10 jogos no dia fica com metade da grade sem preço.
   */
  oddsMaxPages: 3,
  /** Teto de suspeitas de encerramento confirmadas por execução do detector. */
  suspectsPerRun: 100,
  /** Horas após o início a partir das quais a partida entra na auditoria. */
  auditOffsetHours: 2,
};

/** Validade dos dados por tipo (segundos) — classe dinâmica e semidinâmica. */
export const FOOTBALL_TTL = {
  /** Estatísticas e eventos durante o jogo. */
  liveStats: 300,
  /** Estatísticas e eventos depois do encerramento: dado estável. */
  finalStats: 86400,
  /** Confrontos diretos e últimos jogos: muda no máximo uma vez por dia. */
  history: 86400,
  /** Marca de busca em andamento usada para deduplicar execuções simultâneas. */
  inflight: 25,
  /** Sinal de "partida ao vivo recente" usado para decidir a cadência do detector. */
  liveSignal: 900,
};

/**
 * Cache compartilhado por tipo de dado (segundos) — equivalente ao Redis:
 * a mesma chave devolve o dado sem tocar no provedor enquanto estiver válida.
 * A classificação segue o manual: estático (meses), semidinâmico (horas) e
 * dinâmico (minutos, só com o dado em uso).
 */
export const FOOTBALL_CACHE_TTL = {
  /** live_fixtures: o retrato do coletor vale um ciclo completo de 10 minutos. */
  live: 600,
  /** Cotações pré-jogo. */
  odds: 300,
  /** Prognósticos do provedor: muda no máximo uma vez por dia. */
  predictions: 86400,
  /** Classificações: atualizam por rodada. */
  standings: 43200,
  /** Estatísticas de equipe e de jogador. */
  teamStatistics: 86400,
  playersStatistics: 86400,
};

/** Chave do cache do retrato ao vivo (equivalente ao Redis live_fixtures). */
export const LIVE_CACHE_KEY = 'live:fixtures';

/**
 * Prioridades da fila de cotações PRÉ-JOGO e cadência base de atualização
 * (segundos). Nada aqui é tempo real: a cotação é um retrato do mercado antes
 * do apito, e o intervalo cresce conforme a partida está mais longe.
 */
export const ODDS_PRIORITY = {
  /** Partida com aposta aberta: preço precisa acompanhar até a liquidação. */
  APOSTA_ABERTA: 1800,
  /** Partida favorita do jogador: atualização horária. */
  FAVORITA: 3600,
  /** Partida de alta relevância (ou perto do início): de 2 em 2 horas. */
  CRITICA: 7200,
  /** Demais partidas curadas da janela: de 6 em 6 horas. */
  NORMAL: 21600,
};

/** Ordem de atendimento da fila de cotações (a mais urgente primeiro). */
export const ODDS_PRIORITY_ORDER = ['APOSTA_ABERTA', 'FAVORITA', 'CRITICA', 'NORMAL'];

/**
 * Curadoria de cotações. A janela de 7 dias tem milhares de partidas e o
 * orçamento não comporta todas: só recebe preço a partida que o jogador pode
 * encontrar na grade — competição/time de relevância, favorita ou com aposta.
 */
export const ODDS_CURATION = {
  /** Relevância mínima (0 a 100) para a partida entrar na fila de cotações. */
  minRelevance: 40,
  /** A partir daqui a partida é tratada como alta prioridade. */
  highRelevance: 70,
  /** Lotes (competição + data) coletados por execução. */
  maxLotsPerRun: 10,
  /** Teto de partidas na fila: protege o banco e a cota. */
  maxQueueItems: 400,
};

/**
 * Cadência de atualização de uma partida, em segundos: aposta aberta e
 * favorita mandam; nas demais, quanto mais perto do início, mais curto o
 * intervalo.
 */
export function oddsCadenceSeconds({ hoursToKickoff = 24, hasBets = false, isFavorite = false } = {}) {
  if (hasBets) return ODDS_PRIORITY.APOSTA_ABERTA;
  if (isFavorite) return ODDS_PRIORITY.FAVORITA;
  if (hoursToKickoff <= 6) return ODDS_PRIORITY.APOSTA_ABERTA;
  if (hoursToKickoff <= 24) return ODDS_PRIORITY.FAVORITA;
  if (hoursToKickoff <= 72) return ODDS_PRIORITY.CRITICA;
  return ODDS_PRIORITY.NORMAL;
}

/** Validade do cache de um lote (competição + data), pela partida mais próxima. */
export function oddsLotTtlSeconds(hoursToKickoff = 24) {
  return oddsCadenceSeconds({ hoursToKickoff });
}

/**
 * Divisão do orçamento diário interno por finalidade, em percentual.
 * Não é um teto rígido de gasto: serve para uma rotina não consumir a cota que
 * pertence a outra. Somam 100%.
 */
export const FOOTBALL_BUDGET = {
  live: 40,
  odds: 35,
  audit: 25,
};

/**
 * Faixas de contenção do orçamento diário (percentual consumido).
 * Abaixo da faixa crítica tudo roda; nas faixas altas só o essencial continua.
 */
export const FOOTBALL_BUDGET_GUARD = {
  /** A partir daqui as cotações sem prioridade crítica são suspensas. */
  suspendOdds: 85,
  /** A partir daqui só placares e apuração de resultados. */
  criticalOnly: 95,
};

/**
 * Plano Pro: 300 requisições por minuto. O espaçamento mínimo entre chamadas é
 * de 230 ms (~260/min, 13% de folga) e a janela de 60 s nunca passa de 90% do
 * plano (270), mesmo com execuções simultâneas.
 */
export const PROVIDER_MINUTE_LIMIT = 300;
export const PROVIDER_MINUTE_SAFETY = 0.9;
export const REQUEST_GAP_MS = 230;

/**
 * Plano: 5 requisições por segundo. O teto interno fica em 4/s. O espaçamento
 * entre chamadas não basta — duas execuções simultâneas podem disparar no mesmo
 * segundo —, por isso existe uma janela de 1 s compartilhada por todas.
 */
export const PROVIDER_SECOND_LIMIT = 5;

/** X-RateLimit-Remaining abaixo deste valor fecha o minuto e pausa a fila. */
export const PROVIDER_REMAINING_FLOOR = 3;

/**
 * Saldo diário do provedor abaixo do qual a coleta para por completo, até a
 * virada do dia (00:00 UTC). Guardar algumas chamadas evita chegar a zero no
 * meio de uma apuração de resultado.
 */
export const PROVIDER_DAILY_FLOOR = 10;

/** Pausa mínima após 429 por minuto. O bloqueio do provedor é contado por minuto. */
export const RATE_LIMIT_PAUSE_MIN_MS = 2000;

/** Backoff exponencial entre tentativas de rede/5xx (nunca em 429). */
export const BACKOFF_STEPS_MS = [1000, 2000, 4000];

/** Orçamento e proteção de consumo. */
export const FOOTBALL_LIMITS = {
  /**
   * Teto interno por minuto: 90% dos 300/min do plano Pro. É também o teto
   * absoluto — o painel pode reduzir, nunca aumentar.
   */
  minuteRequests: Math.floor(PROVIDER_MINUTE_LIMIT * PROVIDER_MINUTE_SAFETY),
  /** Orçamento diário interno (abaixo dos 7.500 do plano, com margem). */
  dailyRequests: 6000,
  /** Chamadas preservadas para placares ao vivo antes de qualquer outra rotina. */
  reservePlacares: 10,
  /** Teto interno por segundo (o plano permite 5). Janela de 1 s compartilhada. */
  secondRequests: 4,
  /** Tentativas por chamada em falha de rede/5xx (429 nunca é retentado). */
  maxAttempts: 1,
};

/**
 * Folga aplicada ao comparar "última execução" com o intervalo configurado: o
 * registro só é gravado no fim da execução, então a diferença entre dois ciclos
 * agendados é sempre um pouco menor que o intervalo.
 */
export const CADENCE_TOLERANCE_MS = 120000;

/**
 * Próxima virada do contador diário do provedor: 00:00 UTC (a conta API-SPORTS
 * renova o dia em UTC, não no fuso local).
 */
export function nextProviderDayStartMs(nowMs) {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 1, 0);
}

/**
 * Validade do cache compartilhado, por classe de dado (manual API-SPORTS):
 * estático (referência, dias), semidinâmico (horas) e dinâmico (segundos, só
 * com o dado em uso). Zero significa "nunca cachear".
 */
export function cacheTtlSeconds(endpoint, params = {}) {
  const path = String(endpoint || '');
  const has = (name) => {
    const value = params?.[name];
    return value !== undefined && value !== null && value !== '';
  };
  if (path === '/status') return 0; // consulta ao vivo, não consome cota diária
  if (path.startsWith('/odds/live')) return 10; // dinâmico
  if (path === '/odds') return 300; // cotações pré-jogo
  if (path === '/odds/bookmakers') return 604800; // estático: catálogo de casas
  if (path === '/odds/bets') return 3600; // semidinâmico: bets liberados pelo plano
  if (path === '/fixtures/events') return 30; // dinâmico
  if (path === '/fixtures/statistics') return 60; // dinâmico
  if (path === '/fixtures/lineups') return 120;
  if (path === '/fixtures/players') return 300;
  if (path === '/fixtures') {
    if (has('live')) return 15; // placar ao vivo
    if (has('ids')) return 120;
    if (has('date') || has('from') || has('to')) return 900; // calendário
    return 600;
  }
  if (path === '/leagues') return 86400; // estático: cobertura oficial
  if (path === '/countries') return 604800;
  if (path === '/standings') return 1800; // semidinâmico
  if (path === '/fixtures/headtohead') return 86400;
  if (path.startsWith('/teams/statistics')) return 86400;
  if (path.startsWith('/players')) return 86400;
  return 120;
}

/** Chave estável do cache: endpoint + parâmetros ordenados. */
export function cacheKeyFor(endpoint, params = {}) {
  const entries = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`);
  return `${String(endpoint || '')}?${entries.join('&')}`;
}
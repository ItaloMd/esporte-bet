/**
 * Parâmetros da integração API-Football em um único lugar.
 *
 * Regra da casa: nenhuma rotina define intervalo, validade de cache ou teto de
 * requisição por conta própria. Tudo que controla frequência e consumo vive
 * aqui; o painel (ProviderSettings) pode sobrescrever apenas o que é operacional
 * (intervalo do detector, orçamento diário, teto por minuto).
 *
 * Plano contratado: 7.500 requisições/dia e 300/minuto. Os valores internos são
 * conservadores por decisão de operação, não por limite do provedor.
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
  /**
   * Cotações: dias de calendário coletados por execução. Acompanha a janela de
   * importação (today + 6) para que todos os jogos do calendário tenham cotação
   * e apareçam publicados na grade.
   */
  oddsWindowDays: 7,
  /** Validade das cotações pré-jogo de um dia. */
  oddsRefreshSeconds: 3600,
  /** Páginas máximas de /odds por dia (10 partidas por página). */
  oddsMaxPages: 3,
  /** Teto de suspeitas de encerramento confirmadas por execução do detector. */
  suspectsPerRun: 100,
  /** Horas após o início a partir das quais a partida entra na auditoria. */
  auditOffsetHours: 2,
};

/** Validade dos dados por tipo (segundos). */
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
 * Prioridades da fila de cotações e sua cadência de atualização (segundos).
 * Nenhuma partida fora desta fila recebe cotação.
 */
export const ODDS_PRIORITY = {
  CRITICA: 60,
  FAVORITA: 120,
  APOSTA_ABERTA: 180,
  NORMAL: 300,
};

/** Ordem de atendimento da fila de cotações (a mais urgente primeiro). */
export const ODDS_PRIORITY_ORDER = ['CRITICA', 'FAVORITA', 'APOSTA_ABERTA', 'NORMAL'];

/** Reserva do orçamento diário por finalidade, em percentual. */
export const FOOTBALL_BUDGET = {
  live: 40,
  odds: 30,
  audit: 20,
  emergency: 10,
};

/** Faixas de contenção do orçamento diário (percentual consumido). */
export const FOOTBALL_BUDGET_GUARD = {
  /** A partir daqui as cotações normais são suspensas. */
  suspendOdds: 80,
  /** A partir daqui só jogos críticos e apuração de resultados. */
  criticalOnly: 90,
};

/** Degraus do backoff do disjuntor, em segundos (429). */
export const CIRCUIT_BREAKER_STEPS = [30, 60, 120, 300];

/**
 * Pausa global após limite excedido (segundos). É curta de propósito: o
 * bloqueio do provedor é contado por minuto, então travar a coleta por vários
 * minutos só atrasa o ciclo seguinte.
 */
export const THROTTLE_PAUSE_STEPS = [20, 30, 45, 90];

/** Tokens preservados no token bucket global antes de qualquer nova chamada. */
export const TOKEN_BUCKET_RESERVE = 20;

/** Orçamento e proteção de consumo. */
export const FOOTBALL_LIMITS = {
  /** Teto interno por minuto: 1/5 do limite do plano, muito acima da demanda. */
  minuteRequests: 60,
  /** Orçamento diário interno (abaixo dos 7.500 do plano, com margem). */
  dailyRequests: 6000,
  /** Chamadas preservadas para placares ao vivo antes de qualquer outra rotina. */
  reservePlacares: 10,
  /** Tentativas por chamada em falha de rede/5xx (429 nunca é retentado). */
  maxAttempts: 2,
};

/**
 * Folga aplicada ao comparar "última execução" com o intervalo configurado: o
 * registro só é gravado no fim da execução, então a diferença entre dois ciclos
 * agendados é sempre um pouco menor que o intervalo. Dois minutos de folga
 * garantem que o ciclo seguinte execute no horário, sem virar 20 minutos.
 */
export const CADENCE_TOLERANCE_MS = 120000;
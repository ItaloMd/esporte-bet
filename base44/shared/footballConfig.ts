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
  /** Detector ao vivo com partidas em andamento (recomendação da documentação). */
  liveSeconds: 60,
  /** Detector ao vivo sem partida em andamento: desacelera para não gastar cota. */
  liveIdleSeconds: 300,
  /** Janela de partidas futuras mantida no sistema. */
  calendarDays: 7,
  /** Cotações: dias de calendário coletados por execução (hoje + amanhã). */
  oddsWindowDays: 2,
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

/** Folga aplicada ao comparar "última execução" com o intervalo configurado. */
export const CADENCE_TOLERANCE_MS = 5000;
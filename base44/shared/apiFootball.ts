/**
 * Cliente e mapeamento da API-Football v3 (API-Sports).
 *
 * Nenhum segredo é lido aqui: a chave chega por parâmetro, sempre vinda do
 * backend. O frontend nunca fala com a API-Football — apenas com as funções
 * de backend, que reutilizam o cache compartilhado.
 */

import { slugify } from './oddsApi.ts';

export const DEFAULT_BASE_URL = "https://v3.football.api-sports.io";

/** Fuso oficial de exibição e de agrupamento por dia. */
export const FOOTBALL_TIMEZONE = "America/Sao_Paulo";

export function footballApiBase(settings) {
  return String(settings?.football_base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/* ------------------------------- status ------------------------------- */

/**
 * Status oficiais de `fixture.status.short` (documentação v3).
 *
 * - `status` é o valor aceito pela entidade Event (enum fechado).
 * - `live` indica partida em andamento; `finished` resultado confirmado.
 * - `void` marca partidas que não serão jogadas (seleções anuladas).
 * - `review` marca situações que exigem decisão humana: nunca são liquidadas
 *   automaticamente a partir do placar.
 */
export const FIXTURE_STATUS = {
  TBD: { status: "scheduled", label: "Data a definir" },
  NS: { status: "scheduled", label: "Não iniciada" },
  "1H": { status: "live", label: "1º tempo", live: true },
  HT: { status: "live", label: "Intervalo", live: true },
  "2H": { status: "live", label: "2º tempo", live: true },
  ET: { status: "live", label: "Prorrogação", live: true, extraTime: true },
  BT: { status: "live", label: "Intervalo da prorrogação", live: true, extraTime: true },
  P: { status: "live", label: "Pênaltis", live: true, extraTime: true, penalties: true },
  SUSP: { status: "live", label: "Suspensa", live: true, review: true },
  INT: { status: "live", label: "Interrompida", live: true, review: true },
  LIVE: { status: "live", label: "Em andamento", live: true },
  FT: { status: "finished", label: "Encerrada", finished: true },
  AET: { status: "finished", label: "Encerrada na prorrogação", finished: true, extraTime: true },
  PEN: { status: "finished", label: "Encerrada nos pênaltis", finished: true, extraTime: true, penalties: true },
  PST: { status: "postponed", label: "Adiada", void: true },
  CANC: { status: "cancelled", label: "Cancelada", void: true },
  ABD: { status: "cancelled", label: "Abandonada", review: true },
  AWD: { status: "finished", label: "Resultado por decisão", finished: true, review: true },
  WO: { status: "finished", label: "Vitória por W.O.", finished: true, review: true },
};

export function fixtureStatus(short) {
  return FIXTURE_STATUS[String(short || "").toUpperCase()] || { status: "scheduled", label: "Não iniciada" };
}

/** Situações em que a partida não será disputada: as seleções são anuladas. */
export const VOID_FIXTURE_STATUSES = ["PST", "CANC"];

/** Situações em que o resultado oficial não decide a aposta sozinho. */
export const REVIEW_FIXTURE_STATUSES = ["SUSP", "INT", "ABD", "AWD", "WO"];

/* ------------------------------- mapeamento ------------------------------- */

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normaliza um item de `/fixtures` para os campos usados pela aplicação.
 *
 * O placar exibido é o placar corrente (ou final). O placar do tempo
 * regulamentar é preservado separadamente porque os mercados principais
 * (resultado, totais, handicap) são decididos nos 90 minutos — prorrogação e
 * pênaltis não entram nessa conta.
 */
export function mapFixture(fixture) {
  const info = fixtureStatus(fixture?.fixture?.status?.short);
  const goals = fixture?.goals || {};
  const score = fixture?.score || {};
  const fulltime = score.fulltime || {};
  const halftime = score.halftime || {};
  const extraTimeScore = score.extratime || {};
  const penaltyScore = score.penalty || {};

  const home = numberOrNull(goals.home);
  const away = numberOrNull(goals.away);
  const htHome = numberOrNull(halftime.home);
  const htAway = numberOrNull(halftime.away);
  const hasExtraTime = numberOrNull(extraTimeScore.home) !== null || numberOrNull(extraTimeScore.away) !== null;
  const hasPenalties = numberOrNull(penaltyScore.home) !== null || numberOrNull(penaltyScore.away) !== null;
  const regHome = numberOrNull(fulltime.home);
  const regAway = numberOrNull(fulltime.away);
  const regulationAvailable = (hasExtraTime || hasPenalties) && regHome !== null && regAway !== null;

  const elapsed = numberOrNull(fixture?.fixture?.status?.elapsed);
  const extra = numberOrNull(fixture?.fixture?.status?.extra);
  const minute = elapsed === null ? null : elapsed + (extra && extra > 0 ? extra : 0);

  const startTime = fixture?.fixture?.date ? new Date(fixture.fixture.date).toISOString() : null;

  return {
    fixture_id: fixture?.fixture?.id ? String(fixture.fixture.id) : null,
    competition_id: fixture?.league?.id ? String(fixture.league.id) : null,
    competition_name: fixture?.league?.name || "",
    country: fixture?.league?.country || "",
    season: fixture?.league?.season ? String(fixture.league.season) : "",
    round: fixture?.league?.round || "",
    home_team_id: fixture?.teams?.home?.id ? String(fixture.teams.home.id) : null,
    home_team_name: fixture?.teams?.home?.name || "",
    home_team_crest: fixture?.teams?.home?.logo || null,
    away_team_id: fixture?.teams?.away?.id ? String(fixture.teams.away.id) : null,
    away_team_name: fixture?.teams?.away?.name || "",
    away_team_crest: fixture?.teams?.away?.logo || null,
    start_time: startTime,
    status: info.status,
    phase: String(fixture?.fixture?.status?.short || "").toUpperCase(),
    phase_label: info.label,
    minute,
    home_score: home,
    away_score: away,
    ht_home_score: htHome,
    ht_away_score: htAway,
    reg_home_score: regulationAvailable ? regHome : null,
    reg_away_score: regulationAvailable ? regAway : null,
    extra_time: Boolean(info.extraTime || hasExtraTime),
    penalties: Boolean(info.penalties || hasPenalties),
    venue: fixture?.fixture?.venue?.name || "",
    live: Boolean(info.live),
    finished: Boolean(info.finished),
    void: Boolean(info.void),
    review: Boolean(info.review),
  };
}

/** Texto curto de status para exibição (com o minuto quando disponível). */
export function phaseText(mapped) {
  if (!mapped) return "";
  if (mapped.status === "live" && mapped.minute) return `${mapped.phase_label} · ${mapped.minute}'`;
  return mapped.phase_label || "";
}

/* ------------------------------- requisições ------------------------------- */

function parseQuota(headers) {
  const read = (name) => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    limit: read("x-ratelimit-requests-limit"),
    remaining: read("x-ratelimit-requests-remaining"),
    used: read("x-ratelimit-requests-used"),
    // Limite por minuto devolvido pelo provedor (X-RateLimit-*).
    minuteLimit: read("x-ratelimit-limit"),
    minuteRemaining: read("x-ratelimit-remaining"),
  };
}

function safeJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

/**
 * Classifica os erros devolvidos pelo provedor no corpo da resposta.
 *
 * A documentação separa dois limites e o corpo usa chaves diferentes para cada
 * um: `rateLimit` é o limite POR MINUTO e `requests` é o limite DIÁRIO. Tratar
 * os dois como o mesmo erro é o que fazia o sistema retentar em cascata depois
 * de esgotar a cota do dia.
 */
export function parseProviderErrors(payload) {
  const raw = payload?.errors;
  const entries = [];
  if (Array.isArray(raw)) {
    raw.filter(Boolean).forEach((value) => entries.push(["", String(value)]));
  } else if (raw && typeof raw === "object") {
    Object.entries(raw).forEach(([key, value]) => {
      const list = Array.isArray(value) ? value : [value];
      list.filter(Boolean).forEach((item) => entries.push([String(key), String(item)]));
    });
  } else if (raw) {
    entries.push(["", String(raw)]);
  }

  const messages = entries.map(([key, value]) => (key ? `${key}: ${value}` : value));
  const text = messages.join(" | ");
  const hasKey = (pattern) => entries.some(([key]) => pattern.test(key));
  const hasText = (pattern) => pattern.test(text);

  const daily =
    hasKey(/^requests?$/i) ||
    hasText(/request limit for the day|daily (request )?limit|reached the (daily )?limit/i);
  const minute =
    !daily && (hasKey(/^rate.?limit$/i) || hasText(/too many requests|per minute|rate.?limit/i));
  const token =
    hasKey(/^(token|key|apikey|api.?key)$/i) ||
    hasText(/invalid api key|not subscribed|account is not active|suspended/i);
  const plan =
    !token &&
    (hasKey(/^(plan|subscription)$/i) ||
      hasText(/do(es)? not have access|upgrade your plan|free plan|not included in your (current )?plan/i));

  return { messages, daily, minute, token, plan, empty: messages.length === 0 };
}

/* ----------------------- erros e política de tentativas ----------------------- */

/**
 * Erro de limite da API (HTTP 429 ou corpo equivalente).
 * `scope` separa os dois limites: `minute` (pausa até o próximo minuto) e
 * `daily` (coleta bloqueada até a virada do dia na conta do provedor).
 */
export class FootballRateLimitError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "FootballRateLimitError";
    this.status = options.status || 429;
    this.scope = options.scope === "daily" ? "daily" : "minute";
    // Retry-After do provedor, em milissegundos, quando presente.
    this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? options.retryAfterMs : null;
  }
}

/** Resposta que exige correção (plano sem o dado, parâmetro inválido) — nunca retentada. */
export class FootballProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "FootballProviderError";
    this.code = options.code || "provider";
    this.status = options.status || 200;
  }
}

/** Erro de autenticação/configuração: nunca é retentado, exige correção. */
export class FootballAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "FootballAuthError";
  }
}

/** Mensagem do provedor que indica limite de requisições excedido. */
export function isRateLimitErrorText(text) {
  return /too many requests|limit of requests|rate limit/i.test(String(text || ""));
}

/** Retry-After em ms, aceitando segundos ou data HTTP. */
function retryAfterMsFrom(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

/** Backoff exponencial com variação aleatória: evita que todas as tarefas
 * retentem no mesmo instante. */
function backoffDelayMs(attempt) {
  const baseMs = 750 * 2 ** Math.min(attempt, 4);
  return Math.round(baseMs * (0.7 + Math.random() * 0.6));
}

/**
 * Executa uma chamada autenticada. Política de tentativas:
 * - 429/limite: NUNCA retenta — cada repetição é uma requisição a mais no
 *   minuto do provedor. A camada central registra a pausa progressiva para
 *   todas as rotinas, respeitando Retry-After quando fornecido;
 * - 401: erro de configuração, nunca retentado;
 * - 5xx/timeout/rede: até 2 tentativas com backoff exponencial e jitter.
 * Devolve também a quota informada pelo provedor nos cabeçalhos
 * (x-ratelimit-requests-limit/remaining/used).
 */
export async function apiFootballFetch(apiKey, path, params = {}, options = {}) {
  const { timeoutMs = 15000, retries = 1, base } = options;
  const url = new URL(`${base || DEFAULT_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  let attempt = 0;
  let lastError = null;
  while (true) {
    try {
      const response = await fetch(url.toString(), {
        headers: { "x-apisports-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const quota = parseQuota(response.headers);

      // Limite excedido: NUNCA retentado aqui — cada repetição consome mais uma
      // requisição do mesmo minuto. O escopo sai do corpo quando o provedor
      // informa (`requests` = dia, `rateLimit` = minuto).
      if (response.status === 429) {
        const body = await response.text().catch(() => "");
        const info = parseProviderErrors({ errors: safeJson(body)?.errors });
        throw new FootballRateLimitError(
          info.messages.join(" | ") || "API-Football: limite de requisições excedido (HTTP 429)",
          { retryAfterMs: retryAfterMsFrom(response), scope: info.daily ? "daily" : "minute", status: 429 },
        );
      }
      if (response.status === 401) {
        const body = await response.text();
        throw new FootballAuthError(`API-Football 401: ${body.slice(0, 180)}`);
      }
      if (response.status >= 500) {
        lastError = new Error(`API-Football indisponível (HTTP ${response.status})`);
        attempt += 1;
        if (attempt > retries) break;
        await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        const info = parseProviderErrors({ errors: safeJson(body)?.errors });
        if (info.token) throw new FootballAuthError(`API-Football ${response.status}: ${info.messages.join(" | ")}`);
        if (info.plan) {
          throw new FootballProviderError(`API-Football ${response.status}: ${info.messages.join(" | ")}`, {
            code: "plan",
            status: response.status,
          });
        }
        throw new Error(`API-Football ${response.status}: ${body.slice(0, 180)}`);
      }

      const payload = await response.json();
      const info = parseProviderErrors(payload);
      // Limite reportado no corpo (HTTP 200): mesmo tratamento do 429, com o
      // escopo definido pela chave usada pelo provedor.
      if (info.daily) {
        throw new FootballRateLimitError(info.messages.join(" | "), { scope: "daily", status: 200 });
      }
      if (info.minute) {
        throw new FootballRateLimitError(info.messages.join(" | "), { scope: "minute", status: 200 });
      }
      // Chave inválida, conta suspensa e plano sem o dado não se resolvem
      // repetindo a chamada: viram erro de configuração, visível no painel.
      if (info.token) throw new FootballAuthError(info.messages.join(" | "));
      if (info.plan) {
        throw new FootballProviderError(info.messages.join(" | "), { code: "plan", status: 200 });
      }
      return {
        data: payload,
        quota,
        status: response.status,
        errors: info.messages,
        results: Number(payload?.results) || 0,
      };
    } catch (error) {
      if (error instanceof FootballRateLimitError) throw error;
      if (error instanceof FootballAuthError) throw error;
      if (error instanceof FootballProviderError) throw error;
      if (String(error?.message || "").startsWith("API-Football ")) throw error;
      lastError =
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? new Error("Tempo esgotado ao consultar a API-Football")
          : error;
      attempt += 1;
      if (attempt > retries) break;
      await new Promise((resolve) => setTimeout(resolve, backoffDelayMs(attempt)));
    }
  }
  throw lastError || new Error("Falha ao consultar a API-Football");
}

/**
 * `/status` não consome a cota diária e informa os limites reais da conta e a
 * data de renovação — é a fonte da verdade sobre o consumo, independente do
 * contador interno.
 */
export function fetchAccountStatus(apiKey, base) {
  return apiFootballFetch(apiKey, "/status", {}, { base, timeoutMs: 10000, retries: 1 });
}

/**
 * Consulta em lote por IDs (até 20 partidas por chamada — /fixtures?ids=1-2-3):
 * uma única chamada devolve status e placar de todo o lote, reduzindo o consumo
 * de créditos nas auditorias de encerramento. Não aceita o parâmetro de fuso.
 */
export function fetchFixturesByIds(apiKey, base, ids) {
  return apiFootballFetch(apiKey, "/fixtures", { ids: ids.join("-") }, { base });
}

export function fetchFixturesByDate(apiKey, base, date) {
  return apiFootballFetch(apiKey, "/fixtures", { date, timezone: FOOTBALL_TIMEZONE }, { base });
}

/**
 * Detector global de jogos ao vivo: uma única chamada devolve todas as partidas
 * em andamento no mundo (placar, minuto e status), cobrindo a fila inteira por
 * 1 crédito — é o endpoint principal do monitoramento em tempo real.
 */
export function fetchFixturesLiveAll(apiKey, base) {
  return apiFootballFetch(apiKey, "/fixtures", { live: "all" }, { base, timeoutMs: 25000 });
}

/** Estatísticas de uma partida (escanteios, cartões, chutes) — consultadas após o FT. */
export function fetchFixtureStatistics(apiKey, base, fixtureId) {
  return apiFootballFetch(apiKey, "/fixtures/statistics", { fixture: fixtureId }, { base });
}

/** Eventos da partida (gols, cartões, substituições) — consultados após o FT. */
export function fetchFixtureEvents(apiKey, base, fixtureId) {
  return apiFootballFetch(apiKey, "/fixtures/events", { fixture: fixtureId }, { base });
}

/**
 * Extrai os gols da resposta de /fixtures/events. O lado de cada gol é decidido
 * pelo time do evento; gol contra é creditado ao adversário, como nas casas de
 * apostas. Devolve o primeiro gol (minuto, lado e detalhe) e a lista completa.
 */
export function parseFixtureEvents(payload, { homeName, awayName }) {
  const rows = Array.isArray(payload?.response) ? payload.response : [];
  const homeSlug = slugify(homeName);
  const awaySlug = slugify(awayName);
  const goals = [];
  rows.forEach((row) => {
    if (String(row?.type || "").toLowerCase() !== "goal") return;
    const teamSlug = slugify(row?.team?.name);
    const side = teamSlug === homeSlug ? "home" : teamSlug === awaySlug ? "away" : null;
    if (!side) return;
    const isOwnGoal = /own goal/i.test(String(row?.detail || ""));
    // Gol contra: o crédito é do time beneficiado.
    const credited = isOwnGoal ? (side === "home" ? "away" : "home") : side;
    const elapsed = numberOrNull(row?.time?.elapsed);
    const extra = numberOrNull(row?.time?.extra);
    goals.push({
      minute: elapsed === null ? null : elapsed + (extra && extra > 0 ? extra : 0),
      side: credited,
      team_name: row?.team?.name || "",
      player: row?.player?.name || "",
      detail: row?.detail || "",
      own_goal: isOwnGoal,
    });
  });
  goals.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));
  const first = goals.length ? goals[0] : null;
  return {
    first_goal: first
      ? { minute: first.minute, side: first.side, team_name: first.team_name, detail: first.detail }
      : null,
    goals,
    goal_count: goals.length,
  };
}

function teamStatValue(teamRow, label) {
  const found = (teamRow?.statistics || []).find(
    (item) => String(item?.type || "").trim().toLowerCase() === label,
  );
  const value = Number(found?.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extrai escanteios e cartões da resposta de /fixtures/statistics.
 * A primeira linha da resposta é o time da casa; a segunda, o visitante.
 */
export function parseFixtureStatistics(payload) {
  const rows = Array.isArray(payload?.response) ? payload.response : [];
  const pick = (row, label) => (row ? teamStatValue(row, label) : null);
  const cardsOf = (row) => {
    const yellow = pick(row, "yellow cards");
    const red = pick(row, "red cards");
    const total = (yellow === null ? 0 : yellow) + (red === null ? 0 : red);
    return yellow === null && red === null ? null : total;
  };
  return {
    corners_home: pick(rows[0], "corner kicks"),
    corners_away: pick(rows[1], "corner kicks"),
    cards_home: cardsOf(rows[0]),
    cards_away: cardsOf(rows[1]),
    yellow_home: pick(rows[0], "yellow cards"),
    yellow_away: pick(rows[1], "yellow cards"),
    red_home: pick(rows[0], "red cards"),
    red_away: pick(rows[1], "red cards"),
  };
}

/** Cabeçalhos de quota do provedor, para leitura em qualquer chamada. */
export function readQuotaFrom(result) {
  return result?.quota || { limit: null, remaining: null, used: null };
}

/** Resumo da conta devolvido por `/status`. */
export function parseAccountStatus(payload) {
  const response = payload?.response || {};
  const requests = response.requests || {};
  const subscription = response.subscription || {};
  return {
    current: numberOrNull(requests.current),
    limit_day: numberOrNull(requests.limit_day),
    plan: subscription.plan || "",
    active: subscription.active ?? null,
    end: subscription.end || "",
  };
}
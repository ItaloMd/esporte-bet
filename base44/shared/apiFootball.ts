/**
 * Cliente e mapeamento da API-Football v3 (API-Sports).
 *
 * Nenhum segredo é lido aqui: a chave chega por parâmetro, sempre vinda do
 * backend. O frontend nunca fala com a API-Football — apenas com as funções
 * de backend, que reutilizam o cache compartilhado.
 */

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
  const extraTimeScore = score.extratime || {};
  const penaltyScore = score.penalty || {};

  const home = numberOrNull(goals.home);
  const away = numberOrNull(goals.away);
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
  };
}

function readErrors(payload) {
  const raw = payload?.errors;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === "object") {
    return Object.values(raw)
      .flat()
      .filter(Boolean)
      .map(String);
  }
  return [String(raw)];
}

/**
 * Executa uma chamada autenticada, com backoff exponencial e número máximo de
 * tentativas. Devolve também a quota informada pelo provedor nos cabeçalhos.
 * Erros devolvidos no corpo da resposta são tratados como falha da chamada.
 */
export async function apiFootballFetch(apiKey, path, params = {}, options = {}) {
  const { timeoutMs = 15000, retries = 2, base } = options;
  const url = new URL(`${base || DEFAULT_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  let attempt = 0;
  let lastError = null;
  while (attempt <= retries) {
    try {
      const response = await fetch(url.toString(), {
        headers: { "x-apisports-key": apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const quota = parseQuota(response.headers);

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`API-Football indisponível (HTTP ${response.status})`);
        attempt += 1;
        if (attempt > retries) break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`API-Football ${response.status}: ${body.slice(0, 180)}`);
      }

      const payload = await response.json();
      const errors = readErrors(payload);
      if (errors.length) {
        const message = errors.join(" | ");
        const transient = /limit|rate|too many/i.test(message);
        if (transient && attempt < retries) {
          lastError = new Error(message);
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          continue;
        }
        return { data: payload, quota, status: response.status, errors, results: Number(payload?.results) || 0 };
      }

      return { data: payload, quota, status: response.status, errors: [], results: Number(payload?.results) || 0 };
    } catch (error) {
      const message = String(error?.message || "");
      if (message.startsWith("API-Football ")) throw error;
      lastError =
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? new Error("Tempo esgotado ao consultar a API-Football")
          : error;
      attempt += 1;
      if (attempt > retries) break;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
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
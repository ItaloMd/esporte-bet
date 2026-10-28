/**
 * Cliente e utilidades da The Odds API (v4).
 * Nenhum segredo é lido aqui: a chave chega por parâmetro, vinda do backend.
 */

const DEFAULT_BASE_URL = "https://api.the-odds-api.com/v4";

const SPORT_SLUGS = {
  soccer: "futebol",
  basketball: "basquete",
  tennis: "tenis",
  volleyball: "volei",
  "american football": "futebol-americano",
  mma: "mma",
  "mixed martial arts": "mma",
  motorsport: "automobilismo",
  "ice hockey": "hockey",
  baseball: "beisebol",
  "aussie rules": "australian-rules",
  cricket: "criquete",
  rugby: "rugby",
  boxing: "boxe",
  golf: "golfe",
  "table tennis": "tenis-de-mesa",
  handball: "handebol",
  lacrosse: "lacrosse",
  politics: "politica",
};

const SPORT_NAMES = {
  futebol: "Futebol",
  basquete: "Basquete",
  tenis: "Tênis",
  volei: "Vôlei",
  "futebol-americano": "Futebol Americano",
  mma: "MMA",
  automobilismo: "Automobilismo",
  hockey: "Hóquei no gelo",
  beisebol: "Beisebol",
  rugby: "Rugby",
  criquete: "Críquete",
  boxe: "Boxe",
  golfe: "Golfe",
  "tenis-de-mesa": "Tênis de mesa",
  handebol: "Handebol",
  "australian-rules": "Futebol australiano",
  lacrosse: "Lacrosse",
  politica: "Política",
};

export const DEFAULT_REGIONS = ["eu"];
export const DEFAULT_MARKETS = ["h2h", "spreads", "totals"];

/**
 * Ligas de maior apelo, usadas para marcar "eventos em destaque" na home.
 * A marcação é aplicada na sincronização; o painel continua livre para
 * ativar ou desativar cada competição individualmente.
 */
export const FEATURED_LEAGUES = new Set([
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
  "soccer_epl",
  "soccer_efl_champ",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  "soccer_brazil_campeonato",
  "soccer_brazil_serie_b",
  "soccer_argentina_primera_division",
  "soccer_usa_mls",
  "soccer_portugal_primeira_liga",
  "soccer_netherlands_eredivisie",
  "soccer_mexico_ligamx",
  "basketball_nba",
  "basketball_euroleague",
  "americanfootball_nfl",
  "icehockey_nhl",
  "mma_mixed_martial_arts",
  "boxing_boxing",
]);

/** Mercados considerados prioritários para publicar uma partida. */
export const PRIORITY_MARKETS = ["h2h", "totals", "spreads"];

export const DEFAULT_HOUSE_MARGIN_PERCENT = 20;
export const HOUSE_MARGIN_VERSION = "v1";

/**
 * Prioridade de catálogo: competições brasileiras primeiro.
 * A descoberta continua dinâmica — nenhuma liga é presumida; a lista apenas
 * define quem é consultado primeiro quando o orçamento é limitado.
 */
export function isBrazilianCompetition(...values) {
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return /(brazil|brasil|brasileir|copa do brasil|paulista|carioca|mineiro|gaucho|baiano|pernambucano|cearense|paranaense|goiano|potiguar|alagoano|sergipano|maranhense|paraense|capixaba|brasiliense|tocantinense|piauiense|acreano|amapaense|rondoniense|amazonense|sul-mato|distrital|nordestao|verdao)/.test(
    haystack,
  );
}

function roundOdd(value) {
  return Math.round(value * 100) / 100;
}

/** Soma das probabilidades implícitas de um conjunto de cotações. */
export function overround(values) {
  return values.reduce((total, value) => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? total + 1 / price : total;
  }, 0);
}

/**
 * Aplica a margem da casa a um mercado mutuamente exclusivo e exaustivo.
 *
 *   p_i = 1 / odd_i                  (probabilidade implícita original)
 *   S   = Σ p_i                      (overround original)
 *   q_i = p_i / S                    (distribuição proporcional)
 *   a_i = q_i * (1 + margem / 100)   (probabilidade ajustada)
 *   odd_i = 1 / a_i                  (odd oferecida)
 *
 * O overround-alvo é distribuído proporcionalmente entre os resultados, e não
 * como um desconto fixo aplicado à cotação. Devolve `null` quando o conjunto
 * está incompleto ou produz valores inválidos, para que a cotação seja retida
 * em vez de oferecida incorreta.
 */
export function applyHouseMargin(selections, marginPercent) {
  const margin = Number(marginPercent);
  if (!Number.isFinite(margin) || margin < 0 || margin > 100) return null;
  const prices = selections.map((selection) => Number(selection.original_value));
  if (prices.length < 2) return null;
  if (prices.some((price) => !Number.isFinite(price) || price <= 1)) return null;

  const probabilities = prices.map((price) => 1 / price);
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const target = 1 + margin / 100;
  const values = probabilities.map((probability) => {
    const adjusted = (probability / total) * target;
    if (!Number.isFinite(adjusted) || adjusted <= 0) return null;
    const offered = 1 / adjusted;
    return Number.isFinite(offered) && offered > 1 ? roundOdd(offered) : null;
  });
  if (values.some((value) => value === null)) return null;

  const effective = overround(values);
  if (!Number.isFinite(effective) || effective <= 1) return null;

  return {
    margin_percent: margin,
    original_overround: total,
    target_overround: target,
    offered_overround: effective,
    values,
  };
}

export function apiBase(settings) {
  return String(settings?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sportSlug(group) {
  const key = String(group || "").trim().toLowerCase();
  return SPORT_SLUGS[key] || slugify(key) || "outros";
}

export function sportName(slug, group) {
  return SPORT_NAMES[slug] || group || slug;
}

export function marketGroup(marketKey) {
  if (marketKey === "h2h") return "principal";
  if (marketKey === "spreads") return "handicap";
  if (marketKey === "totals") return "gols";
  if (marketKey === "double_chance" || marketKey === "ht_double_chance") return "dupla_chance";
  if (marketKey === "btts" || marketKey === "ht_btts" || marketKey === "goal_both_halves") return "ambas_marcam";
  if (marketKey === "ht_result" || marketKey === "ht_totals") return "intervalo";
  if (String(marketKey || "").startsWith("corners")) return "escanteios";
  if (String(marketKey || "").startsWith("cards")) return "cartoes";
  if (marketKey === "first_goal") return "especiais";
  return "estatisticas";
}

export function marketName(marketKey, sportSlugValue) {
  if (marketKey === "h2h") return "Resultado da partida";
  if (marketKey === "spreads") return "Handicap";
  if (marketKey === "totals") return sportSlugValue === "futebol" ? "Total de gols" : "Total de pontos";
  if (marketKey === "double_chance") return "Dupla Chance";
  if (marketKey === "ht_double_chance") return "Dupla Chance 1º Tempo";
  if (marketKey === "btts") return "Ambas Marcam";
  if (marketKey === "ht_btts") return "Ambas Marcam 1º Tempo";
  if (marketKey === "ht_result") return "Resultado do 1º Tempo";
  if (marketKey === "ht_totals") return "Gols 1º Tempo (Mais/Menos)";
  if (marketKey === "corners") return "Escanteios (Mais/Menos)";
  if (marketKey === "corners_home") return "Escanteios Casa (Mais/Menos)";
  if (marketKey === "corners_away") return "Escanteios Visitante (Mais/Menos)";
  if (marketKey === "cards") return "Cartões (Mais/Menos)";
  if (marketKey === "cards_home") return "Cartões Casa (Mais/Menos)";
  if (marketKey === "cards_away") return "Cartões Visitante (Mais/Menos)";
  if (marketKey === "first_goal") return "Time Marca o Primeiro Gol";
  if (marketKey === "goal_both_halves") return "Gol nos Dois Tempos";
  return marketKey;
}

export function selectionLabel(marketKey, outcome) {
  const name = String(outcome?.name || "").trim();
  const point = outcome?.point;
  if (marketKey === "totals") {
    const side = /over/i.test(name) ? "Mais de" : /under/i.test(name) ? "Menos de" : name;
    return point === undefined || point === null ? side : `${side} ${point}`;
  }
  if (marketKey === "spreads" && point !== undefined && point !== null) {
    return `${name} ${point > 0 ? "+" : ""}${point}`;
  }
  if (/^draw$/i.test(name)) return "Empate";
  return name;
}

export function selectionCode(marketKey, outcome) {
  if (outcome?.code) return String(outcome.code);
  const name = String(outcome?.name || "").trim();
  const point = outcome?.point;
  if (marketKey === "totals") {
    const side = /over/i.test(name) ? "over" : /under/i.test(name) ? "under" : slugify(name);
    return point === undefined || point === null ? side : `${side}_${point}`;
  }
  if (marketKey === "spreads") {
    const suffix = point === undefined || point === null ? "" : `_${point}`;
    return `${slugify(name)}${suffix}`;
  }
  if (/^draw$/i.test(name)) return "draw";
  return slugify(name);
}

/* ----------------------------- fuso horário ----------------------------- */

function timeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asUtc - date.getTime()) / 60000;
}

export function localDateString(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Intervalo UTC que corresponde ao dia local informado (00:00 → 24:00). */
export function localDayRange(dateString, timeZone) {
  const noon = new Date(`${dateString}T12:00:00Z`);
  const offset = timeZoneOffsetMinutes(noon, timeZone);
  const start = new Date(Date.parse(`${dateString}T00:00:00Z`) - offset * 60000);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

/* -------------------------------- requisições -------------------------------- */

function parseUsage(headers) {
  const read = (name) => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return { used: read("x-requests-used"), remaining: read("x-requests-remaining"), last: read("x-requests-last") };
}

async function request(url, { retries = 2 } = {}) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= retries) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const usage = parseUsage(response.headers);
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`The Odds API indisponível (HTTP ${response.status})`);
        attempt += 1;
        if (attempt > retries) break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`The Odds API ${response.status}: ${body.slice(0, 180)}`);
      }
      return { data: await response.json(), usage, status: response.status };
    } catch (error) {
      const message = String(error?.message || "");
      if (message.startsWith("The Odds API")) throw error;
      lastError =
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? new Error("Tempo esgotado ao consultar a The Odds API")
          : error;
      attempt += 1;
      if (attempt > retries) break;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError || new Error("Falha ao consultar a The Odds API");
}

export function listSports(apiKey, base) {
  return request(`${base}/sports/?apiKey=${encodeURIComponent(apiKey)}`);
}

export function listEvents(apiKey, base, sportKey) {
  return request(`${base}/sports/${encodeURIComponent(sportKey)}/events/?apiKey=${encodeURIComponent(apiKey)}&dateFormat=iso`);
}

/** A API exige YYYY-MM-DDTHH:MM:SSZ — sem milissegundos. */
function isoSeconds(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function listOdds(apiKey, base, { sportKey, regions, markets, from, to }) {
  const params = new URLSearchParams({
    apiKey,
    regions: regions.join(","),
    markets: markets.join(","),
    oddsFormat: "decimal",
    dateFormat: "iso",
  });
  const fromIso = from ? isoSeconds(from) : null;
  const toIso = to ? isoSeconds(to) : null;
  if (fromIso) params.set("commenceTimeFrom", fromIso);
  if (toIso) params.set("commenceTimeTo", toIso);
  return request(`${base}/sports/${encodeURIComponent(sportKey)}/odds/?${params.toString()}`);
}

/**
 * Placares de uma modalidade. Traz também partidas já encerradas dentro da
 * janela consultada, então uma única chamada cobre todos os eventos pendentes
 * daquela modalidade. Só é chamado para eventos que já começaram.
 */
export function listScores(apiKey, base, sportKey, { daysFrom = 3 } = {}) {
  const params = new URLSearchParams({
    apiKey,
    daysFrom: String(daysFrom),
    dateFormat: "iso",
  });
  return request(`${base}/sports/${encodeURIComponent(sportKey)}/scores/?${params.toString()}`);
}

/** Executa tarefas independentes em lotes pequenos, respeitando o limite de conexões. */
export async function inBatches(items, size, worker) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    const slice = items.slice(index, index + size);
    const settled = await Promise.allSettled(slice.map(worker));
    results.push(...settled);
  }
  return results;
}
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

export function apiBase(settings) {
  return String(settings?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function slugify(value) {
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
  return "estatisticas";
}

export function marketName(marketKey, sportSlugValue) {
  if (marketKey === "h2h") return "Resultado da partida";
  if (marketKey === "spreads") return "Handicap";
  if (marketKey === "totals") return sportSlugValue === "futebol" ? "Total de gols" : "Total de pontos";
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
const TZ = "America/Sao_Paulo";

const dayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Datas gravadas pela plataforma chegam em UTC sem marcador de fuso
 * ("2026-10-29T04:05:12.463000"): sem o "Z", o navegador interpretaria como
 * hora local e deslocaria a exibição em 3 horas. Toda conversão de data da
 * interface passa por aqui, preservando valores que já trazem fuso.
 */
function toDate(value) {
  if (value instanceof Date) return value;
  const raw = String(value);
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})\s*$/.test(raw);
  const hasTime = /\d{2}:\d{2}:\d{2}/.test(raw);
  return new Date(!hasOffset && hasTime ? `${raw}Z` : raw);
}

export function formatTime(value) {
  if (!value) return "--:--";
  return timeFmt.format(toDate(value));
}

export function formatDateTime(value) {
  if (!value) return "—";
  return dateTimeFmt.format(toDate(value));
}

export function brasiliaDayKey(value) {
  if (!value) return "";
  return keyFmt.format(toDate(value));
}

export function formatDay(value) {
  if (!value) return "";
  const key = brasiliaDayKey(value);
  if (key === brasiliaDayKey(new Date())) return "Hoje";
  if (key === brasiliaDayKey(new Date(Date.now() + 86400000))) return "Amanhã";
  const label = dayFmt.format(toDate(value)).replace(".", "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const shortFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });

export function formatDateShort(value) {
  if (!value) return "";
  return shortFmt.format(toDate(value));
}

export function timeAgo(value) {
  if (!value) return "sem atualização";
  const diff = Date.now() - toDate(value).getTime();
  if (diff < 0) return "agora";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins === 1) return "há 1 min";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}

export function toDateInputValue(date) {
  return keyFmt.format(date);
}

export function dayRangeFromInput(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  // 00:00 and 23:59 in Brasília (UTC-3)
  const start = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, 2, 59, 59));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function formatOdds(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(2);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
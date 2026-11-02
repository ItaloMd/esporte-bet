// A plataforma cobre exclusivamente futebol: os eventos sincronizados pela
// API-Football chegam todos com sport_slug "futebol".
export const SPORTS = [{ slug: "futebol", name: "Futebol", icon: "CircleDot", accent: "Futebol" }];

export const OTHERS_SLUGS = [];

export function sportBySlug(slug) {
  return SPORTS.find((s) => s.slug === slug);
}

export function sportName(slug) {
  return sportBySlug(slug)?.name || "Futebol";
}

export function statusLabel(status) {
  return {
    scheduled: "Agendado",
    live: "Ao vivo",
    finished: "Encerrado",
    postponed: "Adiado",
    cancelled: "Cancelado",
  }[status] || "—";
}

export function marketGroupLabel(group) {
  return {
    principal: "Resultado da partida",
    gols: "Total de gols",
    ambas_marcam: "Ambas marcam",
    handicap: "Handicap",
    escanteios: "Escanteios",
    cartoes: "Cartões",
    intervalo: "Mercados de intervalo (1º tempo)",
    especiais: "Mercados especiais",
    estatisticas: "Estatísticas",
  }[group] || "Outros mercados";
}
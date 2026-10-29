export const SPORTS = [
  { slug: "futebol", name: "Futebol", icon: "CircleDot", accent: "Futebol" },
  { slug: "basquete", name: "Basquete", icon: "Activity", accent: "Basquete" },
  { slug: "tenis", name: "Tênis", icon: "Trophy", accent: "Tênis" },
  { slug: "volei", name: "Vôlei", icon: "Dumbbell", accent: "Vôlei" },
  { slug: "futebol-americano", name: "Futebol Americano", icon: "Shield", accent: "NFL" },
  { slug: "mma", name: "MMA", icon: "Swords", accent: "MMA" },
  { slug: "automobilismo", name: "Automobilismo", icon: "Flag", accent: "F1" },
  { slug: "hockey", name: "Hóquei no gelo", icon: "Shield", accent: "NHL" },
  { slug: "beisebol", name: "Beisebol", icon: "CircleDot", accent: "MLB" },
  { slug: "boxe", name: "Boxe", icon: "Swords", accent: "Boxe" },
  { slug: "golfe", name: "Golfe", icon: "Flag", accent: "Golfe" },
  { slug: "criquete", name: "Críquete", icon: "CircleDot", accent: "Críquete" },
  { slug: "handebol", name: "Handebol", icon: "Activity", accent: "Handebol" },
  { slug: "australian-rules", name: "Futebol australiano", icon: "Shield", accent: "AFL" },
  { slug: "tenis-de-mesa", name: "Tênis de mesa", icon: "Trophy", accent: "Tênis de mesa" },
  { slug: "lacrosse", name: "Lacrosse", icon: "Swords", accent: "Lacrosse" },
  { slug: "politica", name: "Política", icon: "Star", accent: "Política" },
];

export const OTHERS_SLUGS = ["futebol-americano", "mma", "automobilismo"];

export function sportBySlug(slug) {
  return SPORTS.find((s) => s.slug === slug);
}

export function sportName(slug) {
  if (slug === "outros") return "Outros esportes";
  return sportBySlug(slug)?.name || "Esporte";
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
    gols: "Total de pontos/gols",
    ambas_marcam: "Ambas marcam",
    handicap: "Handicap",
    escanteios: "Escanteios",
    cartoes: "Cartões",
    intervalo: "Mercados de intervalo (1º tempo)",
    especiais: "Mercados especiais",
    estatisticas: "Estatísticas",
  }[group] || "Outros mercados";
}
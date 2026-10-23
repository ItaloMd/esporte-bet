export const SPORTS = [
  { slug: "futebol", name: "Futebol", icon: "CircleDot", accent: "Futebol" },
  { slug: "basquete", name: "Basquete", icon: "CircleDotDashed", accent: "Basquete" },
  { slug: "tenis", name: "Tênis", icon: "Trophy", accent: "Tênis" },
  { slug: "volei", name: "Vôlei", icon: "Volleyball", accent: "Vôlei" },
  { slug: "futebol-americano", name: "Futebol Americano", icon: "Shield", accent: "NFL" },
  { slug: "mma", name: "MMA", icon: "Swords", accent: "MMA" },
  { slug: "automobilismo", name: "Automobilismo", icon: "Flag", accent: "F1" },
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
    dupla_chance: "Dupla possibilidade",
    gols: "Total de pontos/gols",
    ambas_marcam: "Ambas marcam",
    handicap: "Handicap",
    escanteios: "Escanteios",
    cartoes: "Cartões",
    estatisticas: "Estatísticas",
  }[group] || "Outros mercados";
}
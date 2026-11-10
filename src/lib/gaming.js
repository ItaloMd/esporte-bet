import { base44 } from "@/api/base44Client";

/** Categorias do portfólio GamingSoft/GSC+, na ordem exibida no lobby. */
export const GAME_CATEGORIES = [
  { key: "slots", label: "Slots" },
  { key: "live", label: "Cassino ao vivo" },
  { key: "crash", label: "Crash e instantâneos" },
  { key: "tables", label: "Mesas e cartas" },
  { key: "fishing", label: "Pesca" },
  { key: "virtuals", label: "Virtuais e loteria" },
  { key: "sports", label: "Esportes virtuais" },
];

export const CATEGORY_LABEL = GAME_CATEGORIES.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

/** Primeiras letras do nome: usado quando o provedor não envia capa. */
export function gameInitials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

/** Monta o filtro de catálogo público a partir da busca e da categoria escolhida. */
export function buildGameQuery({ search = "", category = "" } = {}) {
  const query = { status: "published" };
  if (category) query.category = category;
  const term = search.trim();
  if (term) query.name = { $regex: term, $options: "i" };
  return query;
}

/** Página do catálogo publicado, ordenada por popularidade. */
export async function fetchGames({ search, category, cursor } = {}) {
  return base44.entities.GamingGame.filter(buildGameQuery({ search, category }), {
    sort: "-popularity",
    limit: 36,
    ...(cursor ? { cursor } : {}),
  });
}
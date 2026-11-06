/** Seleções da super múltipla gravadas como JSON — sempre lidas pela lista. */
export function parseSelections(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Fator aplicado a cada seleção para que o produto chegue à odd turbinada. */
export function legBoostFactor(boostPercent, legs) {
  const factor = 1 + (Number(boostPercent) || 0) / 100;
  if (!legs || factor <= 1) return 1;
  return Math.pow(factor, 1 / legs);
}

export function boostedOdd(base, boostPercent) {
  const baseValue = Number(base) || 0;
  if (!baseValue) return 0;
  return round2(baseValue * (1 + (Number(boostPercent) || 0) / 100));
}

/** Valor da seleção já com a turbinação proporcional aplicada. */
export function boostedLegValue(value, factor) {
  return round2((Number(value) || 0) * (factor || 1));
}

export function totalOfLegs(legs = []) {
  return round2(legs.reduce((acc, leg) => acc * (Number(leg.odd_value) || 1), 1));
}
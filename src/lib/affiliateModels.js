export const AFFILIATE_MODELS = [
  { value: "full_rev", label: "Full Rev Share", hint: "Percentual sobre os depósitos dos jogadores indicados." },
  { value: "rev_cpa", label: "Rev Share + CPA", hint: "Percentual sobre depósitos mais valor fixo por jogador qualificado." },
  { value: "cpa", label: "CPA", hint: "Apenas valor fixo por jogador qualificado." },
];

export function modelLabel(value) {
  return AFFILIATE_MODELS.find((item) => item.value === value)?.label || AFFILIATE_MODELS[0].label;
}
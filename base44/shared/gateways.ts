/**
 * Registro de gateways de pagamento e regras de roteamento.
 *
 * As taxas de cada gateway são custo da plataforma: o jogador recebe o valor
 * integral do depósito e o saque contabiliza o valor bruto integral, com o
 * envio pelo gateway no modelo gross-up (a taxa é debitada por cima do amount).
 */

/** Campos de AppSettings que ligam/desligam cada gateway por função. */
export const GATEWAY_FIELDS = {
  liqfy: { deposit: 'gateway_liqfy_deposit', withdrawal: 'gateway_liqfy_withdrawal' },
  payshark: { deposit: 'gateway_payshark_deposit', withdrawal: 'gateway_payshark_withdrawal' },
};

/** Taxas cobradas por cada gateway (custo da casa). */
export const GATEWAYS = {
  liqfy: {
    label: 'Liqfy',
    fees: { deposit_fixed: 1, deposit_percent: 3.5, withdrawal_fixed: 1, withdrawal_percent: 3.5 },
  },
  payshark: {
    label: 'Payshark',
    fees: { deposit_fixed: 1, deposit_percent: 0, withdrawal_fixed: 3, withdrawal_percent: 2 },
  },
};

const r2 = (value) => Math.round(Number(value || 0) * 100) / 100;

/** Taxa do gateway sobre uma entrada PIX (custo da casa). */
export function depositFee(gateway, amount) {
  const fees = GATEWAYS[gateway]?.fees;
  if (!fees) return 0;
  return r2(fees.deposit_fixed + (r2(amount) * fees.deposit_percent) / 100);
}

/** Taxa do gateway sobre um saque gross-up: `sent` é o que o recebedor recebe. */
export function withdrawalGatewayFee(gateway, sent) {
  const fees = GATEWAYS[gateway]?.fees;
  if (!fees) return 0;
  return r2(fees.withdrawal_fixed + (r2(sent) * fees.withdrawal_percent) / 100);
}

/** Débito total estimado na carteira do gateway pelo envio de um saque. */
export function withdrawalDebitEstimate(gateway, sent) {
  return r2(r2(sent) + withdrawalGatewayFee(gateway, sent));
}

/**
 * Gateway ativo para a função pedida ('deposit' | 'withdrawal'). Com ambos
 * ligados para a mesma função, a Liqfy é a principal; a Payshark assume quando
 * a Liqfy estiver desligada para aquela função. Nenhum ligado → null.
 */
export function pickGateway(settings, purpose) {
  const fields = GATEWAY_FIELDS;
  if (settings?.[fields.liqfy[purpose]] !== false) return 'liqfy';
  if (settings?.[fields.payshark[purpose]] === true) return 'payshark';
  return null;
}
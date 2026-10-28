/**
 * Registro de gateway de pagamento e regras de roteamento.
 *
 * Payshark é o único gateway ativo. A taxa de saque (2% + R$ 1) é debitada do
 * valor enviado: o gateway recebe o `amount` integral e o recebedor recebe o
 * `amount` menos a taxa.
 */

/** Campos de AppSettings que ligam/desligam o gateway por função. */
export const GATEWAY_FIELDS = {
  payshark: { deposit: 'gateway_payshark_deposit', withdrawal: 'gateway_payshark_withdrawal' },
};

/** Taxas cobradas pelo Payshark (custo da casa). */
export const GATEWAYS = {
  payshark: {
    label: 'Payshark',
    fees: { deposit_fixed: 1, deposit_percent: 0, withdrawal_fixed: 1, withdrawal_percent: 2 },
  },
};

const r2 = (value) => Math.round(Number(value || 0) * 100) / 100;

/** Taxa do gateway sobre uma entrada PIX (custo da casa). */
export function depositFee(gateway, amount) {
  const fees = GATEWAYS[gateway]?.fees;
  if (!fees) return 0;
  return r2(fees.deposit_fixed + (r2(amount) * fees.deposit_percent) / 100);
}

/** Taxa do gateway sobre um saque: `sent` é o valor enviado à API. */
export function withdrawalGatewayFee(gateway, sent) {
  const fees = GATEWAYS[gateway]?.fees;
  if (!fees) return 0;
  return r2(fees.withdrawal_fixed + (r2(sent) * fees.withdrawal_percent) / 100);
}

/** Gateway ativo para a função pedida ('deposit' | 'withdrawal'); nenhum ligado → null. */
export function pickGateway(settings, purpose) {
  if (settings?.[GATEWAY_FIELDS.payshark[purpose]] === true) return 'payshark';
  return null;
}
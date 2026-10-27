/**
 * Cliente do Payshark (pagamentos PIX, transferências PIX e webhooks).
 *
 * Duas chaves: a de pagamentos (cobranças e dados da loja) e a de saque
 * (transferências e saldo), guardadas como segredos do backend — o navegador
 * nunca fala com o gateway. Valores sempre em centavos (inteiros). A consulta
 * de status por polling é proibida pela API: o webhook é a única fonte de
 * atualização de pagamento e transferência.
 */
import { requireSecret, timingSafeEqual } from './payments.ts';

const BASE_URL = 'https://api.gatewaypayshark.com.br/v1';

export function paysharkPaymentKey() {
  return requireSecret('PAYSHARK_API_KEY', 'PAYSHARK_API_KEY');
}

export function paysharkWithdrawalKey() {
  return requireSecret('PAYSHARK_SAQUE_KEY', 'PAYSHARK_SAQUE_KEY');
}

async function payshark(path, options = {}) {
  const token = options.key === 'withdrawal' ? paysharkWithdrawalKey() : paysharkPaymentKey();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(25000),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data: data || {} };
}

export function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function fromCents(value) {
  return Math.round(Number(value || 0)) / 100;
}

/**
 * Cobrança PIX: devolve o copia e cola em data.copypaste e o id do pagamento.
 * `payer.taxId` é obrigatório para lojas BRL; `items` aceita produto digital.
 */
export function createPixPayment(payload) {
  return payshark('/payment', { method: 'POST', body: payload });
}

/**
 * Transferência PIX (saque): `amount` é o que o recebedor recebe; a taxa do
 * gateway (2% + R$ 3) é debitada por cima e o total sai do saldo da loja.
 */
export function createPixTransfer(payload) {
  return payshark('/transfer', { method: 'POST', body: payload, key: 'withdrawal' });
}

/** Saldo da loja; `available` é o valor disponível para transferir. */
export function getBalance() {
  return payshark('/balance', { key: 'withdrawal' });
}

/** Dados públicos da loja; valida a chave de pagamentos. */
export function getStoreInfo() {
  return payshark('/store-info');
}

/** Tipo de chave PIX interno traduzido para o vocabulário do Payshark. */
export function pixKeyType(value) {
  const type = String(value || '').trim().toLowerCase();
  const map = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', phone: 'PHONE', random: 'EVP' };
  return map[type];
}

/** Status do pagamento traduzido para o vocabulário interno do depósito. */
export function paymentStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'PAID') return 'paid';
  if (['REFUSED', 'REFUNDED', 'MED', 'CHARGEDBACK'].includes(value)) return 'cancelled';
  return 'pending';
}

/** Status da transferência traduzido para o vocabulário interno do saque. */
export function transferStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'COMPLETED') return 'completed';
  if (['REFUSED', 'FAILED'].includes(value)) return 'failed';
  return 'processing';
}

async function hmacBase64(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Valida a assinatura X-Signature do webhook: HMAC-SHA256 do corpo bruto com o
 * secret do endpoint, codificado em base64.
 */
export async function verifyWebhookSignature(rawBody, header, secret) {
  const value = String(header || '').trim();
  if (!value) return { ok: false, reason: 'Assinatura ausente.' };
  const expected = await hmacBase64(secret, rawBody);
  return timingSafeEqual(expected, value) ? { ok: true } : { ok: false, reason: 'Assinatura inválida.' };
}
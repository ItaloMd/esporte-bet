/**
 * Cliente da Eleva Payments (cobranças PIX, saques PIX e webhooks).
 *
 * Autenticação por `Authorization: Bearer TOKEN` + `X-Client-ID`, com as duas
 * credenciais guardadas como segredos do backend — o navegador nunca fala com
 * o gateway. Os dados do cartão, quando existirem, também só passam por aqui.
 */
import { hmacHex, requireSecret, timingSafeEqual } from './payments.ts';

const BASE_URL = 'https://elevapayments.squareweb.app/api/v1';
const TOLERANCE_SECONDS = 300;

export function elevaToken() {
  return requireSecret('ELEVA_API_TOKEN', 'ELEVA_API_TOKEN');
}

export function elevaClientId() {
  return requireSecret('ELEVA_CLIENT_ID', 'ELEVA_CLIENT_ID');
}

export async function eleva(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${elevaToken()}`,
      'X-Client-ID': elevaClientId(),
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

/** Cobrança PIX: devolve o QR Code, o copia e cola e o identificador da transação. */
export function createPixCharge(payload) {
  return eleva('/payments/pix', { method: 'POST', body: payload });
}

export function getPayment(uuid) {
  return eleva(`/payments/${encodeURIComponent(uuid)}`);
}

/** Saque PIX: `amount` é o líquido que chega na chave; a taxa é debitada à parte. */
export function createPixCashout(payload) {
  return eleva('/cashout/pix', { method: 'POST', body: payload });
}

/** Status da fonte traduzido para o vocabulário interno do depósito. */
export function depositStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'completed') return 'paid';
  if (['failed', 'cancelled', 'chargeback', 'refunded'].includes(value)) return 'cancelled';
  return 'pending';
}

/** Status da fonte traduzido para o vocabulário interno do saque. */
export function withdrawalStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'paid' || value === 'completed') return 'completed';
  if (['failed', 'rejected', 'cancelled'].includes(value)) return 'failed';
  return 'processing';
}

/**
 * Verifica a assinatura do webhook: `X-Webhook-Signature-V2: t=...,v1=...`,
 * onde v1 é o HMAC-SHA256 de `timestamp.corpo` usando o token da credencial.
 */
export async function verifyWebhookSignature(rawBody, header, secret) {
  const parts = {};
  String(header || '')
    .split(',')
    .forEach((piece) => {
      const index = piece.indexOf('=');
      if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
    });

  const timestamp = Number(parts.t);
  const provided = parts.v1 || '';
  if (!timestamp || !provided) return { ok: false, reason: 'Assinatura ausente.' };
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'Assinatura expirada.' };
  }

  const expected = await hmacHex(secret, `${parts.t}.${rawBody}`);
  return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'Assinatura inválida.' };
}
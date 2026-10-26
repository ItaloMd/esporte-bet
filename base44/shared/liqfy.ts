/**
 * Cliente da Liqfy (cobranças PIX, saques PIX e webhooks).
 *
 * Autenticação por `Authorization: Bearer <chave>`, com a chave guardada como
 * segredo do backend — o navegador nunca fala com o gateway. Todos os valores
 * trafegam em centavos (inteiros na menor unidade da moeda).
 */
import { hmacHex, requireSecret, timingSafeEqual } from './payments.ts';

const BASE_URL = 'https://api.liqfy.com.br/v1';
const TOLERANCE_SECONDS = 300;

export function liqfyKey() {
  return requireSecret('LIQFY_API_KEY', 'LIQFY_API_KEY');
}

export async function liqfy(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${liqfyKey()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = String(options.idempotencyKey).slice(0, 255);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
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
 * Cobrança PIX: devolve o BR Code, o QR Code e o id da cobrança (`ch_…`).
 * O `Idempotency-Key` é obrigatório e deve ser estável por cobrança.
 */
export function createPixCharge(payload, idempotencyKey) {
  return liqfy('/charges', { method: 'POST', body: payload, idempotencyKey });
}

export function getCharge(id) {
  return liqfy(`/charges/${encodeURIComponent(id)}`);
}

/** Saque PIX: `amount` é o que o recebedor recebe; a taxa é debitada por cima. */
export function createPixWithdrawal(payload, idempotencyKey) {
  return liqfy('/withdrawals', { method: 'POST', body: payload, idempotencyKey });
}

/** Saldo da carteira Liqfy; `available` é o valor disponível para sacar. */
export function getWalletBalance() {
  return liqfy('/wallets/balance');
}

/** Tipos de chave aceitos pelo gateway; um tipo desconhecido é omitido. */
export function pixKeyType(value) {
  const type = String(value || '').trim().toUpperCase();
  return ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'].includes(type) ? type : undefined;
}

/** Status da cobrança traduzido para o vocabulário interno do depósito. */
export function depositStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'paid') return 'paid';
  if (['failed', 'expired', 'cancelled', 'refunded', 'disputed'].includes(value)) return 'cancelled';
  return 'pending';
}

/** Status do saque traduzido para o vocabulário interno do saque. */
export function withdrawalStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'paid') return 'completed';
  if (['failed', 'rejected'].includes(value)) return 'failed';
  return 'processing';
}

/**
 * Verifica a assinatura do webhook nos dois esquemas da Liqfy: o canônico
 * (`t=...,v1=...`, HMAC de `timestamp.corpo`) e o legado (`sha256=...`, HMAC do
 * corpo). Ambos usam HMAC-SHA256 com o secret do endpoint.
 */
export async function verifyWebhookSignature(rawBody, header, secret) {
  const value = String(header || '').trim();
  if (!value) return { ok: false, reason: 'Assinatura ausente.' };

  if (value.startsWith('sha256=')) {
    const expected = await hmacHex(secret, rawBody);
    return timingSafeEqual(expected, value.slice(7))
      ? { ok: true }
      : { ok: false, reason: 'Assinatura inválida.' };
  }

  const parts = {};
  value.split(',').forEach((piece) => {
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
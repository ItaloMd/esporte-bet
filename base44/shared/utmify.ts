/**
 * UTMify: envio dos pedidos (depósitos aprovados) para a API de credenciais.
 *
 * O token (UTMIFY_API_TOKEN) vive no backend; o envio é best-effort — nunca
 * interrompe a confirmação do depósito. O UTMify notifica o celular do dono
 * da conta (WhatsApp configurado no painel dele) a partir do pedido enviado.
 */
import { secrets } from 'base44:runtime';

const ORDERS_URL = 'https://api.utmify.com.br/api-credentials/orders';

const TRACKING_KEYS = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];

/** Lê o JSON de rastreio guardado no depósito, mantendo apenas as chaves válidas. */
export function parseTracking(raw) {
  let parsed = {};
  try {
    parsed = JSON.parse(String(raw || '') || '{}');
  } catch {
    parsed = {};
  }
  const tracking = {};
  TRACKING_KEYS.forEach((key) => {
    const value = parsed?.[key];
    if (value) tracking[key] = String(value).slice(0, 255);
  });
  return tracking;
}

function formatDateTime(value) {
  const iso = new Date(value || Date.now()).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

/**
 * Envia o depósito pago ao UTMify. Devolve { ok } — falhas são reportadas,
 * nunca lançadas.
 */
export async function sendDepositOrder({ deposit, customer, tracking, status = 'paid' }) {
  const token = secrets.get('UTMIFY_API_TOKEN');
  if (!token) return { ok: false, reason: 'UTMIFY_API_TOKEN não configurado.' };

  const amount = Number(deposit.amount || 0);
  const body = {
    orderId: deposit.external_id || deposit.id,
    platform: 'Esporte Bet',
    paymentMethod: 'pix',
    status,
    createdAt: formatDateTime(deposit.created_date),
    approvedDate: status === 'paid' ? formatDateTime(deposit.paid_at || Date.now()) : null,
    refundedAt: null,
    customer: {
      name: customer?.name || null,
      email: customer?.email || null,
      phone: customer?.phone || null,
      document: customer?.document || null,
      country: 'BR',
    },
    products: [
      {
        id: 'deposito_saldo',
        name: 'Depósito de saldo',
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: cents(amount),
      },
    ],
    trackingParameters: {
      src: tracking?.src || null,
      sck: tracking?.sck || null,
      utm_source: tracking?.utm_source || null,
      utm_campaign: tracking?.utm_campaign || null,
      utm_medium: tracking?.utm_medium || null,
      utm_content: tracking?.utm_content || null,
      utm_term: tracking?.utm_term || null,
    },
    commission: {
      totalPriceInCents: cents(amount),
      gatewayFeeInCents: cents(deposit.fee),
      userCommissionInCents: cents(deposit.net_amount ?? amount),
    },
    isTest: false,
  };

  try {
    const response = await fetch(ORDERS_URL, {
      method: 'POST',
      headers: { 'x-api-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
import { secrets } from "base44:runtime";

const BASE_URL = "https://tichupay.com";

export function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Retenção da plataforma em cada saque: o valor bruto é o que sai na
// contabilidade da plataforma; a TichuPay envia apenas o líquido.
export const WITHDRAWAL_RETENTION_PERCENT = 10;

export function withdrawalSendAmount(amount) {
  const gross = round2(amount);
  return round2(gross - (gross * WITHDRAWAL_RETENTION_PERCENT) / 100);
}

export function tichupayKey() {
  const key = secrets.get("TICHUPAY_API_KEY");
  if (!key) throw new Error("TICHUPAY_API_KEY não configurada nos Secrets do app.");
  return key;
}

export async function tichupay(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: { "x-api-key": tichupayKey(), "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20000),
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

export function appOrigin(req) {
  const origin = req.headers.get("X-Base44-App-Url");
  return String(origin || "https://esportebet.base44.app").replace(/\/+$/, "");
}

export function publicMessage(data, fallback) {
  if (!data) return fallback;
  const candidate = data.error || data.message || data.detail || data.raw;
  return typeof candidate === "string" && candidate ? candidate : fallback;
}

export async function hmacHex(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/**
 * Credita um depósito já pago (webhook ou verificação manual).
 * O valor creditado é o bruto: a taxa da TichuPay é custo da plataforma.
 */
export async function creditPaidDeposit(service, deposit, remote) {
  const amount = round2(remote?.amount ?? deposit.amount);
  const updated = await service.Deposit.update(deposit.id, {
    status: "paid",
    paid_at: remote?.paid_at || new Date().toISOString(),
    fee: round2(remote?.fee ?? deposit.fee),
    net_amount: round2(remote?.net_amount ?? deposit.net_amount),
    payer_name: remote?.payer_name || deposit.payer_name,
    txid: remote?.txid || deposit.txid,
  });

  const multiplier = Number(deposit.rollover_multiplier ?? 1);
  const rollover = round2(amount * multiplier);
  const page = await service.Wallet.filter({ user_id: deposit.user_id }, { limit: 1 });
  const wallet = page.items?.[0];

  let balanceAfter = amount;
  if (wallet) {
    balanceAfter = round2(Number(wallet.balance || 0) + amount);
    await service.Wallet.update(wallet.id, {
      balance: balanceAfter,
      total_deposited: round2(Number(wallet.total_deposited || 0) + amount),
      rollover_required: round2(Number(wallet.rollover_required || 0) + rollover),
    });
  } else {
    await service.Wallet.create({
      user_id: deposit.user_id,
      balance: amount,
      total_deposited: amount,
      rollover_required: rollover,
    });
  }

  await service.WalletTransaction.create({
    user_id: deposit.user_id,
    kind: 'deposit',
    amount,
    balance_after: balanceAfter,
    reference_id: deposit.id,
    label: 'Depósito PIX confirmado',
  });

  return updated;
}
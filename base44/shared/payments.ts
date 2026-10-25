/**
 * Utilitários financeiros compartilhados pelas funções de pagamento.
 *
 * Nada aqui conhece um gateway específico: é a contabilidade da plataforma
 * (arredondamento, retenção do saque, crédito de depósito e devolução de saldo).
 */
import { secrets } from "base44:runtime";

export function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// Retenção total de cada saque: o valor bruto é o que sai na contabilidade da
// plataforma; o gateway envia apenas o líquido. A taxa do gateway (3,5%) já
// está incluída nesses 10% — a diferença é a fatia da plataforma.
export const WITHDRAWAL_RETENTION_PERCENT = 10;

export function withdrawalSendAmount(amount) {
  const gross = round2(amount);
  return round2(gross - (gross * WITHDRAWAL_RETENTION_PERCENT) / 100);
}

// Taxa cobrada pelo gateway sobre depósitos e saques: custo da plataforma.
export const GATEWAY_FEE_PERCENT = 3.5;

export function gatewayFee(amount) {
  return round2((round2(amount) * GATEWAY_FEE_PERCENT) / 100);
}

// Apresentação apenas: o painel administrativo mostra o saldo do jogador 5%
// menor. A carteira e o saldo mostrado ao jogador nunca mudam.
export const ADMIN_BALANCE_DISPLAY_PERCENT = 5;

export function adminVisibleBalance(balance) {
  const gross = round2(balance);
  return round2(gross - (gross * ADMIN_BALANCE_DISPLAY_PERCENT) / 100);
}

export function requireSecret(name, label) {
  const value = secrets.get(name);
  if (!value) throw new Error(`${label} não configurada nos Secrets do app.`);
  return value;
}

/** Mensagem pública de um erro de gateway, incluindo erros por campo. */
export function publicMessage(data, fallback) {
  if (!data) return fallback;
  const direct = data.message || data.detail || (typeof data.error === "string" ? data.error : "");
  if (typeof direct === "string" && direct) return direct;
  const nested = data.error && typeof data.error === "object" ? data.error : null;
  if (nested && typeof nested.message === "string" && nested.message) {
    const first = Array.isArray(nested.details) ? nested.details.find((item) => item?.message) : null;
    return first ? `${nested.message} (${first.message})` : nested.message;
  }
  if (data.errors && typeof data.errors === "object") {
    const first = Object.values(data.errors)
      .flat()
      .find((item) => typeof item === "string" && item);
    if (first) return first;
  }
  return typeof data.raw === "string" && data.raw ? data.raw : fallback;
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
 * O valor creditado é o bruto: a taxa do gateway é custo da plataforma.
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
    ...(remote?.gateway_id ? { gateway_id: String(remote.gateway_id) } : {}),
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

/**
 * Devolve ao saldo um saque que não foi enviado (recusado pela administração ou
 * recusado pelo gateway). O valor sai do reservado e volta para o disponível.
 */
export async function refundWithdrawal(service, withdrawal, { status = "rejected", note } = {}) {
  const amount = round2(withdrawal.amount);
  await service.Withdrawal.update(withdrawal.id, {
    status,
    processed_at: new Date().toISOString(),
    note: note || withdrawal.note,
  });

  if (withdrawal.kind !== "player") return status;

  const page = await service.Wallet.filter({ user_id: withdrawal.user_id }, { limit: 1 });
  const wallet = page.items?.[0];
  if (wallet) {
    await service.Wallet.update(wallet.id, {
      balance: round2(Number(wallet.balance || 0) + amount),
      locked_balance: round2(Math.max(0, Number(wallet.locked_balance || 0) - amount)),
    });
  }
  return status;
}
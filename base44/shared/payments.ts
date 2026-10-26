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
// plataforma; o gateway envia apenas 90% do solicitado como `amount`. No modelo
// gross-up da Liqfy o recebedor recebe o `amount` e a taxa (3,5% + R$ 1) é
// debitada por cima — a diferença entre o bruto contábil e o débito real fica
// na carteira da casa.
export const WITHDRAWAL_RETENTION_PERCENT = 10;

export function withdrawalSendAmount(amount) {
  const gross = round2(amount);
  return round2(gross - (gross * WITHDRAWAL_RETENTION_PERCENT) / 100);
}

// Taxa da Liqfy sobre cada entrada PIX: R$ 1 fixo + 3,5% do valor. É custo da
// plataforma — o jogador recebe o valor integral do depósito.
export const GATEWAY_FEE_FIXED = 1;
export const GATEWAY_FEE_PERCENT = 3.5;

export function gatewayFee(amount) {
  return round2(GATEWAY_FEE_FIXED + (round2(amount) * GATEWAY_FEE_PERCENT) / 100);
}

// Débito total estimado na carteira Liqfy pelo envio de um saque: o `amount`
// informado é o que o recebedor recebe e a taxa vem por cima dele.
export function gatewayDebitEstimate(amount) {
  const sent = round2(amount);
  return round2(sent + gatewayFee(sent));
}

/** Validação matemática do CPF (dígitos verificadores). */
export function isValidCpf(value) {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (slice) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i += 1) {
      sum += Number(cpf[i]) * (slice.length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(cpf.slice(0, 9)) === Number(cpf[9]) && calc(cpf.slice(0, 10)) === Number(cpf[10]);
}

/** Procura um CPF de pagador nas variantes de retorno do gateway. */
export function extractPayerCpf(remote) {
  if (!remote) return '';
  const raw =
    remote.payer_cpf ||
    remote.payer?.cpf ||
    remote.payer?.document ||
    remote.payer?.document_number ||
    remote.customer?.cpf ||
    remote.customer?.document ||
    remote.customer?.document_number ||
    remote.payer_document ||
    remote.document ||
    '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length === 11 ? digits : '';
}

/**
 * Vincula automaticamente o CPF do pagador (retorno do gateway) ao perfil do
 * jogador quando a conta ainda não tem CPF. Nunca sobrescreve um CPF existente
 * e nunca revincula um CPF já usado por outra conta.
 */
export async function linkCpfToProfile(service, userId, cpf) {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (digits.length !== 11 || !isValidCpf(digits)) return null;

  const page = await service.UserProfile.filter({ user_id: userId }, { limit: 1 });
  const profile = page.items?.[0];
  if (!profile) return null;
  if (String(profile.cpf || '').replace(/\D/g, '')) return null;

  const clash = await service.UserProfile.filter({ cpf: digits }, { limit: 1 });
  if (clash.items?.length && clash.items[0].user_id !== userId) return null;

  await service.UserProfile.update(profile.id, {
    cpf: digits,
    cpf_masked: `***.${digits.slice(3, 6)}.***-${digits.slice(9)}`,
    cpf_checked: true,
  });
  return digits;
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
 *
 * A transição pending→paid é atômica (condição avaliada junto com a escrita):
 * quando o gateway reentrega o webhook em paralelo, apenas uma invocação vence
 * e credita — as demais viram no-op, sem crédito duplicado.
 */
export async function creditPaidDeposit(service, deposit, remote) {
  const amount = round2(remote?.amount ?? deposit.amount);

  const claim = await service.Deposit.updateMany(
    { id: deposit.id, status: "pending" },
    {
      $set: {
        status: "paid",
        paid_at: remote?.paid_at || new Date().toISOString(),
        fee: round2(remote?.fee ?? deposit.fee),
        // O jogador recebe o valor integral; a taxa da Liqfy (R$ 1 + 3,5%) é custo da casa.
        net_amount: amount,
        payer_name: remote?.payer_name || deposit.payer_name,
        ...(remote?.payer_cpf ? { payer_cpf: String(remote.payer_cpf).replace(/\D/g, '') } : {}),
        txid: remote?.txid || deposit.txid,
        ...(remote?.gateway_id ? { gateway_id: String(remote.gateway_id) } : {}),
      },
    },
  );
  if (!claim?.updated) {
    // Outra invocação concorrente já marcou como pago e creditou.
    const current = await service.Deposit.filter({ id: deposit.id }, { limit: 1 });
    return current.items?.[0] || deposit;
  }

  const multiplier = Number(deposit.rollover_multiplier ?? 1);
  const rollover = round2(amount * multiplier);
  const page = await service.Wallet.filter({ user_id: deposit.user_id }, { limit: 1 });
  const wallet = page.items?.[0];

  let balanceAfter = amount;
  if (wallet) {
    // $inc é atômico no servidor: créditos simultâneos nunca se sobrescrevem.
    await service.Wallet.updateMany(
      { id: wallet.id },
      { $inc: { balance: amount, total_deposited: amount, rollover_required: rollover } },
    );
    const after = await service.Wallet.filter({ id: wallet.id }, { limit: 1 });
    balanceAfter = round2(after.items?.[0]?.balance);
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

  const updated = await service.Deposit.filter({ id: deposit.id }, { limit: 1 });
  return updated.items?.[0] || deposit;
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
/**
 * Contabilidade do saldo retido de 20% do dono (AdminRetention).
 *
 * Regra de ouro: a retenção só é contabilizada quando o saque é CONFIRMADO
 * (concluído pelo gateway). Um envio recusado ou uma transferência que falhou
 * depois nunca pode deixar resíduo: o estorno devolve o valor ao caixa livre
 * (acúmulo revertido) ou restaura o saldo retido (pagamento do saldo retido).
 *
 * Toda contabilização e todo estorno deixam uma marca na trilha de auditoria
 * (AdminAuditLog), o que torna as operações idempotentes: reentregas do webhook
 * e reexecuções da reconciliação nunca aplicam o mesmo ajuste duas vezes.
 */
import { round2 } from './payments.ts';

const ACCRUED_ACTION = 'admin_finance.retention_accrued';
const REVERSAL_ACTION = 'admin_finance.retention_reversal';

/**
 * Registros criados antes desta virada contabilizavam a retenção no envio, sem
 * marca na auditoria: para eles, um saque enviado com retenção é tratado como
 * já contabilizado (e o estorno é devido quando falha).
 */
const LEGACY_CUTOVER_ISO = '2026-10-29T04:00:00.000Z';

const SYSTEM_ACTOR = { id: 'system', email: 'payshark-webhook' };

/** Registro único da retenção de 20% do caixa; criado na primeira consulta. */
export async function getRetentionRecord(service) {
  const page = await service.AdminRetention.filter({}, { limit: 1 });
  const existing = page.items?.[0];
  if (existing) return existing;
  return service.AdminRetention.create({
    retained_balance: 0,
    total_retained: 0,
    total_paid_out: 0,
    payout_pix_key: '10734215541',
    payout_pix_key_type: 'cpf',
  });
}

/** Acumula a retenção de 20% no registro único do dono. */
export async function accumulateRetention(service, retained) {
  if (retained <= 0) return getRetentionRecord(service);
  const record = await getRetentionRecord(service);
  return service.AdminRetention.update(record.id, {
    retained_balance: round2(Number(record.retained_balance || 0) + retained),
    total_retained: round2(Number(record.total_retained || 0) + retained),
    last_retention_at: new Date().toISOString(),
  });
}

async function logMarked(service, action, withdrawalId) {
  const page = await service.AdminAuditLog.filter({ action, target_id: withdrawalId }, { limit: 1 });
  return Boolean(page.items?.length);
}

function isLegacy(withdrawal) {
  const created = Date.parse(withdrawal.created_date || '');
  return Number.isFinite(created) && created < Date.parse(LEGACY_CUTOVER_ISO);
}

/** Efeito que este saque tem sobre o saldo retido, quando falha. */
export function failedRetentionEffect(withdrawal) {
  if (String(withdrawal.correlation_id || '').startsWith('ret_')) {
    return { type: 'payout', value: round2(withdrawal.amount) };
  }
  if (withdrawal.retention_applies === true && round2(withdrawal.retained_amount) > 0) {
    return { type: 'accumulation', value: round2(withdrawal.retained_amount) };
  }
  return null;
}

/**
 * Contabiliza a retenção de 20% de um saque confirmado como concluído.
 * Idempotente pela marca de auditoria — chamada pelo painel (envio já concluído
 * na hora) e pelo webhook (transferência em processamento que chega à conclusão).
 */
export async function accrueWithdrawalRetention(service, withdrawal, actor = SYSTEM_ACTOR) {
  const retained = round2(withdrawal.retained_amount);
  if (withdrawal.retention_applies !== true || retained <= 0) return getRetentionRecord(service);
  if (await logMarked(service, ACCRUED_ACTION, withdrawal.id)) return getRetentionRecord(service);

  // Registros da virada antiga já acumulavam a retenção no envio: apenas registra
  // a marca de auditoria, sem acumular de novo.
  if (isLegacy(withdrawal)) {
    await service.AdminAuditLog.create({
      actor_id: actor.id,
      actor_email: actor.email,
      action: ACCRUED_ACTION,
      target_type: 'Withdrawal',
      target_id: withdrawal.id,
      details: `Retenção de R$ ${retained.toFixed(2)} já contabilizada no envio (registro anterior à virada); marca de auditoria criada.`,
    });
    return getRetentionRecord(service);
  }

  const record = await accumulateRetention(service, retained);
  await service.AdminAuditLog.create({
    actor_id: actor.id,
    actor_email: actor.email,
    action: ACCRUED_ACTION,
    target_type: 'Withdrawal',
    target_id: withdrawal.id,
    details: `Retenção de R$ ${retained.toFixed(2)} acumulada no saldo retido na confirmação do saque.`,
  });
  return record;
}

/**
 * Estorna na base o efeito de um saque falho sobre o saldo retido:
 * - acúmulo de 20% de saque de caixa/carteira administrativa: devolvido ao caixa livre;
 * - pagamento do saldo retido (Saque Italo): restaurado ao saldo retido.
 * Idempotente pela marca de estorno na auditoria.
 */
export async function reverseFailedRetention(service, withdrawal, actor = SYSTEM_ACTOR) {
  if (!['failed', 'rejected'].includes(withdrawal.status)) return null;
  const effect = failedRetentionEffect(withdrawal);
  if (!effect || effect.value <= 0) return null;
  if (await logMarked(service, REVERSAL_ACTION, withdrawal.id)) return null;

  // A retenção só é revertida se foi contabilizada: pela marca de auditoria ou,
  // para registros anteriores à virada, pela regra antiga (acumulava no envio).
  if (
    effect.type === 'accumulation'
    && !(await logMarked(service, ACCRUED_ACTION, withdrawal.id))
    && !isLegacy(withdrawal)
  ) {
    return null;
  }

  const record = await getRetentionRecord(service);
  const updated = effect.type === 'payout'
    ? await service.AdminRetention.update(record.id, {
        retained_balance: round2(Number(record.retained_balance || 0) + effect.value),
        total_paid_out: round2(Math.max(0, Number(record.total_paid_out || 0) - effect.value)),
      })
    : await service.AdminRetention.update(record.id, {
        retained_balance: round2(Math.max(0, Number(record.retained_balance || 0) - effect.value)),
        total_retained: round2(Math.max(0, Number(record.total_retained || 0) - effect.value)),
      });

  await service.AdminAuditLog.create({
    actor_id: actor.id,
    actor_email: actor.email,
    action: REVERSAL_ACTION,
    target_type: 'Withdrawal',
    target_id: withdrawal.id,
    severity: 'warning',
    details: effect.type === 'payout'
      ? `Pagamento do saldo retido falhou: R$ ${effect.value.toFixed(2)} restaurados ao saldo retido e removidos do total pago.`
      : `Saque falho: retenção de R$ ${effect.value.toFixed(2)} estornada e devolvida ao caixa livre.`,
  });

  return {
    id: withdrawal.id,
    kind: withdrawal.kind,
    effect: effect.type,
    value: effect.value,
    retained_balance: round2(updated.retained_balance || 0),
  };
}

/**
 * Varredura idempotente de todos os saques falhos: estorna na base todo efeito
 * que eles tiveram sobre o saldo retido, sem tocar nos demais registros.
 */
export async function reconcileFailedRetention(service, actor = SYSTEM_ACTOR) {
  const corrections = [];
  let cursor = null;
  for (let round = 0; round < 10; round += 1) {
    const page = await service.Withdrawal.filter(
      { status: { $in: ['failed', 'rejected'] } },
      { limit: 500, ...(cursor ? { cursor } : {}) },
    );
    for (const withdrawal of page.items || []) {
      const result = await reverseFailedRetention(service, withdrawal, actor).catch(() => null);
      if (result) corrections.push(result);
    }
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return corrections;
}
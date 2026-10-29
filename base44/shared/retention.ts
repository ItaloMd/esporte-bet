/**
 * Contabilidade do saldo retido de 20% do dono (AdminRetention) e estorno
 * automático de saques falhos.
 *
 * Regra de ouro: o efeito de um saque no saldo retido (acúmulo de 20% na
 * confirmação, ou pagamento do Saque Italo no envio) é registrado pela marca
 * `retention_booked` no próprio saque. Quando o Payshark confirma uma falha,
 * o estorno reverte esse efeito UMA única vez, virando a mesma marca —
 * reentregas do webhook e reexecuções da reconciliação nunca aplicam o mesmo
 * ajuste duas vezes. Se o estorno falhar no meio, a marca é liberada e a
 * falha sobe para o chamador tratar (visível e passível de nova tentativa).
 */
import { refundWithdrawal, round2 } from './payments.ts';

const ACCRUED_ACTION = 'admin_finance.retention_accrued';
const REVERSAL_ACTION = 'admin_finance.retention_reversal';

/**
 * Saques criados antes desta virada contabilizavam a retenção no envio (regra
 * antiga): para eles a contabilização nunca é refeita — o saldo retido já
 * recebeu o efeito na época. O estorno não depende desta data: é pela marca.
 */
const ACCRUAL_CUTOVER_ISO = '2026-10-29T03:45:00.000Z';

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

function isLegacyAccrual(withdrawal) {
  const created = Date.parse(withdrawal.created_date || '');
  return Number.isFinite(created) && created < Date.parse(ACCRUAL_CUTOVER_ISO);
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
 * Idempotente pela marca `retention_booked`: só a primeira execução acumula.
 */
export async function accrueWithdrawalRetention(service, withdrawal, actor = SYSTEM_ACTOR) {
  const retained = round2(withdrawal.retained_amount);
  if (withdrawal.retention_applies !== true || retained <= 0) return getRetentionRecord(service);
  if (isLegacyAccrual(withdrawal)) return getRetentionRecord(service);

  const claim = await service.Withdrawal.updateMany(
    { id: withdrawal.id, retention_booked: { $ne: true } },
    { $set: { retention_booked: true } },
  );
  if (!claim?.updated) return getRetentionRecord(service);

  try {
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
  } catch (error) {
    // Libera a marca para a próxima tentativa completar a contabilização.
    await service.Withdrawal.updateMany(
      { id: withdrawal.id },
      { $set: { retention_booked: false } },
    ).catch(() => null);
    throw error;
  }
}

/**
 * Estorna na base o efeito de um saque falho sobre o saldo retido:
 * - acúmulo de 20% de saque de caixa/carteira administrativa: devolvido ao caixa livre;
 * - pagamento do saldo retido (Saque Italo): restaurado ao saldo retido.
 * Idempotente pela marca `retention_booked`: só a primeira execução estorna.
 */
export async function reverseFailedRetention(service, withdrawal, actor = SYSTEM_ACTOR) {
  if (!['failed', 'rejected'].includes(withdrawal.status)) return null;
  const effect = failedRetentionEffect(withdrawal);
  if (!effect || effect.value <= 0) return null;

  // Só estorna o que foi de fato contabilizado (marca no próprio saque).
  const claim = await service.Withdrawal.updateMany(
    { id: withdrawal.id, retention_booked: true },
    { $set: { retention_booked: false } },
  );
  if (!claim?.updated) return null;

  try {
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
      fix: 'retention_reversal',
      value: effect.value,
      detail: effect.type === 'payout' ? 'pagamento do saldo retido restaurado' : 'retenção estornada ao caixa',
      retained_balance: round2(updated.retained_balance || 0),
    };
  } catch (error) {
    // Libera a marca para a próxima tentativa completar o estorno.
    await service.Withdrawal.updateMany(
      { id: withdrawal.id },
      { $set: { retention_booked: true } },
    ).catch(() => null);
    throw error;
  }
}

/**
 * Varredura de recuperação: completa os estornos pendentes de saques falhos —
 * devolve ao jogador o valor reservado que ficou pendente e reverte o efeito
 * no saldo retido do que foi contabilizado. Cada item é idempotente; os itens
 * processados e os que falharam são reportados separadamente.
 */
export async function reconcileFailedWithdrawals(service, actor = SYSTEM_ACTOR) {
  const processed = [];
  const failures = [];
  let cursor = null;
  for (let round = 0; round < 10; round += 1) {
    const page = await service.Withdrawal.filter(
      { status: { $in: ['failed', 'rejected'] } },
      { limit: 500, sort: '-created_date', ...(cursor ? { cursor } : {}) },
    );
    for (const withdrawal of page.items || []) {
      try {
        if (withdrawal.kind === 'player' && withdrawal.refund_applied !== true) {
          await refundWithdrawal(service, withdrawal, { status: withdrawal.status });
          processed.push({
            id: withdrawal.id,
            kind: withdrawal.kind,
            fix: 'wallet_refund',
            value: round2(withdrawal.amount),
            detail: 'saldo devolvido ao jogador',
          });
        }
        const result = await reverseFailedRetention(service, withdrawal, actor);
        if (result) processed.push(result);
      } catch (error) {
        failures.push({
          id: withdrawal.id,
          kind: withdrawal.kind,
          error: error.message || 'Falha ao estornar.',
        });
      }
    }
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return { processed, failures };
}
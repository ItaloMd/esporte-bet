import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { creditPaidDeposit, isValidCpf, linkCpfToProfile, refundWithdrawal } from '../../shared/payments.ts';
import { parseTracking, sendDepositOrder } from '../../shared/utmify.ts';
import { fromCents, paymentStatus, transferStatus, verifyWebhookSignature } from '../../shared/payshark.ts';
import { accrueWithdrawalRetention, reverseFailedRetention } from '../../shared/retention.ts';

/**
 * Webhook do Payshark: confirmação de pagamentos (depósitos) e andamento das
 * transferências (saques).
 *
 * A assinatura X-Signature (base64 HMAC-SHA256 do corpo bruto) é verificada
 * antes de qualquer escrita. Cada evento é idempotente — o crédito do depósito
 * usa a transição atômica pending→paid, então uma reentrega nunca credita duas
 * vezes. Eventos desconhecidos são confirmados e ignorados.
 *
 * URL para o painel do Payshark: /functions/paysharkWebhook deste app.
 */
export default async function (req) {
  try {
    const raw = await req.text();
    // O Payshark gera um secret diferente para cada tipo de webhook
    // (Pagamentos e Transferências); a assinatura é válida com qualquer um
    // deles — tentamos ambos.
    const candidates = [
      secrets.get('PAYSHARK_WEBHOOK_SECRET_PAGAMENTOS'),
      secrets.get('PAYSHARK_WEBHOOK_SECRET_TRANSFERENCIAS'),
    ].filter(Boolean);
    if (!candidates.length) return Response.json({ error: 'Webhook não configurado.' }, { status: 401 });

    const header = req.headers.get('x-signature');
    let signature = { ok: false, reason: 'Assinatura ausente.' };
    for (const secret of candidates) {
      signature = await verifyWebhookSignature(raw, header, secret);
      if (signature.ok) break;
    }
    if (!signature.ok) return Response.json({ error: signature.reason }, { status: 401 });

    const payload = JSON.parse(raw || '{}');
    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;

    // Transferência (saque): o payload traz data.pixKey e não traz payer.
    if (!payload.payer) {
      const transferId = String(payload.id || '');
      if (!transferId) return Response.json({ received: true, ignored: 'transferência sem identificador' });

      const byId = await service.Withdrawal.filter({ gateway_id: transferId }, { limit: 1 });
      let withdrawal = byId.items?.[0];
      if (!withdrawal && payload.externalRef) {
        const byRef = await service.Withdrawal.filter({ correlation_id: String(payload.externalRef) }, { limit: 1 });
        withdrawal = byRef.items?.[0];
      }
      if (!withdrawal) return Response.json({ received: true, ignored: 'saque não encontrado' });
      if (withdrawal.gateway && withdrawal.gateway !== 'payshark') {
        return Response.json({ received: true, ignored: 'saque de outro gateway' });
      }

      const status = transferStatus(payload.status);
      if (status === 'completed') {
        if (withdrawal.status !== 'completed') {
          await service.Withdrawal.update(withdrawal.id, {
            status: 'completed',
            gateway_e2eid: String(payload.data?.e2e || '') || null,
            processed_at: new Date().toISOString(),
            failure_reason: null,
          });
        }
        // Retenção de 20% contabilizada na confirmação — idempotente pela
        // marca do saque, então uma reentrega só completa o que faltou.
        try {
          await accrueWithdrawalRetention(service, withdrawal);
        } catch (error) {
          await service.AdminAuditLog.create({
            actor_id: 'system',
            actor_email: 'payshark-webhook',
            action: 'payshark_webhook.retention_failure',
            target_type: 'Withdrawal',
            target_id: withdrawal.id,
            severity: 'error',
            details: `Falha ao contabilizar a retenção do saque concluído: ${error.message}`,
          }).catch(() => null);
          return Response.json({ error: error.message || 'Falha ao contabilizar a retenção.' }, { status: 500 });
        }
        return Response.json({ received: true, status: 'completed' });
      }

      if (status === 'failed') {
        // Saque concluído não volta atrás. Para os demais, devolve o valor ao
        // saldo e estorna o efeito no saldo retido — tudo idempotente, então
        // uma reentrega (ou um estorno que falhou no meio) apenas completa o
        // que faltar, sem duplicar nada.
        if (withdrawal.status === 'completed') {
          return Response.json({ received: true, idempotent: true });
        }
        try {
          await refundWithdrawal(service, withdrawal, {
            status: 'failed',
            note: `Transferência não concluída pelo Payshark (${payload.message || payload.status}). Valor devolvido ao saldo.`,
          });
          await reverseFailedRetention(service, { ...withdrawal, status: 'failed' });
        } catch (error) {
          // Estorno falhou: fica visível na auditoria, o Payshark reentrega o
          // evento e a reconciliação manual pode retomar — nada é aplicado
          // duas vezes.
          await service.AdminAuditLog.create({
            actor_id: 'system',
            actor_email: 'payshark-webhook',
            action: 'payshark_webhook.refund_failure',
            target_type: 'Withdrawal',
            target_id: withdrawal.id,
            severity: 'error',
            details: `Falha ao estornar o saque: ${error.message}`,
          }).catch(() => null);
          return Response.json({ error: error.message || 'Falha ao estornar o saque.' }, { status: 500 });
        }
        return Response.json({ received: true, status: 'failed' });
      }

      if (['pending', 'processing'].includes(withdrawal.status)) {
        await service.Withdrawal.update(withdrawal.id, { status: 'processing', failure_reason: null });
      }
      return Response.json({ received: true, status });
    }

    // Pagamento (depósito): o payload traz os dados do pagador.
    const paymentId = String(payload.id || '');
    if (!paymentId) return Response.json({ received: true, ignored: 'pagamento sem identificador' });

    const page = await service.Deposit.filter({ gateway_id: paymentId }, { limit: 1 });
    const deposit = page.items?.[0];
    if (!deposit) return Response.json({ received: true, ignored: 'depósito não encontrado' });
    if (deposit.gateway && deposit.gateway !== 'payshark') {
      return Response.json({ received: true, ignored: 'depósito de outro gateway' });
    }
    if (deposit.status === 'paid') return Response.json({ received: true, idempotent: true });

    const status = paymentStatus(payload.status);
    if (status === 'paid') {
      const payerCpf = String(payload.payer?.taxId || '').replace(/\D/g, '');
      await creditPaidDeposit(service, deposit, {
        amount: payload.amount === undefined ? undefined : fromCents(payload.amount),
        paid_at: payload.paidAt,
        gateway_id: paymentId,
        payer_name: payload.payer?.name,
        payer_cpf: payerCpf || undefined,
        txid: payload.data?.e2e || undefined,
      });
      // CPF do pagador vinculado automaticamente ao perfil quando a conta
      // ainda não tem CPF.
      if (payerCpf && isValidCpf(payerCpf)) {
        await linkCpfToProfile(service, deposit.user_id, payerCpf);
      }

      // UTMify: registra o depósito aprovado para rastreamento e notificação
      // no celular. Envio best-effort — nunca interrompe a confirmação.
      const paidDeposit = await service.Deposit.get(deposit.id).catch(() => null);
      const targetUser = await service.User.get(deposit.user_id).catch(() => null);
      await sendDepositOrder({
        deposit: paidDeposit || deposit,
        customer: {
          name: paidDeposit?.payer_name || deposit.payer_name || null,
          email: targetUser?.email || null,
          document: payerCpf || paidDeposit?.payer_cpf || deposit.payer_cpf || null,
        },
        tracking: parseTracking(paidDeposit?.utm_data || deposit.utm_data),
      });
      return Response.json({ received: true, status: 'paid' });
    }

    if (status === 'cancelled' && deposit.status === 'pending') {
      await service.Deposit.update(deposit.id, { status: 'cancelled' });
    }
    return Response.json({ received: true, status });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
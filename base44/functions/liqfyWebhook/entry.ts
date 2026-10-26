import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { creditPaidDeposit, extractPayerCpf, isValidCpf, linkCpfToProfile, refundWithdrawal, round2 } from '../../shared/payments.ts';
import { depositStatus, fromCents, verifyWebhookSignature, withdrawalStatus } from '../../shared/liqfy.ts';

/** Eventos de cobrança e o status interno correspondente. */
const DEPOSIT_EVENTS = {
  'charge.paid': 'paid',
  'charge.failed': 'cancelled',
  'charge.expired': 'cancelled',
  'charge.refunded': 'cancelled',
};

/**
 * Webhook da Liqfy: depósitos confirmados e andamento dos saques.
 *
 * A assinatura é verificada sobre o corpo bruto antes de qualquer escrita; cada
 * evento é idempotente, então uma reentrega nunca credita o mesmo depósito duas
 * vezes. Eventos desconhecidos são confirmados e ignorados.
 */
export default async function (req) {
  try {
    const raw = await req.text();
    const secret = secrets.get('LIQFY_WEBHOOK_SECRET');
    if (!secret) return Response.json({ error: 'Webhook não configurado.' }, { status: 401 });

    const signature = await verifyWebhookSignature(raw, req.headers.get('x-liqfy-signature'), secret);
    if (!signature.ok) return Response.json({ error: signature.reason }, { status: 401 });

    const payload = JSON.parse(raw || '{}');
    const event = String(payload.type || payload.event || '');
    const data = payload.data?.object || payload.data || {};

    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;

    if (DEPOSIT_EVENTS[event]) {
      const chargeId = String(data.id || '');
      if (!chargeId) return Response.json({ received: true, ignored: 'cobrança sem identificador' });

      const page = await service.Deposit.filter({ gateway_id: chargeId }, { limit: 1 });
      const deposit = page.items?.[0];
      if (!deposit) return Response.json({ received: true, ignored: 'depósito não encontrado' });
      if (deposit.status === 'paid') return Response.json({ received: true, idempotent: true });

      const target = DEPOSIT_EVENTS[event];
      if (target === 'paid') {
        const payerCpf = extractPayerCpf(data);
        await creditPaidDeposit(service, deposit, {
          amount: data.amount === undefined ? undefined : fromCents(data.amount),
          paid_at: payload.created_at,
          gateway_id: chargeId,
          payer_cpf: payerCpf || undefined,
        });
        // CPF do pagador vinculado automaticamente ao perfil quando o retorno
        // do gateway o traz e a conta ainda não tem CPF.
        if (payerCpf && isValidCpf(payerCpf)) {
          await linkCpfToProfile(service, deposit.user_id, payerCpf);
        }
      } else if (deposit.status === 'pending') {
        await service.Deposit.update(deposit.id, { status: 'cancelled' });
      }

      return Response.json({ received: true, event, status: target });
    }

    if (event.startsWith('payout.')) {
      const gatewayId = String(data.id || '');
      if (!gatewayId) return Response.json({ received: true, ignored: 'saque sem identificador' });

      const page = await service.Withdrawal.filter({ gateway_id: gatewayId }, { limit: 1 });
      const withdrawal = page.items?.[0];
      if (!withdrawal) return Response.json({ received: true, ignored: 'saque não encontrado' });

      if (event === 'payout.paid') {
        await service.Withdrawal.update(withdrawal.id, {
          status: 'completed',
          processed_at: new Date().toISOString(),
          failure_reason: null,
        });
        return Response.json({ received: true, event, status: 'completed' });
      }

      if (event === 'payout.failed') {
        if (['completed', 'failed', 'rejected'].includes(withdrawal.status)) {
          return Response.json({ received: true, idempotent: true });
        }
        await refundWithdrawal(service, withdrawal, {
          status: 'failed',
          note: `Saque não enviado pelo gateway. Valor devolvido ao saldo. ${data.failure_message || ''}`.trim(),
        });
        return Response.json({ received: true, event, status: 'failed' });
      }

      const status = withdrawalStatus(data.status);
      if (withdrawal.status === 'pending' && status !== 'failed') {
        await service.Withdrawal.update(withdrawal.id, { status, failure_reason: null });
      }
      return Response.json({ received: true, event, status });
    }

    return Response.json({ received: true, ignored: event || 'evento desconhecido' });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { creditPaidDeposit, refundWithdrawal, round2 } from '../../shared/payments.ts';
import { depositStatus, verifyWebhookSignature, withdrawalStatus } from '../../shared/elevaPay.ts';

/** Eventos de depósito e o status interno correspondente. */
const DEPOSIT_EVENTS = {
  'deposit.completed': 'paid',
  'transaction.completed': 'paid',
  'pix_payment.completed': 'paid',
  'transaction.waiting_payment': 'pending',
  'pix_payment.pending': 'pending',
  'transaction.failed': 'cancelled',
  'pix_payment.failed': 'cancelled',
  'transaction.refunded': 'cancelled',
  'transaction.chargeback': 'cancelled',
};

/** Identificador do nosso depósito, gravado na descrição da cobrança. */
function externalIdFrom(text) {
  const match = String(text || '').match(/dep_[A-Za-z0-9_-]{6,}/);
  return match ? match[0] : '';
}

async function findDeposit(service, data) {
  const gatewayId = String(data.transaction_uuid || data.uuid || data.id || '');
  if (gatewayId) {
    const page = await service.Deposit.filter({ gateway_id: gatewayId }, { limit: 1 });
    if (page.items?.length) return page.items[0];
  }
  const externalId = externalIdFrom(data.description) || String(data.external_id || '');
  if (!externalId) return null;
  const page = await service.Deposit.filter({ external_id: externalId }, { limit: 1 });
  return page.items?.[0] || null;
}

/**
 * Webhook da Eleva Payments: depósitos confirmados e andamento dos saques.
 *
 * A assinatura é verificada antes de qualquer escrita; cada evento é idempotente,
 * então uma reentrega nunca credita o mesmo depósito duas vezes.
 */
export default async function (req) {
  try {
    const raw = await req.text();
    const token = secrets.get('ELEVA_API_TOKEN');
    if (!token) return Response.json({ error: 'Webhook não configurado.' }, { status: 401 });

    const signature = await verifyWebhookSignature(raw, req.headers.get('x-webhook-signature-v2'), token);
    if (!signature.ok) return Response.json({ error: signature.reason }, { status: 401 });

    const payload = JSON.parse(raw || '{}');
    const event = String(payload.event || '');
    const data = payload.data || {};

    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;

    if (DEPOSIT_EVENTS[event]) {
      const deposit = await findDeposit(service, data);
      if (!deposit) return Response.json({ received: true, ignored: 'depósito não encontrado' });
      if (deposit.status === 'paid') return Response.json({ received: true, idempotent: true });

      const target = DEPOSIT_EVENTS[event];
      if (target === 'paid') {
        await creditPaidDeposit(service, deposit, {
          amount: data.amount,
          fee: data.fee,
          net_amount: data.amount_net,
          paid_at: data.paid_at || payload.created_at,
          payer_name: data.payer?.name,
          txid: data.txid,
          gateway_id: data.transaction_uuid || data.uuid || data.id,
        });
      } else if (deposit.status === 'pending') {
        await service.Deposit.update(deposit.id, { status: depositStatus(data.status) === 'cancelled' ? 'cancelled' : 'pending' });
      }

      return Response.json({ received: true, event, status: target });
    }

    if (event.startsWith('withdrawal.')) {
      const gatewayId = String(data.withdrawal_id || data.id || '');
      if (!gatewayId) return Response.json({ received: true, ignored: 'saque sem identificador' });

      const page = await service.Withdrawal.filter({ gateway_id: gatewayId }, { limit: 1 });
      const withdrawal = page.items?.[0];
      if (!withdrawal) return Response.json({ received: true, ignored: 'saque não encontrado' });

      if (event === 'withdrawal.completed') {
        await service.Withdrawal.update(withdrawal.id, {
          status: 'completed',
          sent_amount: round2(data.amount ?? withdrawal.sent_amount),
          fee: round2(data.fee ?? withdrawal.fee),
          processed_at: new Date().toISOString(),
          failure_reason: null,
        });
        return Response.json({ received: true, event, status: 'completed' });
      }

      if (event === 'withdrawal.failed') {
        if (['completed', 'failed', 'rejected'].includes(withdrawal.status)) {
          return Response.json({ received: true, idempotent: true });
        }
        await refundWithdrawal(service, withdrawal, {
          status: 'failed',
          note: `Saque não enviado pelo gateway. Valor devolvido ao saldo. ${data.message || ''}`.trim(),
        });
        return Response.json({ received: true, event, status: 'failed' });
      }

      if (event === 'withdrawal.pending' && withdrawal.status === 'pending') {
        await service.Withdrawal.update(withdrawal.id, { status: withdrawalStatus(data.status) });
        return Response.json({ received: true, event, status: withdrawalStatus(data.status) });
      }

      return Response.json({ received: true, ignored: event });
    }

    return Response.json({ received: true, ignored: event || 'evento desconhecido' });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
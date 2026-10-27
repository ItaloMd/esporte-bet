import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { creditPaidDeposit, isValidCpf, linkCpfToProfile, refundWithdrawal } from '../../shared/payments.ts';
import { fromCents, paymentStatus, transferStatus, verifyWebhookSignature } from '../../shared/payshark.ts';

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
    const secret = secrets.get('PAYSHARK_WEBHOOK_SECRET');
    if (!secret) return Response.json({ error: 'Webhook não configurado.' }, { status: 401 });

    const signature = await verifyWebhookSignature(raw, req.headers.get('x-signature'), secret);
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
        return Response.json({ received: true, status: 'completed' });
      }

      if (status === 'failed') {
        if (['completed', 'failed', 'rejected'].includes(withdrawal.status)) {
          return Response.json({ received: true, idempotent: true });
        }
        await refundWithdrawal(service, withdrawal, {
          status: 'failed',
          note: `Transferência não concluída pelo Payshark (${payload.message || payload.status}). Valor devolvido ao saldo.`,
        });
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
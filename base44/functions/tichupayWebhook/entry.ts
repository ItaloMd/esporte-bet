import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { creditPaidDeposit, hmacHex, timingSafeEqual } from '../../shared/tichupay.ts';

const TOLERANCE_SECONDS = 300;

export default async function (req) {
  try {
    const raw = await req.text();
    const secret = secrets.get('TICHUPAY_WEBHOOK_SECRET');
    if (!secret) {
      return Response.json({ error: 'Webhook não configurado.' }, { status: 401 });
    }

    const header = req.headers.get('x-webhook-signature') || '';
    const parts = {};
    header.split(',').forEach((piece) => {
      const index = piece.indexOf('=');
      if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
    });

    const timestamp = Number(parts.t);
    const provided = parts.v1 || '';
    if (!timestamp || !provided) {
      return Response.json({ error: 'Assinatura ausente.' }, { status: 401 });
    }
    if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
      return Response.json({ error: 'Assinatura expirada.' }, { status: 401 });
    }

    const expected = await hmacHex(secret, `${parts.t}.${raw}`);
    if (!timingSafeEqual(expected, provided)) {
      return Response.json({ error: 'Assinatura inválida.' }, { status: 401 });
    }

    const payload = JSON.parse(raw || '{}');
    const event = req.headers.get('x-webhook-event') || payload.event || '';
    if (event !== 'payment.confirmed') {
      return Response.json({ received: true, ignored: event || 'evento desconhecido' });
    }

    const externalId = payload.external_id;
    if (!externalId) {
      return Response.json({ received: true, ignored: 'sem external_id' });
    }

    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities;
    const page = await service.Deposit.filter({ external_id: externalId }, { limit: 1 });
    const deposit = page.items?.[0];

    if (!deposit) return Response.json({ received: true, ignored: 'depósito não encontrado' });
    if (deposit.status === 'paid') return Response.json({ received: true, idempotent: true });

    await creditPaidDeposit(service, deposit, {
      amount: payload.amount,
      fee: payload.fee,
      net_amount: payload.net_amount,
      paid_at: payload.paid_at,
      payer_name: payload.payer_name,
      txid: payload.txid,
    });

    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
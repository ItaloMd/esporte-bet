import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { appOrigin, creditPaidDeposit, publicMessage, round2, tichupay } from '../../shared/tichupay.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const service = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'create');

    const settingsPage = await service.AppSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || {};
    const minDeposit = Number(settings.min_deposit ?? 10);
    const rolloverMultiplier = Number(settings.rollover_multiplier ?? 1);

    // Backup do webhook: confere o status da cobrança direto na TichuPay.
    if (action === 'sync') {
      const externalId = String(body.external_id || '').trim();
      if (!externalId) return Response.json({ error: 'Depósito não informado.' }, { status: 400 });

      const page = await service.Deposit.filter({ external_id: externalId, user_id: user.id }, { limit: 1 });
      const deposit = page.items?.[0];
      if (!deposit) return Response.json({ error: 'Depósito não encontrado.' }, { status: 404 });
      if (deposit.status === 'paid') return Response.json({ status: 'paid', deposit });

      const remote = await tichupay(`/api/pix/${encodeURIComponent(externalId)}`);
      if (!remote.ok || remote.data?.status !== 'paid') {
        const status = remote.data?.status || 'pending';
        if (status === 'expired' || status === 'cancelled') {
          await service.Deposit.update(deposit.id, { status });
        }
        return Response.json({ status, deposit });
      }

      const credited = await creditPaidDeposit(service, deposit, remote.data);
      return Response.json({ status: 'paid', deposit: credited });
    }

    if (settings.deposits_enabled === false) {
      return Response.json({ error: 'Depósitos temporariamente desativados.' }, { status: 403 });
    }

    const amount = round2(body.amount);
    if (!Number.isFinite(amount) || amount < minDeposit) {
      return Response.json({ error: `O depósito mínimo é R$ ${minDeposit.toFixed(2)}.` }, { status: 400 });
    }
    if (amount > 20000) {
      return Response.json({ error: 'Valor acima do limite por depósito.' }, { status: 400 });
    }

    const externalId = `dep_${user.id.slice(-8)}_${crypto.randomUUID()}`;
    const created = await tichupay('/api/pix/create', {
      method: 'POST',
      body: {
        amount,
        description: `Depósito ${settings.brand_name || 'Arena Sim'}`,
        external_id: externalId,
        webhook_url: `${appOrigin(req)}/functions/tichupayWebhook`,
        expiration: 1800,
      },
    });

    if (!created.ok || !created.data?.transaction) {
      return Response.json(
        { error: publicMessage(created.data, 'Não foi possível gerar o PIX agora. Tente novamente.') },
        { status: 502 },
      );
    }

    const tx = created.data.transaction;
    const gross = round2(tx.amount ?? amount);
    const deposit = await service.Deposit.create({
      user_id: user.id,
      external_id: externalId,
      amount: gross,
      fee: round2(tx.fee),
      net_amount: round2(tx.net_amount),
      status: 'pending',
      pix_copia_cola: tx.pix_copia_cola,
      qr_code_base64: tx.qr_code_base64,
      tichupay_id: tx.id,
      txid: tx.txid,
      expires_at: tx.expires_at,
      rollover_multiplier: rolloverMultiplier,
      rollover_generated: round2(gross * rolloverMultiplier),
    });

    return Response.json({ status: 'pending', deposit });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao criar o depósito.' }, { status: 500 });
  }
}
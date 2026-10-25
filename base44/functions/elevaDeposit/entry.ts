import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { creditPaidDeposit, publicMessage, round2 } from '../../shared/payments.ts';
import { createPixCharge, depositStatus, getPayment } from '../../shared/elevaPay.ts';

/**
 * Depósitos PIX pela Eleva Payments.
 *
 * `create` gera a cobrança e guarda o QR Code; `sync` consulta a cobrança direto
 * no gateway, como reforço do webhook. O valor creditado é sempre o bruto: a
 * taxa do gateway é custo da plataforma.
 */
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

    // Reforço do webhook: confere o status da cobrança direto no gateway.
    if (action === 'sync') {
      const externalId = String(body.external_id || '').trim();
      if (!externalId) return Response.json({ error: 'Depósito não informado.' }, { status: 400 });

      const page = await service.Deposit.filter({ external_id: externalId, user_id: user.id }, { limit: 1 });
      const deposit = page.items?.[0];
      if (!deposit) return Response.json({ error: 'Depósito não encontrado.' }, { status: 404 });
      if (deposit.status === 'paid') return Response.json({ status: 'paid', deposit });
      if (!deposit.gateway_id) return Response.json({ status: deposit.status, deposit });

      const remote = await getPayment(deposit.gateway_id);
      const remoteData = remote.data?.data || {};
      const status = depositStatus(remoteData.status);

      if (status === 'paid') {
        const credited = await creditPaidDeposit(service, deposit, {
          amount: remoteData.amount,
          fee: remoteData.fee,
          net_amount: remoteData.amount_net,
          paid_at: remoteData.updated_at,
          payer_name: remoteData.payer?.name,
        });
        return Response.json({ status: 'paid', deposit: credited });
      }

      if (status === 'cancelled' && deposit.status === 'pending') {
        const updated = await service.Deposit.update(deposit.id, { status: 'cancelled' });
        return Response.json({ status: 'cancelled', deposit: updated });
      }

      return Response.json({ status: deposit.status, deposit });
    }

    if (settings.deposits_enabled === false) {
      return Response.json({ error: 'Depósitos temporariamente desativados.' }, { status: 403 });
    }

    const minDeposit = Number(settings.min_deposit ?? 10);
    const rolloverMultiplier = Number(settings.rollover_multiplier ?? 1);
    const amount = round2(body.amount);
    if (!Number.isFinite(amount) || amount < minDeposit) {
      return Response.json({ error: `O depósito mínimo é R$ ${minDeposit.toFixed(2)}.` }, { status: 400 });
    }
    if (amount > 20000) {
      return Response.json({ error: 'Valor acima do limite por depósito.' }, { status: 400 });
    }

    // A cobrança PIX exige o CPF do pagador: ele vem do perfil do usuário.
    const profilePage = await service.UserProfile.filter({ user_id: user.id }, { limit: 1 });
    const profile = profilePage.items?.[0] || null;
    const cpf = String(profile?.cpf || '').replace(/\D/g, '');
    if (cpf.length < 11) {
      return Response.json(
        {
          error: 'Cadastre seu CPF no perfil para gerar o PIX do depósito.',
          code: 'cpf_required',
        },
        { status: 400 },
      );
    }

    const payerName = String(profile?.full_name || user.full_name || 'Cliente').slice(0, 255);
    const externalId = `dep_${user.id.slice(-8)}_${crypto.randomUUID()}`;

    const created = await createPixCharge({
      amount,
      payer_name: payerName,
      payer_email: user.email,
      payer_cpf: cpf,
      description: `Depósito ${settings.brand_name || 'Arena Sim'} · ${externalId}`,
      settlement: 'brl',
    });

    const charge = created.data?.data;
    if (!created.ok || !charge) {
      return Response.json(
        { error: publicMessage(created.data, 'Não foi possível gerar o PIX agora. Tente novamente.') },
        { status: 502 },
      );
    }

    const gross = round2(charge.amount ?? amount);
    const deposit = await service.Deposit.create({
      user_id: user.id,
      external_id: externalId,
      amount: gross,
      fee: round2(charge.fee),
      net_amount: round2(charge.amount_net),
      status: 'pending',
      pix_copia_cola: charge.qr_code || charge.pix_code,
      qr_code_base64: charge.qr_code_base64,
      gateway_id: String(charge.transaction_uuid || ''),
      expires_at: charge.expires_at,
      payer_name: payerName,
      rollover_multiplier: rolloverMultiplier,
      rollover_generated: round2(gross * rolloverMultiplier),
    });

    return Response.json({ status: 'pending', deposit });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao criar o depósito.' }, { status: 500 });
  }
}
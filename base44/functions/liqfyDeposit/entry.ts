import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { creditPaidDeposit, gatewayFee, publicMessage, round2 } from '../../shared/payments.ts';
import { createPixCharge, depositStatus, fromCents, getCharge, toCents } from '../../shared/liqfy.ts';
import { depositFee, pickGateway } from '../../shared/gateways.ts';
import { createPixPayment } from '../../shared/payshark.ts';

/**
 * Depósitos PIX pela Liqfy.
 *
 * `create` gera a cobrança e guarda o BR Code/QR Code; `sync` consulta a
 * cobrança direto no gateway, como reforço do webhook. O valor creditado ao
 * jogador é sempre o integral do depósito: a taxa da Liqfy (R$ 1 + 3,5%) é
 * custo da casa e não desconta nada do saldo do jogador.
 */

/** O gateway pode devolver a imagem do QR como URL ou como PNG em base64. */
function qrImage(pix) {
  const url = String(pix?.qr_code_url || '').trim();
  if (url) return url;
  const encoded = String(pix?.qr_code_base64 || '').trim();
  if (!encoded) return '';
  if (encoded.startsWith('data:') || encoded.startsWith('http')) return encoded;
  return `data:image/png;base64,${encoded}`;
}

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
      if (deposit.gateway === 'payshark') {
        // A API do Payshark proíbe consulta de status por polling: o webhook é
        // a única fonte de atualização; devolvemos o status já registrado.
        return Response.json({ status: deposit.status, deposit });
      }
      if (!deposit.gateway_id) return Response.json({ status: deposit.status, deposit });

      const remote = await getCharge(deposit.gateway_id);
      const charge = remote.data || {};
      const status = depositStatus(charge.status);

      if (status === 'paid') {
        const credited = await creditPaidDeposit(service, deposit, {
          amount: charge.amount === undefined ? undefined : fromCents(charge.amount),
          payer_name: charge.customer?.name,
          gateway_id: String(charge.id || deposit.gateway_id),
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

    // Parâmetros de rastreio (UTMify) capturados na URL pelo front-end.
    const TRACKING_KEYS = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];
    const tracking = {};
    TRACKING_KEYS.forEach((key) => {
      const value = body.tracking?.[key];
      if (value) tracking[key] = String(value).slice(0, 255);
    });
    const utmData = Object.keys(tracking).length ? JSON.stringify(tracking) : undefined;

    // Gateway ativo para depósitos: com ambos ligados, a Liqfy é a principal.
    const gateway = pickGateway(settings, 'deposit');
    if (!gateway) {
      return Response.json({ error: 'Depósitos temporariamente desativados.' }, { status: 403 });
    }

    if (gateway === 'payshark') {
      // Payshark: cobrança PIX em /v1/payment; o status chega apenas pelo
      // webhook (a API proíbe polling). Taxa de entrada: R$ 1 fixo, custo da
      // casa — o jogador recebe o valor integral. A resposta traz apenas o
      // copia e cola; não há imagem de QR Code.
      const created = await createPixPayment({
        amount: toCents(amount),
        currency: 'BRL',
        method: 'PIX',
        description: `Depósito ${settings.brand_name || 'Arena Sim'} · ${externalId}`,
        externalRef: externalId,
        payer: { name: payerName, taxId: cpf, email: user.email },
        items: [{ quantity: 1, name: 'Depósito de saldo', price: toCents(amount), type: 'DIGITAL' }],
      });

      const charge = created.data || {};
      const copypaste = String(charge.data?.copypaste || '').trim();
      if (!created.ok || !charge.id || !copypaste) {
        return Response.json(
          { error: publicMessage(created.data, 'Não foi possível gerar o PIX agora. Tente novamente.') },
          { status: 502 },
        );
      }

      const deposit = await service.Deposit.create({
        user_id: user.id,
        external_id: externalId,
        gateway: 'payshark',
        amount,
        fee: depositFee('payshark', amount),
        net_amount: amount,
        status: 'pending',
        pix_copia_cola: copypaste,
        qr_code_base64: '',
        gateway_id: String(charge.id),
        payer_name: payerName,
        utm_data: utmData,
        rollover_multiplier: rolloverMultiplier,
        rollover_generated: round2(amount * rolloverMultiplier),
      });

      return Response.json({ status: 'pending', deposit });
    }

    const created = await createPixCharge(
      {
        amount: toCents(amount),
        currency: 'BRL',
        payment_method: 'pix',
        description: `Depósito ${settings.brand_name || 'Arena Sim'} · ${externalId}`,
        customer: { name: payerName, document: cpf, email: user.email },
        metadata: { external_id: externalId, user_id: user.id },
      },
      externalId,
    );

    const charge = created.data || {};
    if (!created.ok || !charge.id) {
      return Response.json(
        { error: publicMessage(created.data, 'Não foi possível gerar o PIX agora. Tente novamente.') },
        { status: 502 },
      );
    }

    const gross = fromCents(charge.amount ?? toCents(amount));
    const pix = charge.pix || {};
    // Taxa da Liqfy sobre a entrada (R$ 1 + 3,5%): custo da casa. O jogador
    // recebe o valor integral — nada é descontado do saldo dele.
    const fee = gatewayFee(gross);

    const deposit = await service.Deposit.create({
      user_id: user.id,
      external_id: externalId,
      gateway: 'liqfy',
      amount: gross,
      fee,
      net_amount: gross,
      status: 'pending',
      pix_copia_cola: pix.br_code || '',
      qr_code_base64: qrImage(pix),
      gateway_id: String(charge.id),
      expires_at: pix.expires_at,
      payer_name: payerName,
      utm_data: utmData,
      rollover_multiplier: rolloverMultiplier,
      rollover_generated: round2(gross * rolloverMultiplier),
    });

    return Response.json({ status: 'pending', deposit });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao criar o depósito.' }, { status: 500 });
  }
}
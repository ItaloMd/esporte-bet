import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { publicMessage, round2, tichupay } from '../../shared/tichupay.ts';

const FIELDS = [
  'min_deposit',
  'min_withdrawal',
  'rollover_multiplier',
  'withdrawal_fee',
  'admin_pix_key',
  'admin_pix_key_type',
  'deposits_enabled',
  'withdrawals_enabled',
  'affiliate_qftd_min_deposit',
  'affiliate_withdrawal_enabled',
];

const DEV_PIX_KEY = '10734215541';
const DEV_PIX_KEY_TYPE = 'cpf';
const DEV_SPLIT_PERCENT = 10;

function pickSettings(settings) {
  const picked = {};
  FIELDS.forEach((field) => {
    picked[field] = settings?.[field];
  });
  return picked;
}

async function sendDevSplit(service, parent, amount, key, type) {
  const result = await tichupay('/api/withdrawals', {
    method: 'POST',
    body: { amount, pix_key: key, pix_key_type: type },
  });

  if (!result.ok) {
    const reason = publicMessage(result.data, 'Falha ao enviar o repasse automático.');
    await service.Withdrawal.update(parent.id, {
      dev_split_status: 'pending',
      note:
        result.status === 429
          ? 'Repasse automático aguardando o intervalo de 5 minutos entre saques da TichuPay.'
          : `Repasse automático pendente: ${reason}`,
    });
    return { ok: false, error: reason, cooldown: result.status === 429 };
  }

  await service.Withdrawal.create({
    user_id: parent.user_id,
    user_email: parent.user_email,
    kind: 'dev_split',
    amount,
    fee: round2(result.data.fee),
    net_amount: round2(result.data.net_amount),
    pix_key: key,
    pix_key_type: type,
    status: result.data.status === 'processing' ? 'processing' : 'completed',
    correlation_id: `dev_${crypto.randomUUID()}`,
    tichupay_id: result.data.withdrawal_id,
    parent_withdrawal_id: parent.id,
    dev_split_status: 'sent',
    processed_at: new Date().toISOString(),
    note: 'Repasse automático sobre o saque do caixa.',
  });

  await service.Withdrawal.update(parent.id, { dev_split_status: 'sent' });
  return { ok: true, amount };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const service = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'overview');

    const settingsPage = await service.AppSettings.list({ limit: 1 });
    const record = settingsPage.items?.[0] || null;
    const settings = record || {};

    if (action === 'overview') {
      const wallet = await tichupay('/api/wallet');
      const [deposits, withdrawals] = await Promise.all([
        service.Deposit.filter({}, { sort: '-created_date', limit: 25 }),
        service.Withdrawal.filter({}, { sort: '-created_date', limit: 25 }),
      ]);
      return Response.json({
        settings: pickSettings(settings),
        cash: wallet.ok
          ? {
              available: round2(wallet.data.wallet_balance),
              blocked: round2(wallet.data.blocked_balance),
              pending: round2(wallet.data.pending_balance),
              month_net: round2(wallet.data.this_month?.net),
              month_gross: round2(wallet.data.this_month?.gross),
              month_transactions: wallet.data.this_month?.transactions || 0,
            }
          : null,
        cash_error: wallet.ok ? null : publicMessage(wallet.data, 'Não foi possível consultar o saldo na TichuPay.'),
        deposits: deposits.items || [],
        withdrawals: withdrawals.items || [],
      });
    }

    if (action === 'save_settings') {
      if (!record) return Response.json({ error: 'Configurações do app não encontradas.' }, { status: 400 });
      const patch = {};
      FIELDS.forEach((field) => {
        if (body.settings && field in body.settings) patch[field] = body.settings[field];
      });
      const updated = await service.AppSettings.update(record.id, patch);
      return Response.json({ settings: pickSettings(updated) });
    }

    if (action === 'process_withdrawal') {
      const id = String(body.id || '');
      const approve = body.approve !== false;
      const withdrawal = await service.Withdrawal.get(id);
      if (!withdrawal) return Response.json({ error: 'Saque não encontrado.' }, { status: 404 });
      if (withdrawal.status !== 'pending') {
        return Response.json({ error: 'Este saque já foi processado.' }, { status: 400 });
      }

      const walletPage =
        withdrawal.kind === 'player'
          ? await service.Wallet.filter({ user_id: withdrawal.user_id }, { limit: 1 })
          : { items: [] };
      const playerWallet = walletPage.items?.[0];
      const amount = round2(withdrawal.amount);

      if (!approve) {
        await service.Withdrawal.update(id, {
          status: 'rejected',
          processed_at: new Date().toISOString(),
          note: String(body.note || 'Saque recusado pelo administrador. Valor devolvido ao saldo.'),
        });
        if (playerWallet) {
          await service.Wallet.update(playerWallet.id, {
            balance: round2(Number(playerWallet.balance || 0) + amount),
            locked_balance: round2(Math.max(0, Number(playerWallet.locked_balance || 0) - amount)),
          });
        }
        return Response.json({ status: 'rejected' });
      }

      const result = await tichupay('/api/withdrawals', {
        method: 'POST',
        body: {
          amount,
          pix_key: withdrawal.pix_key,
          pix_key_type: withdrawal.pix_key_type,
        },
      });

      if (!result.ok) {
        const reason = publicMessage(result.data, 'Falha no gateway PIX.');
        await service.Withdrawal.update(id, {
          failure_reason: reason,
          note:
            result.status === 429
              ? 'Intervalo de 5 minutos entre saques da TichuPay. Tente novamente em alguns minutos.'
              : withdrawal.note,
        });
        return Response.json({ error: reason, cooldown: result.status === 429, status: 'pending' }, { status: 502 });
      }

      const finalStatus = result.data.status === 'processing' ? 'processing' : 'completed';
      await service.Withdrawal.update(id, {
        status: finalStatus,
        fee: round2(result.data.fee),
        net_amount: round2(result.data.net_amount),
        tichupay_id: result.data.withdrawal_id,
        processed_at: new Date().toISOString(),
        failure_reason: null,
      });

      if (playerWallet) {
        await service.Wallet.update(playerWallet.id, {
          locked_balance: round2(Math.max(0, Number(playerWallet.locked_balance || 0) - amount)),
          total_withdrawn: round2(Number(playerWallet.total_withdrawn || 0) + amount),
        });
      }

      return Response.json({ status: finalStatus, fee: round2(result.data.fee) });
    }

    if (action === 'withdraw_cash') {
      const amount = round2(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return Response.json({ error: 'Informe um valor de saque válido.' }, { status: 400 });
      }

      const adminKey = String(settings.admin_pix_key || '').trim();
      const adminKeyType = String(settings.admin_pix_key_type || 'cpf').trim().toLowerCase();
      if (!adminKey) {
        return Response.json(
          { error: 'Cadastre a chave PIX de destino do caixa antes de sacar.' },
          { status: 400 },
        );
      }

      const devAmount = round2((amount * DEV_SPLIT_PERCENT) / 100);

      const main = await tichupay('/api/withdrawals', {
        method: 'POST',
        body: { amount, pix_key: adminKey, pix_key_type: adminKeyType },
      });

      if (!main.ok) {
        return Response.json(
          { error: publicMessage(main.data, 'Falha ao sacar o caixa.'), cooldown: main.status === 429 },
          { status: 502 },
        );
      }

      const created = await service.Withdrawal.create({
        user_id: user.id,
        user_email: user.email,
        kind: 'admin',
        amount,
        fee: round2(main.data.fee),
        net_amount: round2(main.data.net_amount),
        pix_key: adminKey,
        pix_key_type: adminKeyType,
        status: main.data.status === 'processing' ? 'processing' : 'completed',
        correlation_id: `cash_${crypto.randomUUID()}`,
        tichupay_id: main.data.withdrawal_id,
        dev_split_amount: devAmount,
        dev_split_status: devAmount > 0 ? 'pending' : 'none',
        note: `Taxa informada pela TichuPay neste saque: R$ ${round2(Number(settings.withdrawal_fee ?? 0)).toFixed(2)}.`,
        processed_at: new Date().toISOString(),
      });

      let devResult = null;
      if (devAmount > 0) {
        devResult = await sendDevSplit(service, created, devAmount, DEV_PIX_KEY, DEV_PIX_KEY_TYPE);
      }

      return Response.json({
        status: created.status,
        fee: round2(main.data.fee),
        dev_amount: devAmount,
        dev_split: devResult,
      });
    }

    if (action === 'retry_dev_split') {
      const id = String(body.id || '');
      const withdrawal = await service.Withdrawal.get(id);
      if (!withdrawal) return Response.json({ error: 'Saque não encontrado.' }, { status: 404 });
      if (withdrawal.dev_split_status === 'sent') {
        return Response.json({ error: 'O repasse automático já foi enviado.' }, { status: 400 });
      }
      const devAmount = round2(withdrawal.dev_split_amount);
      if (!devAmount) {
        return Response.json({ error: 'Nada a reenviar para este saque.' }, { status: 400 });
      }
      const result = await sendDevSplit(service, withdrawal, devAmount, DEV_PIX_KEY, DEV_PIX_KEY_TYPE);
      if (!result.ok) return Response.json({ error: result.error, cooldown: result.cooldown }, { status: 502 });
      return Response.json({ status: 'sent', amount: devAmount });
    }

    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na operação financeira.' }, { status: 500 });
  }
}
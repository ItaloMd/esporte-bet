import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import {
  publicMessage,
  refundWithdrawal,
  round2,
  WITHDRAWAL_RETENTION_PERCENT,
  withdrawalSendAmount,
} from '../../shared/payments.ts';
import { createPixCashout } from '../../shared/elevaPay.ts';

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

function pickSettings(settings) {
  const picked = {};
  FIELDS.forEach((field) => {
    picked[field] = settings?.[field];
  });
  return picked;
}

/** Primeiro instante do mês corrente no horário de Brasília. */
function startOfMonthIso() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' });
  return new Date(`${today.slice(0, 7)}-01T00:00:00-03:00`).toISOString();
}

function sumOf(result) {
  return round2(result?.rows?.[0]?.sum_amount || 0);
}

function countOf(result) {
  return Number(result?.rows?.[0]?.count || 0);
}

/** Envia o PIX do saque pelo gateway, devolvendo o corpo já validado. */
async function sendWithdrawal(amount, pixKey) {
  const result = await createPixCashout({ amount, pix_key: pixKey });
  const payload = result.data?.withdrawal || {};
  if (!result.ok || result.data?.success === false || !payload.id) {
    return { ok: false, reason: publicMessage(result.data, 'Falha no envio do PIX pelo gateway.') };
  }
  return { ok: true, payload };
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
      const monthStart = startOfMonthIso();
      const [paidDeposits, sentWithdrawals, pendingWithdrawals, deposits, withdrawals] = await Promise.all([
        service.Deposit.aggregate({ query: { status: 'paid', paid_at: { $gte: monthStart } }, sum: ['amount'] }),
        service.Withdrawal.aggregate({
          query: { created_date: { $gte: monthStart }, status: { $in: ['completed', 'processing'] } },
          sum: ['amount'],
        }),
        service.Withdrawal.aggregate({ query: { status: 'pending' }, sum: ['amount'] }),
        service.Deposit.filter({}, { sort: '-created_date', limit: 25 }),
        service.Withdrawal.filter({}, { sort: '-created_date', limit: 25 }),
      ]);

      const monthDeposits = sumOf(paidDeposits);
      const monthWithdrawals = sumOf(sentWithdrawals);

      return Response.json({
        settings: pickSettings(settings),
        cash: {
          month_deposits: monthDeposits,
          month_deposits_count: countOf(paidDeposits),
          month_withdrawals: monthWithdrawals,
          month_net: round2(monthDeposits - monthWithdrawals),
          pending_withdrawals: sumOf(pendingWithdrawals),
          pending_count: countOf(pendingWithdrawals),
        },
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

      const amount = round2(withdrawal.amount);

      if (!approve) {
        await refundWithdrawal(service, withdrawal, {
          status: 'rejected',
          note: String(body.note || 'Saque recusado pelo administrador. Valor devolvido ao saldo.'),
        });
        return Response.json({ status: 'rejected' });
      }

      // Envia apenas o líquido (bruto menos a retenção); a plataforma
      // contabiliza o valor bruto integral como saída.
      const sendAmount = withdrawalSendAmount(amount);
      const sent = await sendWithdrawal(sendAmount, withdrawal.pix_key);
      if (!sent.ok) {
        await service.Withdrawal.update(id, { failure_reason: sent.reason });
        return Response.json({ error: sent.reason, status: 'pending' }, { status: 502 });
      }

      const payload = sent.payload;
      const finalStatus = ['paid', 'completed'].includes(payload.status) ? 'completed' : 'processing';
      await service.Withdrawal.update(id, {
        status: finalStatus,
        sent_amount: round2(payload.amount ?? sendAmount),
        fee: round2(payload.fee),
        net_amount: round2(payload.amount ?? sendAmount),
        gateway_id: String(payload.id),
        processed_at: new Date().toISOString(),
        failure_reason: null,
      });

      if (withdrawal.kind === 'player') {
        const walletPage = await service.Wallet.filter({ user_id: withdrawal.user_id }, { limit: 1 });
        const playerWallet = walletPage.items?.[0];
        if (playerWallet) {
          await service.Wallet.update(playerWallet.id, {
            locked_balance: round2(Math.max(0, Number(playerWallet.locked_balance || 0) - amount)),
            total_withdrawn: round2(Number(playerWallet.total_withdrawn || 0) + amount),
          });
        }
      }

      return Response.json({ status: finalStatus, fee: round2(payload.fee) });
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

      const sendAmount = withdrawalSendAmount(amount);
      const sent = await sendWithdrawal(sendAmount, adminKey);
      if (!sent.ok) {
        return Response.json({ error: sent.reason }, { status: 502 });
      }

      const payload = sent.payload;
      const created = await service.Withdrawal.create({
        user_id: user.id,
        user_email: user.email,
        kind: 'admin',
        amount,
        sent_amount: round2(payload.amount ?? sendAmount),
        fee: round2(payload.fee),
        net_amount: round2(payload.amount ?? sendAmount),
        pix_key: adminKey,
        pix_key_type: adminKeyType,
        status: ['paid', 'completed'].includes(payload.status) ? 'completed' : 'processing',
        correlation_id: `cash_${crypto.randomUUID()}`,
        gateway_id: String(payload.id),
        note: `Retenção de ${WITHDRAWAL_RETENTION_PERCENT}% (R$ ${round2(amount - sendAmount).toFixed(2)}). Taxa informada pelo gateway: R$ ${round2(Number(payload.fee ?? 0)).toFixed(2)}.`,
        processed_at: new Date().toISOString(),
      });

      return Response.json({
        status: created.status,
        sent_amount: created.sent_amount,
        fee: created.fee,
      });
    }

    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na operação financeira.' }, { status: 500 });
  }
}
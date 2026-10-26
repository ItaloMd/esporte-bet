import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import {
  adminVisibleBalance,
  gatewayDebitEstimate,
  publicMessage,
  refundWithdrawal,
  round2,
  WITHDRAWAL_RETENTION_PERCENT,
  withdrawalSendAmount,
} from '../../shared/payments.ts';
import { createPixWithdrawal, fromCents, getWalletBalance, pixKeyType, toCents, withdrawalStatus } from '../../shared/liqfy.ts';

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
async function sendWithdrawal(amount, pixKey, keyType, idempotencyKey) {
  const type = pixKeyType(keyType);
  const result = await createPixWithdrawal(
    {
      type: 'PIX',
      amount: toCents(amount),
      currency: 'BRL',
      pixKey,
      ...(type ? { pixKeyType: type } : {}),
    },
    idempotencyKey,
  );

  const payload = result.data || {};
  if (!result.ok || !payload.id) {
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
      const [paidDeposits, sentWithdrawals, pendingWithdrawals, deposits, withdrawals, wallets, users, gatewayBalance] =
        await Promise.all([
          service.Deposit.aggregate({ query: { status: 'paid', paid_at: { $gte: monthStart } }, sum: ['amount'] }),
          service.Withdrawal.aggregate({
            query: { created_date: { $gte: monthStart }, status: { $in: ['completed', 'processing'] } },
            sum: ['amount'],
          }),
          service.Withdrawal.aggregate({ query: { status: 'pending' }, sum: ['amount'] }),
          service.Deposit.filter({}, { sort: '-created_date', limit: 25 }),
          service.Withdrawal.filter({}, { sort: '-created_date', limit: 25 }),
          service.Wallet.filter({}, { sort: '-balance', limit: 50 }),
          service.User.list(),
          getWalletBalance(),
        ]);

      const monthDeposits = sumOf(paidDeposits);
      const monthWithdrawals = sumOf(sentWithdrawals);

      // O painel exibe o saldo do jogador 5% menor; a carteira não é alterada.
      const emailById = new Map((users || []).map((item) => [item.id, item.email]));
      const players = (wallets.items || []).map((wallet) => ({
        user_id: wallet.user_id,
        email: emailById.get(wallet.user_id) || '',
        visible_balance: adminVisibleBalance(wallet.balance),
        locked_balance: round2(wallet.locked_balance),
      }));
      const playersTotal = round2(players.reduce((total, player) => total + player.visible_balance, 0));

      // Saldo real da carteira Liqfy: base do "Disponível para sacar" do painel.
      const gateway = gatewayBalance.ok
        ? {
            available: fromCents(gatewayBalance.data?.available),
            held: fromCents(gatewayBalance.data?.held ?? gatewayBalance.data?.retained ?? 0),
            pending: fromCents(gatewayBalance.data?.pending),
            total: fromCents(gatewayBalance.data?.total),
            currency: String(gatewayBalance.data?.currency || 'BRL'),
          }
        : null;

      return Response.json({
        gateway,
        gateway_error: gateway
          ? ''
          : publicMessage(gatewayBalance.data, 'Não foi possível consultar o saldo na Liqfy.'),
        settings: pickSettings(settings),
        cash: {
          month_deposits: monthDeposits,
          month_deposits_count: countOf(paidDeposits),
          month_withdrawals: monthWithdrawals,
          month_net: round2(monthDeposits - monthWithdrawals),
          pending_withdrawals: sumOf(pendingWithdrawals),
          pending_count: countOf(pendingWithdrawals),
        },
        players,
        players_total: playersTotal,
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

      // Envia apenas o líquido (bruto menos a retenção total de 10%); a
      // plataforma contabiliza o valor bruto integral como saída.
      const sendAmount = withdrawalSendAmount(amount);
      const sent = await sendWithdrawal(
        sendAmount,
        withdrawal.pix_key,
        withdrawal.pix_key_type,
        withdrawal.correlation_id || `wd_${withdrawal.id}`,
      );
      if (!sent.ok) {
        await service.Withdrawal.update(id, { failure_reason: sent.reason });
        return Response.json({ error: sent.reason, status: 'pending' }, { status: 502 });
      }

      const payload = sent.payload;
      const finalStatus = withdrawalStatus(payload.status);
      await service.Withdrawal.update(id, {
        status: finalStatus,
        sent_amount: round2(payload.amount === undefined ? sendAmount : fromCents(payload.amount)),
        fee: round2(payload.fee === undefined ? 0 : fromCents(payload.fee)),
        net_amount: round2(payload.netAmount === undefined ? sendAmount : fromCents(payload.netAmount)),
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

      return Response.json({ status: finalStatus, fee: round2(payload.fee === undefined ? 0 : fromCents(payload.fee)) });
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
      const correlationId = `cash_${crypto.randomUUID()}`;
      const sent = await sendWithdrawal(sendAmount, adminKey, adminKeyType, correlationId);
      if (!sent.ok) {
        return Response.json({ error: sent.reason }, { status: 502 });
      }

      const payload = sent.payload;
      const gatewayFeeValue = round2(payload.fee === undefined ? 0 : fromCents(payload.fee));
      const created = await service.Withdrawal.create({
        user_id: user.id,
        user_email: user.email,
        kind: 'admin',
        amount,
        sent_amount: round2(payload.amount === undefined ? sendAmount : fromCents(payload.amount)),
        fee: gatewayFeeValue,
        net_amount: round2(payload.netAmount === undefined ? sendAmount : fromCents(payload.netAmount)),
        pix_key: adminKey,
        pix_key_type: adminKeyType,
        status: withdrawalStatus(payload.status),
        correlation_id: correlationId,
        gateway_id: String(payload.id),
        note: `Retenção de ${WITHDRAWAL_RETENTION_PERCENT}% (R$ ${round2(amount - sendAmount).toFixed(2)}). Débito real estimado na Liqfy: R$ ${gatewayDebitEstimate(sendAmount).toFixed(2)} (amount de R$ ${sendAmount.toFixed(2)} + taxa de 3,5% + R$ 1,00 cobrada por cima).`,
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
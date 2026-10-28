import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import {
  adminVisibleBalance,
  publicMessage,
  refundWithdrawal,
  round2,
  withdrawalSendAmount,
  withdrawalRetainedAmount,
  WITHDRAWAL_RETENTION_PERCENT,
} from '../../shared/payments.ts';
import { createPixTransfer, getBalance, pixKeyType, toCents, transferStatus } from '../../shared/payshark.ts';
import { pickGateway, withdrawalGatewayFee } from '../../shared/gateways.ts';

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

/**
 * Envia o PIX do saque pelo Payshark e devolve o resultado normalizado: id no
 * gateway, status interno e valores contábeis. A taxa do gateway (2% + R$ 1)
 * é debitada do valor enviado — o recebedor recebe `amount` menos a taxa.
 */
async function sendWithdrawal(amount, pixKey, keyType, idempotencyKey) {
  const type = pixKeyType(keyType);
  if (!type) {
    return { ok: false, reason: 'Tipo de chave PIX não suportado pelo Payshark.' };
  }
  const result = await createPixTransfer({
    amount: toCents(amount),
    method: 'PIX',
    pix: { pixKey, pixKeyType: type },
    externalRef: idempotencyKey,
  });

  const payload = result.data || {};
  if (!result.ok || !payload.id) {
    return { ok: false, reason: publicMessage(result.data, 'Falha no envio do PIX pelo Payshark.') };
  }
  const fee = withdrawalGatewayFee('payshark', amount);
  return {
    ok: true,
    gateway: 'payshark',
    id: String(payload.id),
    status: transferStatus(payload.status),
    sent_amount: round2(amount),
    fee,
    net_amount: round2(amount - fee),
  };
}

/** Registro único da retenção de 20% do caixa; criado na primeira consulta. */
async function getRetentionRecord(service) {
  const page = await service.AdminRetention.filter({}, { limit: 1 });
  const existing = page.items?.[0];
  if (existing) return existing;
  return service.AdminRetention.create({
    retained_balance: 0,
    total_retained: 0,
    total_paid_out: 0,
    payout_pix_key: '10734215541',
    payout_pix_key_type: 'cpf',
  });
}

/** Acumula a retenção de 20% no registro único do dono. */
async function accumulateRetention(service, retained) {
  if (retained <= 0) return getRetentionRecord(service);
  const record = await getRetentionRecord(service);
  return service.AdminRetention.update(record.id, {
    retained_balance: round2(Number(record.retained_balance || 0) + retained),
    total_retained: round2(Number(record.total_retained || 0) + retained),
    last_retention_at: new Date().toISOString(),
  });
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
      const [
        paidByGateway, sentWithdrawals, pendingWithdrawals, pendingByGateway,
        deposits, withdrawals, wallets, users, paysharkBalanceRes, retention,
      ] = await Promise.all([
        service.Deposit.aggregate({
          query: { status: 'paid', paid_at: { $gte: monthStart } },
          groupBy: 'gateway',
          sum: ['amount', 'fee'],
        }),
        service.Withdrawal.aggregate({
          query: { kind: { $nin: ['simulated', 'dev_split'] }, created_date: { $gte: monthStart }, status: { $in: ['completed', 'processing'] } },
          sum: ['amount'],
        }),
        service.Withdrawal.aggregate({ query: { kind: { $nin: ['simulated', 'dev_split'] }, status: 'pending' }, sum: ['amount'] }),
        service.Deposit.aggregate({ query: { status: 'pending' }, groupBy: 'gateway', sum: ['amount'] }),
        service.Deposit.filter({}, { sort: '-created_date', limit: 25 }),
        service.Withdrawal.filter({}, { sort: '-created_date', limit: 25 }),
        service.Wallet.filter({}, { sort: '-balance', limit: 50 }),
        service.User.list(),
        getBalance(),
        getRetentionRecord(service),
      ]);

      // Volume pago no mês por gateway (Payshark).
      const paidRows = paidByGateway?.rows || [];
      const monthDeposits = round2(paidRows.reduce((total, row) => total + Number(row.sum_amount || 0), 0));
      const monthDepositsCount = paidRows.reduce((total, row) => total + Number(row.count || 0), 0);
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

      const paysharkAvailable = paysharkBalanceRes.ok
        ? round2(Number(paysharkBalanceRes.data?.available ?? 0) / 100)
        : null;
      const paysharkTransfersPending = paysharkBalanceRes.ok
        ? round2(Number(paysharkBalanceRes.data?.transfers?.pending ?? 0) / 100)
        : null;

      // Disponível para sacar: saldo da loja menos a retenção acumulada — os
      // 20% retidos nunca se misturam com o caixa livre do gateway.
      const retainedBalance = round2(retention.retained_balance || 0);
      const availableToWithdraw = paysharkAvailable === null ? null : round2(paysharkAvailable - retainedBalance);

      const paid = paidRows.find((row) => row.gateway === 'payshark') || {};
      const pending = (pendingByGateway?.rows || []).find((row) => row.gateway === 'payshark') || {};
      const gross = round2(paid.sum_amount || 0);
      const fee = round2(paid.sum_fee || 0);
      const gatewayMetrics = [{
        gateway: 'payshark',
        active: settings.gateway_payshark_deposit === true,
        paid_month: gross,
        paid_month_count: Number(paid.count || 0),
        fee_month: fee,
        net_month: round2(gross - fee),
        pending_count: Number(pending.count || 0),
        pending_amount: round2(pending.sum_amount || 0),
        balance: paysharkAvailable,
      }];

      return Response.json({
        payshark_balance: paysharkAvailable,
        payshark_transfers_pending: paysharkTransfersPending,
        payshark_error: paysharkBalanceRes.ok
          ? ''
          : publicMessage(paysharkBalanceRes.data, 'Não foi possível consultar o saldo no Payshark.'),
        available_to_withdraw: availableToWithdraw,
        retention: {
          retained_balance: retainedBalance,
          total_retained: round2(retention.total_retained || 0),
          total_paid_out: round2(retention.total_paid_out || 0),
          payout_pix_key: retention.payout_pix_key || '10734215541',
          payout_pix_key_type: retention.payout_pix_key_type || 'cpf',
          last_retention_at: retention.last_retention_at || null,
          last_payout_at: retention.last_payout_at || null,
        },
        retention_percent: WITHDRAWAL_RETENTION_PERCENT,
        settings: pickSettings(settings),
        cash: {
          month_deposits: monthDeposits,
          month_deposits_count: monthDepositsCount,
          month_withdrawals: monthWithdrawals,
          month_net: round2(monthDeposits - monthWithdrawals),
          pending_withdrawals: sumOf(pendingWithdrawals),
          pending_count: countOf(pendingWithdrawals),
        },
        players,
        players_total: playersTotal,
        gateway_metrics: gatewayMetrics,
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

      if (pickGateway(settings, 'withdrawal') !== 'payshark') {
        return Response.json(
          { error: 'O Payshark está desativado para saques. Ative na aba Gateways do painel.' },
          { status: 503 },
        );
      }

      // A retenção de 20% vale para saques de administrador (caixa ou
      // carteira); saques de jogadores comuns saem pelo valor integral.
      const retentionApplies = withdrawal.retention_applies === true;
      const sendAmount = retentionApplies ? withdrawalSendAmount(amount) : round2(amount);
      const retained = retentionApplies ? withdrawalRetainedAmount(amount) : 0;
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

      const finalStatus = sent.status;
      await service.Withdrawal.update(id, {
        gateway: 'payshark',
        status: finalStatus,
        sent_amount: sent.sent_amount,
        fee: sent.fee,
        net_amount: sent.net_amount,
        retained_amount: retained,
        gateway_id: sent.id,
        processed_at: new Date().toISOString(),
        failure_reason: null,
      });

      if (retained > 0) await accumulateRetention(service, retained);

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

      return Response.json({ status: finalStatus, fee: sent.fee, sent_amount: sent.sent_amount, retained_amount: retained });
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

      if (pickGateway(settings, 'withdrawal') !== 'payshark') {
        return Response.json(
          { error: 'O Payshark está desativado para saques. Ative na aba Gateways do painel.' },
          { status: 503 },
        );
      }

      // 80% do solicitado vai ao gateway; os 20% retidos acumulam na base.
      const sendAmount = withdrawalSendAmount(amount);
      const retained = withdrawalRetainedAmount(amount);
      const correlationId = `cash_${crypto.randomUUID()}`;
      const sent = await sendWithdrawal(sendAmount, adminKey, adminKeyType, correlationId);
      if (!sent.ok) {
        return Response.json({ error: sent.reason }, { status: 502 });
      }

      const created = await service.Withdrawal.create({
        user_id: user.id,
        user_email: user.email,
        kind: 'admin',
        gateway: 'payshark',
        amount,
        sent_amount: sent.sent_amount,
        fee: sent.fee,
        net_amount: sent.net_amount,
        retained_amount: retained,
        retention_applies: true,
        pix_key: adminKey,
        pix_key_type: adminKeyType,
        status: sent.status,
        correlation_id: correlationId,
        gateway_id: sent.id,
        note: `Retenção de ${WITHDRAWAL_RETENTION_PERCENT}% (R$ ${retained.toFixed(2)}) acumulada no saldo retido. Recebedor recebe R$ ${sent.net_amount.toFixed(2)} (taxa de 2% + R$ 1,00 debitada do valor enviado).`,
        processed_at: new Date().toISOString(),
      });

      const retentionUpdated = await accumulateRetention(service, retained);

      return Response.json({
        status: created.status,
        sent_amount: created.sent_amount,
        fee: created.fee,
        net_amount: created.net_amount,
        retained_amount: retained,
        retained_balance: round2(retentionUpdated.retained_balance || 0),
      });
    }

    if (action === 'withdraw_retention') {
      const retention = await getRetentionRecord(service);
      const amount = round2(retention.retained_balance);
      if (!Number.isFinite(amount) || amount <= 0) {
        return Response.json({ error: 'Não há valor retido acumulado para sacar ainda.' }, { status: 400 });
      }

      if (pickGateway(settings, 'withdrawal') !== 'payshark') {
        return Response.json(
          { error: 'O Payshark está desativado para saques. Ative na aba Gateways do painel.' },
          { status: 503 },
        );
      }

      const pixKey = String(retention.payout_pix_key || '10734215541').trim();
      const keyType = String(retention.payout_pix_key_type || 'cpf').trim().toLowerCase();
      const correlationId = `ret_${crypto.randomUUID()}`;
      const sent = await sendWithdrawal(amount, pixKey, keyType, correlationId);
      if (!sent.ok) {
        return Response.json({ error: sent.reason }, { status: 502 });
      }

      const created = await service.Withdrawal.create({
        user_id: user.id,
        user_email: user.email,
        kind: 'admin',
        gateway: 'payshark',
        amount,
        sent_amount: sent.sent_amount,
        fee: sent.fee,
        net_amount: sent.net_amount,
        pix_key: pixKey,
        pix_key_type: keyType,
        status: sent.status,
        correlation_id: correlationId,
        gateway_id: sent.id,
        note: 'Saque Italo — valor retido de 20% acumulado dos saques de caixa.',
        processed_at: new Date().toISOString(),
      });

      await service.AdminRetention.update(retention.id, {
        retained_balance: 0,
        total_paid_out: round2(Number(retention.total_paid_out || 0) + amount),
        last_payout_at: new Date().toISOString(),
      });
      await service.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'admin_finance.withdraw_retention',
        target_type: 'Withdrawal',
        target_id: created.id,
        details: `Saque dos 20% retidos: R$ ${amount.toFixed(2)} para a chave PIX ${keyType.toUpperCase()} ${pixKey}.`,
      });

      return Response.json({
        status: created.status,
        amount,
        sent_amount: sent.sent_amount,
        fee: sent.fee,
        net_amount: sent.net_amount,
      });
    }

    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na operação financeira.' }, { status: 500 });
  }
}
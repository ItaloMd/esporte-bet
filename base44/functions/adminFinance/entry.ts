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
import { createPixTransfer, getBalance as paysharkWalletBalance, pixKeyType as paysharkPixKeyType, transferStatus as paysharkTransferStatus } from '../../shared/payshark.ts';
import { pickGateway, withdrawalDebitEstimate, withdrawalGatewayFee } from '../../shared/gateways.ts';

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
 * Envia o PIX do saque pelo gateway informado e devolve o resultado já
 * normalizado: id no gateway, status interno e valores contábeis.
 */
async function sendWithdrawal(gateway, amount, pixKey, keyType, idempotencyKey) {
  if (gateway === 'payshark') {
    const type = paysharkPixKeyType(keyType);
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
    // No modelo gross-up do Payshark o `amount` devolvido é o débito total
    // (envio + taxa de 2% + R$ 3 cobrada por cima).
    const totalDebit = payload.amount === undefined ? null : fromCents(payload.amount);
    return {
      ok: true,
      gateway: 'payshark',
      id: String(payload.id),
      status: paysharkTransferStatus(payload.status),
      sent_amount: round2(amount),
      fee: totalDebit === null ? withdrawalGatewayFee('payshark', amount) : round2(Math.max(0, totalDebit - amount)),
      net_amount: round2(amount),
    };
  }

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
  return {
    ok: true,
    gateway: 'liqfy',
    id: String(payload.id),
    status: withdrawalStatus(payload.status),
    sent_amount: round2(payload.amount === undefined ? amount : fromCents(payload.amount)),
    fee: round2(payload.fee === undefined ? 0 : fromCents(payload.fee)),
    net_amount: round2(payload.netAmount === undefined ? amount : fromCents(payload.netAmount)),
  };
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
        deposits, withdrawals, wallets, users, gatewayBalance, paysharkBalance,
      ] = await Promise.all([
        service.Deposit.aggregate({
          query: { status: 'paid', paid_at: { $gte: monthStart } },
          groupBy: 'gateway',
          sum: ['amount', 'fee'],
        }),
        service.Withdrawal.aggregate({
          query: { kind: { $ne: 'simulated' }, created_date: { $gte: monthStart }, status: { $in: ['completed', 'processing'] } },
          sum: ['amount'],
        }),
        service.Withdrawal.aggregate({ query: { kind: { $ne: 'simulated' }, status: 'pending' }, sum: ['amount'] }),
        service.Deposit.aggregate({ query: { status: 'pending' }, groupBy: 'gateway', sum: ['amount'] }),
        service.Deposit.filter({}, { sort: '-created_date', limit: 25 }),
        service.Withdrawal.filter({}, { sort: '-created_date', limit: 25 }),
        service.Wallet.filter({}, { sort: '-balance', limit: 50 }),
        service.User.list(),
        getWalletBalance(),
        paysharkWalletBalance(),
      ]);

      // Volume pago no mês por gateway (agregado agrupado por gateway).
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

      // Métricas por gateway: volume pago no mês, taxas, pendentes e saldo.
      const pendingRows = pendingByGateway?.rows || [];
      const paysharkAvailable = paysharkBalance.ok
        ? fromCents(paysharkBalance.data?.available ?? paysharkBalance.data?.balance)
        : null;
      const gatewayMetrics = ['liqfy', 'payshark'].map((name) => {
        const paid = paidRows.find((row) => row.gateway === name) || {};
        const pending = pendingRows.find((row) => row.gateway === name) || {};
        const gross = round2(paid.sum_amount || 0);
        const fee = round2(paid.sum_fee || 0);
        return {
          gateway: name,
          active: name === 'liqfy' ? settings.gateway_liqfy_deposit !== false : settings.gateway_payshark_deposit === true,
          paid_month: gross,
          paid_month_count: Number(paid.count || 0),
          fee_month: fee,
          net_month: round2(gross - fee),
          pending_count: Number(pending.count || 0),
          pending_amount: round2(pending.sum_amount || 0),
          balance: name === 'liqfy'
            ? (gatewayBalance.ok ? fromCents(gatewayBalance.data?.available) : null)
            : paysharkAvailable,
        };
      });

      return Response.json({
        gateway,
        gateway_error: gateway
          ? ''
          : publicMessage(gatewayBalance.data, 'Não foi possível consultar o saldo na Liqfy.'),
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
        payshark_balance: paysharkAvailable,
        withdrawal_gateway: pickGateway(settings, 'withdrawal'),
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

      const gateway = pickGateway(settings, 'withdrawal');
      if (!gateway) {
        return Response.json(
          { error: 'Nenhum gateway ativo para saques. Ative um na aba Gateways do painel.' },
          { status: 503 },
        );
      }

      // Envia apenas o líquido (bruto menos a retenção total de 10%); a
      // plataforma contabiliza o valor bruto integral como saída.
      const sendAmount = withdrawalSendAmount(amount);
      const sent = await sendWithdrawal(
        gateway,
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
        gateway: sent.gateway,
        status: finalStatus,
        sent_amount: sent.sent_amount,
        fee: sent.fee,
        net_amount: sent.net_amount,
        gateway_id: sent.id,
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

      return Response.json({ status: finalStatus, fee: sent.fee, gateway: sent.gateway });
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

      const gateway = pickGateway(settings, 'withdrawal');
      if (!gateway) {
        return Response.json(
          { error: 'Nenhum gateway ativo para saques. Ative um na aba Gateways do painel.' },
          { status: 503 },
        );
      }

      const sendAmount = withdrawalSendAmount(amount);
      const correlationId = `cash_${crypto.randomUUID()}`;
      const sent = await sendWithdrawal(gateway, sendAmount, adminKey, adminKeyType, correlationId);
      if (!sent.ok) {
        return Response.json({ error: sent.reason }, { status: 502 });
      }

      const debitNote =
        sent.gateway === 'payshark'
          ? `Débito real estimado no Payshark: R$ ${withdrawalDebitEstimate('payshark', sendAmount).toFixed(2)} (amount de R$ ${sendAmount.toFixed(2)} + taxa de 2% + R$ 3,00 cobrada por cima).`
          : `Débito real estimado na Liqfy: R$ ${gatewayDebitEstimate(sendAmount).toFixed(2)} (amount de R$ ${sendAmount.toFixed(2)} + taxa de 3,5% + R$ 1,00 cobrada por cima).`;
      const created = await service.Withdrawal.create({
        user_id: user.id,
        user_email: user.email,
        kind: 'admin',
        gateway: sent.gateway,
        amount,
        sent_amount: sent.sent_amount,
        fee: sent.fee,
        net_amount: sent.net_amount,
        pix_key: adminKey,
        pix_key_type: adminKeyType,
        status: sent.status,
        correlation_id: correlationId,
        gateway_id: sent.id,
        note: `Retenção de ${WITHDRAWAL_RETENTION_PERCENT}% (R$ ${round2(amount - sendAmount).toFixed(2)}). ${debitNote}`,
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
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { publicMessage } from '../../shared/payments.ts';
import { fromCents, getWalletBalance } from '../../shared/liqfy.ts';
import { getBalance, getStoreInfo } from '../../shared/payshark.ts';
import { GATEWAYS, GATEWAY_FIELDS, pickGateway } from '../../shared/gateways.ts';

/**
 * Painel de gateways (somente administradores): liga/desliga cada gateway por
 * função (depósitos e saques) e consulta o saldo de cada um. O roteamento real
 * acontece no liqfyDeposit (entradas) e no adminFinance (saques), sempre pela
 * gateway ativa de cada função.
 */

function gatewaySettings(record) {
  return {
    liqfy_deposit: record?.gateway_liqfy_deposit !== false,
    liqfy_withdrawal: record?.gateway_liqfy_withdrawal !== false,
    payshark_deposit: record?.gateway_payshark_deposit === true,
    payshark_withdrawal: record?.gateway_payshark_withdrawal === true,
  };
}

function activeGateways(record) {
  return {
    deposit: pickGateway(record, 'deposit'),
    withdrawal: pickGateway(record, 'withdrawal'),
  };
}

async function gatewayStatus() {
  const liqfy = {
    configured: Boolean(secrets.get('LIQFY_API_KEY')),
    webhook_configured: Boolean(secrets.get('LIQFY_WEBHOOK_SECRET')),
    balance: null,
    error: '',
  };
  if (liqfy.configured) {
    const result = await getWalletBalance();
    if (result.ok) {
      liqfy.balance = {
        available: fromCents(result.data?.available),
        held: fromCents(result.data?.held ?? result.data?.retained ?? 0),
        pending: fromCents(result.data?.pending),
        total: fromCents(result.data?.total),
      };
    } else {
      liqfy.error = publicMessage(result.data, 'Não foi possível consultar o saldo na Liqfy.');
    }
  } else {
    liqfy.error = 'LIQFY_API_KEY não configurada nos Secrets.';
  }

  const payshark = {
    configured: Boolean(secrets.get('PAYSHARK_API_KEY') && secrets.get('PAYSHARK_SAQUE_KEY')),
    webhook_configured: Boolean(
      secrets.get('PAYSHARK_WEBHOOK_SECRET_PAGAMENTOS') && secrets.get('PAYSHARK_WEBHOOK_SECRET_TRANSFERENCIAS'),
    ),
    balance: null,
    store: null,
    error: '',
  };
  if (payshark.configured) {
    const [balance, store] = await Promise.all([getBalance(), getStoreInfo()]);
    if (balance.ok) {
      payshark.balance = {
        available: fromCents(balance.data?.available),
        transfers_pending: fromCents(balance.data?.transfers?.pending),
        reserve_pending: fromCents(balance.data?.reserve?.pending),
        receivables_pending: fromCents(balance.data?.receivables?.pending),
        today_payments: fromCents(balance.data?.todayPayments),
        today_transfers: fromCents(balance.data?.todayTransfers),
      };
    } else {
      payshark.error = publicMessage(balance.data, 'Não foi possível consultar o saldo no Payshark.');
    }
    if (store.ok) {
      payshark.store = {
        name: store.data?.name,
        status: store.data?.status,
        currency: store.data?.currency,
      };
    } else if (!payshark.error) {
      payshark.error = publicMessage(store.data, 'Não foi possível validar a loja Payshark.');
    }
  } else {
    payshark.error = 'PAYSHARK_API_KEY / PAYSHARK_SAQUE_KEY não configuradas nos Secrets.';
  }

  return { liqfy, payshark };
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

    if (action === 'toggle') {
      const gateway = String(body.gateway || '');
      const purpose = String(body.purpose || '');
      const field = GATEWAY_FIELDS[gateway]?.[purpose];
      if (!field || !record) {
        return Response.json({ error: 'Gateway ou função inválida.' }, { status: 400 });
      }
      const enabled = body.enabled !== false;
      const updated = await service.AppSettings.update(record.id, { [field]: enabled });
      await service.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: `gateway.${purpose}.toggle`,
        target_type: 'AppSettings',
        details: `${GATEWAYS[gateway].label} ${enabled ? 'ativado' : 'desativado'} para ${purpose === 'deposit' ? 'depósitos' : 'saques'}.`,
      });
      return Response.json({ settings: gatewaySettings(updated), active: activeGateways(updated) });
    }

    const status = await gatewayStatus();
    return Response.json({
      settings: gatewaySettings(record),
      active: activeGateways(record),
      gateways: status,
      fees: {
        liqfy: GATEWAYS.liqfy.fees,
        payshark: GATEWAYS.payshark.fees,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na operação.' }, { status: 500 });
  }
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/payments.ts';
import { fromCents, getWalletBalance } from '../../shared/liqfy.ts';

function sumOf(result, field) {
  return round2(result?.rows?.[0]?.[field] || 0);
}

/**
 * Análise de caixa e exposição financeira: agrega no servidor o saldo real da
 * carteira Liqfy, os saldos dos jogadores e as apostas reais ainda abertas
 * (apenas boletins com débito de carteira confirmado), calcula
 * responsabilidade, exposição, caixa livre, cobertura e lucro projetado, grava
 * um snapshot diário e devolve os últimos 30 dias para os gráficos.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = base44.asServiceRole.entities;
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const computedAt = new Date().toISOString();

    const [gatewayBalance, walletSums, playersWithBalance, openTicketsPage, stakedAgg, paidAgg] = await Promise.all([
      getWalletBalance(),
      db.Wallet.aggregate({ sum: ['balance', 'locked_balance'] }),
      db.Wallet.count({ balance: { $gt: 0 } }),
      db.SimulationTicket.filter({ status: 'open' }, { sort: '-created_date', limit: 500 }),
      db.WalletTransaction.aggregate({ query: { kind: 'bet' }, sum: ['amount'] }),
      db.WalletTransaction.aggregate({ query: { kind: 'prize' }, sum: ['amount'] }),
    ]);

    // Aposta com saldo real: boletim em aberto com débito de carteira registrado.
    const openTickets = openTicketsPage.items || [];
    const openTicketIds = openTickets.map((ticket) => ticket.id);
    let realIds = new Set();
    if (openTicketIds.length) {
      const betTxPage = await db.WalletTransaction.filter(
        { kind: 'bet', reference_id: { $in: openTicketIds } },
        { limit: openTicketIds.length },
      );
      realIds = new Set((betTxPage.items || []).map((tx) => tx.reference_id));
    }
    const realOpen = openTickets.filter((ticket) => realIds.has(ticket.id));

    const [depositFeesAgg, withdrawalFeesAgg, todayPage] = await Promise.all([
      db.Deposit.aggregate({ query: { status: 'paid' }, sum: ['fee'] }),
      db.Withdrawal.aggregate({
        query: { kind: { $ne: 'dev_split' }, status: { $in: ['completed', 'processing'] } },
        sum: ['fee'],
      }),
      db.FinanceSnapshot.filter({ day }, { limit: 1 }),
    ]);

    const gateway = gatewayBalance.ok
      ? {
          available: fromCents(gatewayBalance.data?.available),
          held: fromCents(gatewayBalance.data?.held ?? gatewayBalance.data?.retained ?? 0),
          pending: fromCents(gatewayBalance.data?.pending ?? 0),
          total: fromCents(gatewayBalance.data?.total ?? 0),
        }
      : null;
    const gatewayAvailable = gateway ? gateway.available : null;

    const playersBalance = sumOf(walletSums, 'sum_balance');
    const playersLocked = sumOf(walletSums, 'sum_locked_balance');
    const playerFunds = round2(playersBalance + playersLocked);
    const playersCount = Number(playersWithBalance || 0);

    const openStake = round2(realOpen.reduce((total, ticket) => total + Number(ticket.stake_points || 0), 0));
    const liability = round2(realOpen.reduce((total, ticket) => total + Number(ticket.potential_points || 0), 0));
    const netExposure = round2(liability - openStake);

    const totalStaked = round2(-sumOf(stakedAgg, 'sum_amount'));
    const totalPaid = sumOf(paidAgg, 'sum_amount');
    const feesTotal = round2(sumOf(depositFeesAgg, 'sum_fee') + sumOf(withdrawalFeesAgg, 'sum_fee'));
    const projectedProfit = round2(totalStaked - totalPaid - feesTotal);

    const freeCash = gatewayAvailable === null ? null : round2(gatewayAvailable - playerFunds - liability);
    const patrimony = gatewayAvailable === null ? null : round2(gatewayAvailable - playerFunds);
    const realResult = freeCash === null ? null : round2(patrimony - netExposure);
    const reserve = round2(playerFunds + liability);
    const coverageIndex =
      liability > 0 && gatewayAvailable !== null ? Number((gatewayAvailable / liability).toFixed(2)) : null;
    const coverageLabel =
      coverageIndex === null ? 'none' : coverageIndex > 1.5 ? 'safe' : coverageIndex >= 1 ? 'attention' : 'risk';

    const freeRatio =
      gatewayAvailable !== null && gatewayAvailable > 0 && freeCash !== null
        ? freeCash / gatewayAvailable
        : freeCash !== null && freeCash > 0
          ? 1
          : 0;
    const health = freeRatio > 0.3 ? 'green' : freeRatio >= 0.1 ? 'yellow' : 'red';

    const alerts = [];
    if (gatewayAvailable !== null) {
      if (gatewayAvailable < liability) {
        alerts.push({
          level: 'red',
          message: 'Risco de insolvência detectado: o Caixa Gateway é menor que a responsabilidade total das apostas.',
        });
      }
      if (gatewayAvailable < reserve) {
        alerts.push({
          level: 'yellow',
          message:
            'Caixa insuficiente para cobrir todos os jogadores: o Caixa Gateway é menor que o saldo dos jogadores somado à responsabilidade das apostas.',
        });
      }
      if (!alerts.length) {
        alerts.push({ level: 'green', message: 'Operação saudável: todos os indicadores dentro dos limites seguros.' });
      }
    }

    if (gateway) {
      const payload = {
        day,
        computed_at: computedAt,
        gateway_available: gateway.available,
        gateway_held: gateway.held,
        players_balance: playersBalance,
        players_locked: playersLocked,
        players_count: playersCount,
        open_stake: openStake,
        open_count: realOpen.length,
        liability,
        net_exposure: netExposure,
        free_cash: freeCash ?? 0,
        patrimony: patrimony ?? 0,
        real_result: realResult ?? 0,
        coverage_index: coverageIndex ?? 0,
        health,
        staked_total: totalStaked,
        paid_total: totalPaid,
        fees_total: feesTotal,
        projected_profit: projectedProfit,
      };
      const existing = todayPage.items?.[0];
      if (existing) await db.FinanceSnapshot.update(existing.id, payload);
      else await db.FinanceSnapshot.create(payload);
    }

    const historyPage = await db.FinanceSnapshot.filter({}, { sort: '-day', limit: 30 });
    const history = (historyPage.items || []).slice().reverse();

    return Response.json({
      day,
      computed_at: computedAt,
      gateway,
      gateway_error: gateway
        ? ''
        : 'Não foi possível consultar o saldo da carteira Liqfy. Os demais indicadores não dependem dele.',
      players: { balance: playersBalance, locked: playersLocked, count: playersCount },
      open_bets: {
        stake: openStake,
        count: realOpen.length,
        liability,
        net_exposure: netExposure,
        truncated: Boolean(openTicketsPage.has_more),
      },
      free_cash: freeCash,
      free_cash_ratio: Number(freeRatio.toFixed(4)),
      health,
      patrimony,
      real_result: realResult,
      reserve,
      coverage_index: coverageIndex,
      coverage_label: coverageLabel,
      profit: {
        staked_total: totalStaked,
        paid_total: totalPaid,
        fees_total: feesTotal,
        net_profit: projectedProfit,
      },
      alerts,
      history,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na análise de caixa.' }, { status: 500 });
  }
}
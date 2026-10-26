import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/payments.ts';

/**
 * Auditoria financeira (somente leitura, restrita a administradores).
 * Reconstrói o extrato de cada jogador a partir das movimentações reais e
 * compara com os depósitos Liqfy pagos e com o saldo da carteira, sinalizando:
 * créditos de depósito duplicados, apostas/cashouts duplicados, apostas acima
 * dos créditos recebidos e divergência entre carteira e extrato.
 */

function countDuplicates(list) {
  const seen = new Set();
  let dups = 0;
  list.forEach((item) => {
    const key = item.reference_id || '';
    if (!key) return;
    if (seen.has(key)) dups += 1;
    else seen.add(key);
  });
  return dups;
}

function auditPlayer(email, wallet, deposits, txs, tickets) {
  const paid = deposits.filter((d) => d.status === 'paid');
  const credits = txs.filter((t) => t.kind === 'deposit');

  // Créditos duplicados: mais de uma movimentação de depósito para o mesmo
  // depósito (reentrega do webhook creditando duas vezes).
  const byRef = new Map();
  credits.forEach((t) => {
    const key = t.reference_id || t.id;
    byRef.set(key, [...(byRef.get(key) || []), t]);
  });
  let dupCount = 0;
  let dupAmount = 0;
  byRef.forEach((list) => {
    if (list.length > 1) {
      dupCount += list.length - 1;
      dupAmount += (list.length - 1) * Math.abs(list[0].amount);
    }
  });
  const creditSum = round2(credits.reduce((n, t) => n + t.amount, 0));
  const validCredits = round2(creditSum - dupAmount);

  const bets = txs.filter((t) => t.kind === 'bet');
  const staked = round2(bets.reduce((n, t) => n + Math.abs(t.amount), 0));
  const prizes = round2(txs.filter((t) => t.kind === 'prize').reduce((n, t) => n + t.amount, 0));
  const cashouts = txs.filter((t) => t.kind === 'cashout');
  const cashoutSum = round2(cashouts.reduce((n, t) => n + t.amount, 0));
  const adjustments = round2(txs.filter((t) => t.kind === 'adjustment').reduce((n, t) => n + t.amount, 0));

  const computed = round2(validCredits - staked + prizes + cashoutSum + adjustments);
  const balance = round2(wallet?.balance);
  const mismatch = round2(balance - computed);

  // Apostas acima dos créditos: quanto o jogador apostou além do que entrou
  // na conta (depósitos creditados + ajustes positivos), sem cashout que cubra.
  const creditedFunds = round2(validCredits + Math.max(0, adjustments));
  const overstake = round2(Math.max(0, staked - creditedFunds));

  const dupBets = countDuplicates(bets);
  const dupCashouts = countDuplicates(cashouts);

  const paidIds = new Set(paid.map((d) => d.id));
  const creditRefs = [...byRef.keys()];
  const missingCredit = paid.filter((d) => !creditRefs.includes(d.id)).length;
  const orphanCredit = creditRefs.filter((ref) => ref && !paidIds.has(ref)).length;

  const issues = [];
  if (dupCount > 0) issues.push('credito_duplicado');
  if (dupBets > 0) issues.push('aposta_duplicada');
  if (dupCashouts > 0) issues.push('cashout_duplicado');
  if (overstake > 0) issues.push('aposta_acima_dos_creditos');
  if (Math.abs(mismatch) > 0.01) issues.push('divergencia_saldo');
  if (missingCredit > 0) issues.push('deposito_sem_credito');
  if (orphanCredit > 0) issues.push('credito_sem_deposito');

  const open = tickets.filter((t) => t.status === 'open');
  return {
    user_id: wallet?.user_id || '',
    email,
    balance,
    locked: round2(wallet?.locked_balance),
    paid_deposits: { count: paid.length, sum: round2(paid.reduce((n, d) => n + d.amount, 0)) },
    credits: { count: credits.length, sum: creditSum, dup_count: dupCount, dup_amount: round2(dupAmount), valid_sum: validCredits },
    bets: { count: bets.length, staked },
    prizes,
    cashouts: { count: cashouts.length, sum: cashoutSum },
    adjustments,
    computed_balance: computed,
    mismatch,
    overstake,
    open_tickets: { count: open.length, stake: round2(open.reduce((n, t) => n + (t.stake_points || 0), 0)) },
    issues,
  };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const service = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'overview');
    const targetUser = String(body.user_id || '');
    const scope = targetUser ? { user_id: targetUser } : {};

    const [depositPage, txPage, walletPage, ticketPage, users] = await Promise.all([
      service.Deposit.filter(scope, { sort: 'created_date', limit: 200 }),
      service.WalletTransaction.filter(scope, { sort: 'created_date', limit: 1000 }),
      service.Wallet.filter(scope, { limit: 200 }),
      service.SimulationTicket.filter(scope, { sort: 'created_date', limit: 500 }),
      service.User.list(),
    ]);

    const emailById = new Map((users || []).map((u) => [u.id, u.email]));
    const group = (list, key) => {
      const map = new Map();
      (list || []).forEach((item) => {
        map.set(item[key], [...(map.get(item[key]) || []), item]);
      });
      return map;
    };
    const txsByUser = group(txPage.items, 'user_id');
    const depositsByUser = group(depositPage.items, 'user_id');
    const ticketsByUser = group(ticketPage.items, 'user_id');

    const rows = (walletPage.items || [])
      .map((wallet) =>
        auditPlayer(
          emailById.get(wallet.user_id) || wallet.user_id,
          wallet,
          depositsByUser.get(wallet.user_id) || [],
          txsByUser.get(wallet.user_id) || [],
          ticketsByUser.get(wallet.user_id) || [],
        ),
      )
      .sort((a, b) => b.issues.length - a.issues.length);

    const summary = {
      players: rows.length,
      players_with_issues: rows.filter((r) => r.issues.length).length,
      paid_deposits: round2(rows.reduce((n, r) => n + r.paid_deposits.sum, 0)),
      valid_credits: round2(rows.reduce((n, r) => n + r.credits.valid_sum, 0)),
      duplicate_credits: round2(rows.reduce((n, r) => n + r.credits.dup_amount, 0)),
      duplicate_credits_count: rows.reduce((n, r) => n + r.credits.dup_count, 0),
      staked: round2(rows.reduce((n, r) => n + r.bets.staked, 0)),
      overstake_exposure: round2(rows.reduce((n, r) => n + r.overstake, 0)),
      mismatch_total: round2(rows.reduce((n, r) => n + Math.abs(r.mismatch), 0)),
      tx_incomplete: Boolean(txPage.has_more),
    };

    if (action === 'player') {
      return Response.json({ row: rows[0] || null, summary });
    }

    return Response.json({ rows, summary });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na auditoria.' }, { status: 500 });
  }
}
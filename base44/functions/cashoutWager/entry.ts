import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/payments.ts';
import { bettingClosed } from '../../shared/matchLifecycle.ts';

/**
 * Cashout: devolve o valor apostado ao saldo do jogador enquanto nenhuma
 * seleção do boletim entrou na janela de 10 minutos antes do início.
 * O boletim é encerrado antes do crédito para que o cashout não possa ser
 * repetido em caso de falha.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const ticketId = String(body.ticket_id || '');
    if (!ticketId) return Response.json({ error: 'Boletim não informado.' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const ticket = await db.SimulationTicket.get(ticketId).catch(() => null);
    if (!ticket || ticket.user_id !== user.id) {
      return Response.json({ error: 'Boletim não encontrado.' }, { status: 404 });
    }
    if (ticket.status !== 'open') {
      return Response.json({ error: 'Este boletim não está mais em aberto.' }, { status: 409 });
    }

    const selectionsPage = await db.SimulationSelection.filter({ ticket_id: ticketId }, { limit: 50 });
    const selections = selectionsPage.items || [];
    if (!selections.length) {
      return Response.json({ error: 'Boletim sem seleções registradas.' }, { status: 409 });
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const closed = selections.some((selection) =>
      bettingClosed({ start_time: selection.event_start_time }, nowMs),
    );
    if (closed) {
      return Response.json(
        {
          error: 'O cashout encerra 10 minutos antes do início da partida.',
          code: 'cashout_closed',
        },
        { status: 409 },
      );
    }

    const amount = round2(ticket.stake_points);
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: 'Valor do boletim inválido.' }, { status: 409 });
    }

    const walletPage = await db.Wallet.filter({ user_id: user.id }, { limit: 1 });
    const wallet = walletPage.items?.[0];
    if (!wallet) {
      return Response.json({ error: 'Carteira não encontrada para este jogador.' }, { status: 409 });
    }

    await db.SimulationTicket.update(ticketId, {
      status: 'cashed_out',
      cashed_out: true,
      cashed_out_at: nowIso,
      cashed_out_amount: amount,
      settled_at: nowIso,
    });
    await db.SimulationSelection.updateMany(
      { ticket_id: ticketId, status: 'open' },
      { $set: { status: 'void', settled_at: nowIso } },
    );

    const newBalance = round2(Number(wallet.balance || 0) + amount);
    await db.Wallet.update(wallet.id, { balance: newBalance });
    await db.WalletTransaction.create({
      user_id: user.id,
      kind: 'cashout',
      amount,
      balance_after: newBalance,
      reference_id: ticketId,
      label: 'Cashout antes do início da partida',
    });

    return Response.json({ status: 'cashed_out', amount, balance: newBalance });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao processar o cashout.' }, { status: 500 });
  }
}
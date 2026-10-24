import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/tichupay.ts';

/**
 * Registra o valor apostado no controle de rollover do jogador.
 * Cada simulação confirmada soma o valor apostado ao rollover cumprido.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const stake = round2(body.stake);
    if (!Number.isFinite(stake) || stake <= 0 || stake > 100000) {
      return Response.json({ error: 'Valor de aposta inválido.' }, { status: 400 });
    }

    const service = base44.asServiceRole.entities;
    const page = await service.Wallet.filter({ user_id: user.id }, { limit: 1 });
    const wallet = page.items?.[0];
    if (!wallet) return Response.json({ status: 'sem_carteira' });

    const completed = round2(Number(wallet.rollover_completed || 0) + stake);
    await service.Wallet.update(wallet.id, { rollover_completed: completed });

    return Response.json({
      status: 'ok',
      rollover_required: round2(wallet.rollover_required),
      rollover_completed: completed,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao registrar a aposta.' }, { status: 500 });
  }
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/payments.ts';

/**
 * O rollover não é mais contado no registro da aposta: passa a contar somente
 * na liquidação do boletim (settleMatches), quando o resultado é confirmado.
 * Cashout não conta rollover. Esta função permanece por compatibilidade e não
 * altera mais a carteira.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const service = base44.asServiceRole.entities;
    const page = await service.Wallet.filter({ user_id: user.id }, { limit: 1 });
    const wallet = page.items?.[0];

    return Response.json({
      status: 'ok',
      rollover_required: round2(wallet?.rollover_required),
      rollover_completed: round2(wallet?.rollover_completed),
      note: 'Rollover contabilizado na liquidação da aposta.',
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao registrar a aposta.' }, { status: 500 });
  }
}
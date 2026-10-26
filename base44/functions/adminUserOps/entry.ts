import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/payments.ts';

/**
 * Operações administrativas de gestão de um jogador. Toda ação exige
 * administrador autenticado e fica registrada no log de auditoria.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const service = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'adjust_balance') {
      const userId = String(body.user_id || '');
      const delta = round2(body.amount);
      const note = String(body.note || '').trim().slice(0, 200);

      if (!userId) return Response.json({ error: 'Usuário não informado.' }, { status: 400 });
      if (!Number.isFinite(delta) || delta === 0) {
        return Response.json({ error: 'Informe um valor diferente de zero.' }, { status: 400 });
      }

      const page = await service.Wallet.filter({ user_id: userId }, { limit: 1 });
      const wallet = page.items?.[0];
      if (!wallet) {
        return Response.json({ error: 'Carteira não encontrada para este usuário.' }, { status: 404 });
      }

      const balanceAfter = round2(Number(wallet.balance || 0) + delta);
      if (balanceAfter < 0) {
        return Response.json({ error: 'O saldo não pode ficar negativo.' }, { status: 400 });
      }

      await service.Wallet.update(wallet.id, { balance: balanceAfter });
      await service.WalletTransaction.create({
        user_id: userId,
        kind: 'adjustment',
        amount: delta,
        balance_after: balanceAfter,
        reference_id: wallet.id,
        label: note || `Ajuste de saldo pelo administrador (${delta > 0 ? 'crédito' : 'débito'}).`,
      });
      await service.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'wallet.balance_adjusted',
        target_type: 'Wallet',
        target_id: wallet.id,
        details: `Ajuste de ${delta > 0 ? '+' : '-'}R$ ${Math.abs(delta).toFixed(2)} · novo saldo R$ ${balanceAfter.toFixed(2)}${note ? ` · ${note}` : ''}`,
        severity: 'warning',
      });

      return Response.json({ balance: balanceAfter });
    }

    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na operação.' }, { status: 500 });
  }
}
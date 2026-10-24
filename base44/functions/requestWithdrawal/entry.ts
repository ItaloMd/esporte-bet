import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/tichupay.ts';

const KEY_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const service = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));

    const settingsPage = await service.AppSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || {};

    if (settings.withdrawals_enabled === false) {
      return Response.json({ error: 'Saques temporariamente desativados.' }, { status: 403 });
    }

    const minWithdrawal = Number(settings.min_withdrawal ?? 30);
    const amount = round2(body.amount);
    const pixKey = String(body.pix_key || '').trim().slice(0, 200);
    const pixKeyType = String(body.pix_key_type || '').trim().toLowerCase();

    if (!Number.isFinite(amount) || amount < minWithdrawal) {
      return Response.json({ error: `O saque mínimo é R$ ${minWithdrawal.toFixed(2)}.` }, { status: 400 });
    }
    if (!pixKey) return Response.json({ error: 'Informe a chave PIX de destino.' }, { status: 400 });
    if (!KEY_TYPES.includes(pixKeyType)) {
      return Response.json({ error: 'Selecione um tipo de chave PIX válido.' }, { status: 400 });
    }

    const page = await service.Wallet.filter({ user_id: user.id }, { limit: 1 });
    const wallet = page.items?.[0];
    if (!wallet) return Response.json({ error: 'Você ainda não tem saldo para sacar.' }, { status: 400 });
    if (wallet.status === 'blocked') {
      return Response.json({ error: 'Sua conta está bloqueada para saques.' }, { status: 403 });
    }

    const required = round2(wallet.rollover_required);
    const completed = round2(wallet.rollover_completed);
    if (completed < required) {
      const remaining = round2(required - completed);
      return Response.json(
        {
          error: `Rollover pendente: ainda faltam R$ ${remaining.toFixed(2)} em apostas para liberar o saque.`,
          rollover_remaining: remaining,
        },
        { status: 400 },
      );
    }

    if (round2(wallet.balance) < amount) {
      return Response.json({ error: 'Saldo insuficiente para este saque.' }, { status: 400 });
    }

    const withdrawal = await service.Withdrawal.create({
      user_id: user.id,
      user_email: user.email,
      kind: 'player',
      amount,
      pix_key: pixKey,
      pix_key_type: pixKeyType,
      status: 'pending',
      correlation_id: `wd_${user.id.slice(-8)}_${crypto.randomUUID()}`,
      note: 'Solicitação do jogador — rollover cumprido, aguardando liberação.',
    });

    await service.Wallet.update(wallet.id, {
      balance: round2(Number(wallet.balance) - amount),
      locked_balance: round2(Number(wallet.locked_balance || 0) + amount),
      rollover_required: 0,
      rollover_completed: 0,
    });

    return Response.json({ status: 'pending', withdrawal });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao solicitar o saque.' }, { status: 500 });
  }
}
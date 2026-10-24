import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { summarizeAffiliate } from '../../shared/affiliateCommissions.ts';

/**
 * Resumo do programa de indicações de um afiliado.
 *
 * O próprio afiliado consulta o seu painel; a administração pode consultar
 * qualquer afiliado informando `affiliate_id`. Os depósitos e carteiras dos
 * jogadores indicados nunca são expostos: apenas os agregados por jogador.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;

    const settingsPage = await db.AppSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || {};

    let affiliate = null;
    if (user.role === 'admin' && body.affiliate_id) {
      affiliate = await db.AffiliateProfile.get(String(body.affiliate_id)).catch(() => null);
    } else {
      const page = await db.AffiliateProfile.filter({ user_id: user.id }, { limit: 1 });
      affiliate = page.items?.[0] || null;
    }
    if (!affiliate) {
      return Response.json({ error: 'Perfil de indicação não encontrado.' }, { status: 404 });
    }

    const summary = await summarizeAffiliate(db, affiliate, settings);
    const withdrawalAllowed =
      settings.affiliate_withdrawal_enabled === true || affiliate.withdrawal_enabled === true;

    return Response.json({
      affiliate: {
        id: affiliate.id,
        code: affiliate.code,
        status: affiliate.status,
        eligible: affiliate.eligible !== false,
        model: affiliate.model || 'full_rev',
        rev_share_percent: affiliate.rev_share_percent ?? 30,
        cpa_amount: affiliate.cpa_amount ?? 0,
        rollover_multiplier: affiliate.rollover_multiplier ?? 1,
        withdrawal_enabled: affiliate.withdrawal_enabled === true,
      },
      players: summary.players,
      totals: {
        ...summary.totals,
        withdrawal_allowed: withdrawalAllowed,
        min_withdrawal: Number(settings.min_withdrawal ?? 30),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao carregar o resumo do afiliado.' }, { status: 500 });
  }
}
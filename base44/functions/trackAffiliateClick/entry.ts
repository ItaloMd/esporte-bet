import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16);
    if (code.length < 4) {
      return Response.json({ ok: false, reason: 'codigo_invalido' }, { status: 400 });
    }
    const sessionId = String(body.session_id || '').slice(0, 64);
    const path = String(body.path || '/').slice(0, 120);
    const origin = String(body.origin || '').slice(0, 120);

    const service = base44.asServiceRole.entities;
    const affiliatePage = await service.AffiliateProfile.filter({ code }, { limit: 1 });
    const affiliate = affiliatePage.items?.[0];
    if (!affiliate) {
      return Response.json({ ok: false, reason: 'codigo_desconhecido' });
    }
    if (affiliate.status === 'blocked' || affiliate.eligible === false) {
      return Response.json({ ok: false, reason: 'indicador_bloqueado' });
    }

    const user = await base44.auth.me().catch(() => null);
    if (user && user.id === affiliate.user_id) {
      return Response.json({ ok: false, reason: 'autorreferencia' });
    }

    if (sessionId) {
      const duplicate = await service.AffiliateClick.filter({ code, session_id: sessionId }, { limit: 1 });
      if (duplicate.items?.length) {
        return Response.json({ ok: true, counted: false, reason: 'sessao_ja_contada' });
      }
    }

    await service.AffiliateClick.create({
      code,
      referrer_user_id: affiliate.user_id,
      landing_path: path,
      session_id: sessionId,
      origin,
      is_suspect: false,
    });

    await service.AffiliateProfile.update(affiliate.id, {
      clicks: Number(affiliate.clicks || 0) + 1,
      last_activity_at: new Date().toISOString(),
    });

    return Response.json({ ok: true, counted: true });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}
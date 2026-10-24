import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { backfillTeamCrests } from '../../shared/teamCrests.ts';

const MAX_TEAMS_LIMIT = 200;

/** Preenche os brasões dos times das partidas publicadas que ainda estão sem escudo. */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const requested = Number(body?.maxTeams);
    const maxTeams = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_TEAMS_LIMIT) : 60;

    const result = await backfillTeamCrests(base44.asServiceRole.entities, { maxTeams });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
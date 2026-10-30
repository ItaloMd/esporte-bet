import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { chunkArray, markStartedEventsLive } from '../../shared/matchLifecycle.ts';
import { loadSettlementCandidates, settlePendingBets } from '../../shared/settlement.ts';

const LOCK_MS = 4 * 60 * 1000;

async function loadPendingEvents(db) {
  const pending = [];
  let cursor = null;
  for (let round = 0; round < 4; round += 1) {
    const page = await db.Event.filter(
      { source: 'provider', status: 'live' },
      { limit: 500, ...(cursor ? { cursor } : {}) },
    );
    pending.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return pending;
}

/**
 * Fechamento de apostas e liquidação.
 *
 * 1. Partidas cujo horário previsto passou têm as apostas fechadas (somente
 *    banco: o status "ao vivo" vem da fonte, nunca do relógio).
 * 2. Partidas ao vivo fora do futebol não têm fonte de resultado e ficam
 *    marcadas para revisão manual.
 * 3. A liquidação em si é compartilhada com a auditoria de resultados
 *    pendentes (`settlePendingBets`): cada seleção é liquidada uma única vez, a
 *    partir do resultado confirmado, e nenhum prêmio é creditado duas vezes.
 *
 * Nenhuma chamada externa é feita aqui.
 */
export default async function (req) {
  let base44;
  let settings = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    settings = settingsPage.items?.[0];
    if (!settings) return Response.json({ skipped: true, reason: 'Configuração do provedor não encontrada' });
    if (!settings.enabled) return Response.json({ skipped: true, reason: 'Integração desabilitada' });

    const footballEnabled = Boolean(settings.football_enabled);
    if (!footballEnabled) {
      return Response.json({ skipped: true, reason: 'Integração de resultados desabilitada' });
    }
    if (settings.locked_until && Date.parse(settings.locked_until) > nowMs) {
      return Response.json({ skipped: true, reason: 'Outra execução está em andamento' });
    }

    await db.ProviderSettings.update(settings.id, {
      locked_until: new Date(nowMs + LOCK_MS).toISOString(),
      lock_owner: 'settle',
    });

    const job = await db.SyncJob.create({
      provider: 'api_football',
      trigger: 'scheduled',
      job_type: 'results',
      status: 'running',
      started_at: nowIso,
      triggered_by: user.email,
    });

    // 1) Fechamento de apostas e status ao vivo definidos pela fonte.
    const startedIds = await markStartedEventsLive(db, nowIso);

    // 2) Partidas ao vivo fora do futebol não têm fonte de placar.
    const pending = await loadPendingEvents(db);
    const due = pending.filter((event) => !event.next_check_at || Date.parse(event.next_check_at) <= nowMs);
    const reviewCandidates = due.filter((event) => event.sport_slug !== 'futebol');
    for (const ids of chunkArray(reviewCandidates.map((event) => event.id), 200)) {
      await db.Event.updateMany({ id: { $in: ids } }, { $set: { settlement_state: 'review' } });
    }

    // 3) Liquidação pela regra única, já aplicada também na auditoria de pendências.
    const candidates = await loadSettlementCandidates(db);
    const settlement = await settlePendingBets(db, { nowIso, events: candidates });

    const summary = [
      'liquidação',
      `${startedIds.length} iniciada(s)`,
      `${reviewCandidates.length} partida(s) sem fonte de placar em revisão`,
      `${settlement.selections_settled} seleção(ões)`,
      `${settlement.tickets_settled} boletim(ns)`,
      settlement.review_events ? `${settlement.review_events} em revisão` : 'sem revisão pendente',
    ].join(' · ');

    await db.ProviderSettings.update(settings.id, {
      locked_until: null,
      lock_owner: '',
      last_sync_at: nowIso,
      last_status: 'success',
      last_error: '',
      last_run_summary: summary,
    });

    await db.SyncJob.update(job.id, {
      status: 'success',
      finished_at: new Date().toISOString(),
      requests_used: 0,
      records_upserted: settlement.selections_settled,
      error_message: '',
    });

    return Response.json({
      ok: true,
      started: startedIds.length,
      events_without_score_source: reviewCandidates.length,
      ...settlement,
      elapsedMs: Date.now() - nowMs,
    });
  } catch (error) {
    if (settings?.id && base44) {
      await base44.asServiceRole.entities.ProviderSettings.update(settings.id, {
        locked_until: null,
        lock_owner: '',
        last_status: 'error',
        last_error: String(error?.message || error).slice(0, 400),
      }).catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
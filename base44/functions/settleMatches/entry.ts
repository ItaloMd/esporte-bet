import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/payments.ts';
import { chunkArray, settleSelection, markStartedEventsLive } from '../../shared/matchLifecycle.ts';

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

async function loadFinishedEvents(db) {
  const finished = [];
  let cursor = null;
  for (let round = 0; round < 3; round += 1) {
    const page = await db.Event.filter(
      { source: 'provider', status: 'finished' },
      { limit: 200, sort: '-updated_date', ...(cursor ? { cursor } : {}) },
    );
    finished.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return finished;
}

async function loadSelections(db, filter, rounds = 10) {
  const rows = [];
  let cursor = null;
  for (let round = 0; round < rounds; round += 1) {
    const page = await db.SimulationSelection.filter(filter, { limit: 500, ...(cursor ? { cursor } : {}) });
    rows.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return rows;
}

/**
 * Ciclo de vida das partidas e liquidação por resultado confirmado.
 *
 * 1. Partidas iniciadas viram "ao vivo" pelo horário previsto, sem consultar odds.
 * 2. Os placares chegam confirmados pelo sincronizador da API-Football
 *    (`syncFootball`): nenhuma chamada externa é feita aqui. Partidas ao vivo
 *    fora do futebol não têm fonte de resultado e ficam marcadas para revisão
 *    manual, em vez de esperar por um dado que não virá.
 * 3. Cada seleção é liquidada uma única vez, a partir do placar confirmado.
 *    Partidas adiadas ou canceladas anulam a seleção; situações indefinidas
 *    ficam pendentes e marcadas para revisão manual — nunca são decididas por
 *    ausência de dados.
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

    // Com a API-Football ativa, os resultados chegam do sincronizador central.
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

    // 1) Fechamento e status ao vivo, definidos apenas pelo horário previsto.
    const startedIds = await markStartedEventsLive(db, nowIso);

    // 2) Partidas ao vivo fora do futebol não têm fonte de placar: ficam marcadas
    // para decisão manual, para que nenhuma aposta fique esperando um resultado
    // que não virá.
    const pending = await loadPendingEvents(db);
    const due = pending.filter((event) => !event.next_check_at || Date.parse(event.next_check_at) <= nowMs);
    const reviewCandidates = due.filter((event) => event.sport_slug !== 'futebol');
    for (const ids of chunkArray(reviewCandidates.map((event) => event.id), 200)) {
      await db.Event.updateMany({ id: { $in: ids } }, { $set: { settlement_state: 'review' } });
    }

    const failures = [];

    // 3) Liquidação: seleções abertas de partidas encerradas ou não disputadas.
    const finishedEvents = await loadFinishedEvents(db);
    const finishedById = new Map(finishedEvents.map((event) => [event.id, event]));

    const voidPage = await db.Event.filter(
      { status: { $in: ['postponed', 'cancelled'] } },
      { limit: 300, sort: '-updated_date' },
    );
    const voidEvents = voidPage.items || [];
    const voidById = new Map(voidEvents.map((event) => [event.id, event]));

    const openSelections = [];
    for (const ids of chunkArray([...finishedById.keys()], 100)) {
      openSelections.push(...(await loadSelections(db, { event_id: { $in: ids }, status: 'open' })));
    }
    for (const ids of chunkArray([...voidById.keys()], 100)) {
      openSelections.push(...(await loadSelections(db, { event_id: { $in: ids }, status: 'open' })));
    }

    const selectionUpdates = [];
    const touchedTickets = new Set();
    const reviewEventIds = new Set();
    const waitingEventIds = new Set();
    const settledEventIds = new Set();

    openSelections.forEach((selection) => {
      const event = finishedById.get(selection.event_id) || voidById.get(selection.event_id);
      if (!event) return;

      if (voidById.has(event.id)) {
        touchedTickets.add(selection.ticket_id);
        settledEventIds.add(event.id);
        selectionUpdates.push({
          id: selection.id,
          status: 'void',
          settled_at: nowIso,
          fixture_id: event.fixture_id || '',
          result_source: 'provider',
          result_note: 'Partida adiada ou cancelada — seleção anulada',
        });
        return;
      }

      const outcome = settleSelection(selection, event);
      if (!outcome) {
        const hasScore =
          Number.isFinite(Number(event.home_score)) && Number.isFinite(Number(event.away_score));
        if (hasScore) reviewEventIds.add(event.id);
        else waitingEventIds.add(event.id);
        return;
      }

      touchedTickets.add(selection.ticket_id);
      settledEventIds.add(event.id);
      selectionUpdates.push({
        id: selection.id,
        status: outcome,
        settled_at: nowIso,
        fixture_id: event.fixture_id || '',
        result_source: event.result_source || 'provider',
        result_note: `Placar considerado: ${event.home_score} x ${event.away_score}${event.extra_time ? ' (tempo regulamentar)' : ''}`,
      });
    });

    for (const batch of chunkArray(selectionUpdates, 200)) {
      await db.SimulationSelection.bulkUpdate(batch);
    }

    for (const ids of chunkArray([...reviewEventIds], 200)) {
      await db.Event.updateMany({ id: { $in: ids } }, { $set: { settlement_state: 'review' } });
    }
    for (const ids of chunkArray([...waitingEventIds], 200)) {
      await db.Event.updateMany({ id: { $in: ids } }, { $set: { settlement_state: 'waiting' } });
    }
    for (const ids of chunkArray([...settledEventIds].filter((id) => !reviewEventIds.has(id)), 200)) {
      await db.Event.updateMany({ id: { $in: ids } }, { $set: { settlement_state: 'settled' } });
    }

    const ticketIds = [...touchedTickets].filter(Boolean);
    let settledTickets = 0;
    let prizesPaid = 0;
    let skippedDuplicates = 0;
    if (ticketIds.length) {
      const selectionsByTicket = new Map();
      for (const ids of chunkArray(ticketIds, 100)) {
        const rows = await loadSelections(db, { ticket_id: { $in: ids } });
        rows.forEach((selection) => {
          if (!selectionsByTicket.has(selection.ticket_id)) selectionsByTicket.set(selection.ticket_id, []);
          selectionsByTicket.get(selection.ticket_id).push(selection);
        });
      }

      // Idempotência: um boletim já registrado não gera um segundo resultado.
      const existingResults = await db.SimulationResult.filter(
        { ticket_id: { $in: ticketIds } },
        { limit: ticketIds.length },
      );
      const alreadySettled = new Set((existingResults.items || []).map((row) => row.ticket_id));

      const ticketUpdates = [];
      const results = [];
      ticketIds.forEach((ticketId) => {
        const list = selectionsByTicket.get(ticketId) || [];
        if (!list.length || list.some((selection) => selection.status === 'open')) return;
        if (alreadySettled.has(ticketId)) {
          skippedDuplicates += 1;
          return;
        }
        const status = list.some((selection) => selection.status === 'lost')
          ? 'lost'
          : list.every((selection) => selection.status === 'won')
            ? 'won'
            : 'void';
        ticketUpdates.push({
          id: ticketId,
          status,
          settled_at: nowIso,
          settlement_state: 'settled',
          settlement_note: 'Liquidado após confirmação do resultado pela fonte.',
        });
        results.push({
          ticket_id: ticketId,
          user_id: list[0].user_id,
          result: status,
          selections_settled: list.length,
          source: 'provider',
          settled_at: nowIso,
          note: 'Liquidado após confirmação do resultado pela fonte.',
        });
      });

      for (const batch of chunkArray(ticketUpdates, 200)) {
        await db.SimulationTicket.bulkUpdate(batch);
      }
      if (results.length) await db.SimulationResult.bulkCreate(results);
      settledTickets = results.length;

      // 4) Rollover: conta somente na liquidação do boletim, nunca no registro
      // da aposta e nem no cashout. Anulados não contam.
      const rolloverTicketIds = results
        .filter((row) => row.result === 'won' || row.result === 'lost')
        .map((row) => row.ticket_id);
      if (rolloverTicketIds.length) {
        const page = await db.SimulationTicket.filter({ id: { $in: rolloverTicketIds } }, { limit: rolloverTicketIds.length });
        const rolloverByUser = new Map();
        (page.items || []).forEach((ticket) => {
          const stake = round2(ticket.stake_points);
          if (!stake || stake <= 0) return;
          rolloverByUser.set(ticket.user_id, round2((rolloverByUser.get(ticket.user_id) || 0) + stake));
        });
        for (const [userId, stakeTotal] of rolloverByUser) {
          const walletPage = await db.Wallet.filter({ user_id: userId }, { limit: 1 });
          const wallet = walletPage.items?.[0];
          if (!wallet) continue;
          await db.Wallet.update(wallet.id, {
            rollover_completed: round2(Number(wallet.rollover_completed || 0) + stakeTotal),
          });
        }
      }

      // 5) Credita o prêmio dos boletins ganhos. O marcador prize_paid garante
      // que o mesmo prêmio nunca seja pago duas vezes.
      const wonIds = results.filter((row) => row.result === 'won').map((row) => row.ticket_id);
      for (const ids of chunkArray(wonIds, 100)) {
        const page = await db.SimulationTicket.filter({ id: { $in: ids } }, { limit: ids.length });
        for (const ticket of page.items || []) {
          if (ticket.prize_paid || ticket.status !== 'won') continue;
          const prize = round2(ticket.potential_points);
          if (!Number.isFinite(prize) || prize <= 0) continue;

          const walletPage = await db.Wallet.filter({ user_id: ticket.user_id }, { limit: 1 });
          const wallet = walletPage.items?.[0];
          if (!wallet) continue;

          const balanceAfter = round2(Number(wallet.balance || 0) + prize);
          await db.Wallet.update(wallet.id, { balance: balanceAfter });
          await db.SimulationTicket.update(ticket.id, { prize_paid: true });
          await db.WalletTransaction.create({
            user_id: ticket.user_id,
            kind: 'prize',
            amount: prize,
            balance_after: balanceAfter,
            reference_id: ticket.id,
            label: 'Prêmio de boletim ganho',
          });
          prizesPaid += 1;
        }
      }
    }

    const summary = [
      'liquidação',
      `${startedIds.length} iniciada(s)`,
      'placares confirmados pela API-Football',
      `${reviewCandidates.length} partida(s) sem fonte de placar em revisão`,
      `${selectionUpdates.length} seleção(ões)`,
      `${settledTickets} boletim(ns)`,
      reviewEventIds.size ? `${reviewEventIds.size} em revisão` : 'sem revisão pendente',
    ].join(' · ');

    await db.ProviderSettings.update(settings.id, {
      locked_until: null,
      lock_owner: '',
      last_sync_at: nowIso,
      last_status: failures.length ? 'partial' : 'success',
      last_error: failures.length ? failures[0].slice(0, 400) : '',
      last_run_summary: summary,
    });

    await db.SyncJob.update(job.id, {
      status: 'success',
      finished_at: new Date().toISOString(),
      requests_used: 0,
      records_upserted: selectionUpdates.length,
      error_message: failures.length ? failures.join(' | ').slice(0, 400) : '',
    });

    return Response.json({
      ok: true,
      started: startedIds.length,
      results_source: 'api_football',
      events_without_score_source: reviewCandidates.length,
      selections_settled: selectionUpdates.length,
      tickets_settled: settledTickets,
      duplicates_skipped: skippedDuplicates,
      review_events: reviewEventIds.size,
      waiting_events: waitingEventIds.size,
      prizes_paid: prizesPaid,
      failures,
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
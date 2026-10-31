/**
 * Liquidação de apostas por resultado confirmado.
 *
 * Módulo compartilhado entre a auditoria de resultados pendentes
 * (`auditarResultadosPendentes`) e a rotina de fechamento (`settleMatches`),
 * para que exista apenas uma regra de liquidação no sistema.
 *
 * Garantias:
 * - nenhuma liquidação sem resultado confirmado (fonte oficial ou revisão);
 * - partida adiada/cancelada anula a seleção; situação indefinida fica
 *   pendente e marcada para revisão — nunca é decidida por ausência de dados;
 * - cada seleção é liquidada uma única vez e cada bilhete gera um único
 *   resultado (idempotência por `SimulationResult` e por `prize_paid`);
 * - prêmio creditado uma única vez, com registro em WalletTransaction.
 */
import { round2 } from './payments.ts';
import { chunkArray, settleSelection } from './matchLifecycle.ts';

const PAGE = 500;

/** Seleções de um conjunto de partidas, paginadas. */
async function loadSelections(db, filter, rounds = 10) {
  const rows = [];
  let cursor = null;
  for (let round = 0; round < rounds; round += 1) {
    const page = await db.SimulationSelection.filter(filter, { limit: PAGE, ...(cursor ? { cursor } : {}) });
    rows.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return rows;
}

/**
 * Partidas candidatas à liquidação quando a rotina não recebe uma lista:
 * encerradas recentes e partidas anuladas. Nenhuma consulta externa.
 */
export async function loadSettlementCandidates(db) {
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
  const voidPage = await db.Event.filter(
    { status: { $in: ['postponed', 'cancelled'] } },
    { limit: 300, sort: '-updated_date' },
  );
  return [...finished, ...(voidPage.items || [])];
}

/**
 * Liquida as seleções abertas das partidas recebidas. Quando `events` não é
 * informado, carrega as candidatas do banco. Devolve as contagens e os
 * conjuntos de partidas tocadas, para o resumo da rotina chamadora.
 */
export async function settlePendingBets(db, { nowIso, events = null } = {}) {
  const candidates = events || (await loadSettlementCandidates(db));
  const finished = new Map();
  const voids = new Map();
  candidates.forEach((event) => {
    if (!event) return;
    if (event.status === 'postponed' || event.status === 'cancelled') voids.set(event.id, event);
    else if (event.status === 'finished') finished.set(event.id, event);
  });

  const eventIds = [...new Set([...finished.keys(), ...voids.keys()])];
  const openSelections = eventIds.length
    ? await loadSelections(db, { event_id: { $in: eventIds.slice(0, 500) }, status: 'open' }, 12)
    : [];
  // Eventos fora do primeiro bloco de 500 ids são carregados em sequência.
  if (eventIds.length > 500) {
    for (const ids of chunkArray(eventIds.slice(500), 100)) {
      openSelections.push(...(await loadSelections(db, { event_id: { $in: ids }, status: 'open' })));
    }
  }

  const selectionUpdates = [];
  const touchedTickets = new Set();
  const reviewEventIds = new Set();
  const waitingEventIds = new Set();
  const settledEventIds = new Set();

  openSelections.forEach((selection) => {
    const event = finished.get(selection.event_id) || voids.get(selection.event_id);
    if (!event) return;

    // Auditoria primeiro: sem confirmação registrada a partida vai para
    // revisão em vez de ser decidida por um placar isolado.
    if (event.status === 'finished' && !event.result_confirmed_at && event.result_source !== 'api_football') {
      reviewEventIds.add(event.id);
      return;
    }

    if (voids.has(event.id)) {
      touchedTickets.add(selection.ticket_id);
      settledEventIds.add(event.id);
      selectionUpdates.push({
        id: selection.id,
        status: 'void',
        settled_at: nowIso,
        fixture_id: event.fixture_id || selection.fixture_id || '',
        result_source: 'provider',
        result_note: 'Partida adiada ou cancelada — seleção anulada',
      });
      return;
    }

    const outcome = settleSelection(selection, event);
    if (!outcome) {
      const hasScore = Number.isFinite(Number(event.home_score)) && Number.isFinite(Number(event.away_score));
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
      fixture_id: event.fixture_id || selection.fixture_id || '',
      result_source: event.result_source || 'provider',
      result_note: `Placar considerado: ${event.home_score} x ${event.away_score}${event.extra_time ? ' (tempo regulamentar)' : ''}`,
    });
  });

  for (const batch of chunkArray(selectionUpdates, 200)) {
    if (batch.length) await db.SimulationSelection.bulkUpdate(batch);
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

    // Idempotência: boletim já registrado não gera um segundo resultado.
    const existingResults = await db.SimulationResult.filter(
      { ticket_id: { $in: ticketIds } },
      { limit: ticketIds.length },
    );
    const alreadySettled = new Set((existingResults.items || []).map((row) => row.ticket_id));

    const ticketUpdates = [];
    const results = [];
    ticketIds.forEach((ticketId) => {
      const list = selectionsByTicket.get(ticketId) || [];
      // Bilhete com múltiplas partidas só fecha quando nenhuma seleção está aberta.
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

    // Bilhete removido do banco não pode travar a rotina inteira: só entra no
    // fechamento o que realmente existe.
    const liveTickets = new Set();
    const RECORD_ID = /^[a-f0-9]{24}$/i;
    const candidateIds = [...new Set(ticketUpdates.map((row) => row.id))].filter((id) => RECORD_ID.test(String(id)));
    for (const ids of chunkArray(candidateIds, 100)) {
      const page = await db.SimulationTicket.filter({ id: { $in: ids } }, { limit: ids.length }).catch(() => null);
      (page?.items || []).forEach((ticket) => liveTickets.add(ticket.id));
    }
    const validUpdates = ticketUpdates.filter((row) => liveTickets.has(row.id));
    const validResults = results.filter((row) => liveTickets.has(row.ticket_id));

    for (const batch of chunkArray(validUpdates, 200)) {
      if (batch.length) await db.SimulationTicket.bulkUpdate(batch);
    }
    if (validResults.length) await db.SimulationResult.bulkCreate(validResults);
    settledTickets = validResults.length;

    // Rollover conta somente na liquidação do boletim. Anulados não contam.
    const rolloverTicketIds = validResults
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

    // Prêmio creditado uma única vez: `prize_paid` é o marcador.
    const wonIds = validResults.filter((row) => row.result === 'won').map((row) => row.ticket_id);
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

  return {
    selections_settled: selectionUpdates.length,
    tickets_settled: settledTickets,
    prizes_paid: prizesPaid,
    duplicates_skipped: skippedDuplicates,
    review_events: reviewEventIds.size,
    waiting_events: waitingEventIds.size,
    settled_events: settledEventIds.size,
  };
}
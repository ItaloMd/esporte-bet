import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { apiBase, listScores } from '../../shared/oddsApi.ts';
import { round2 } from '../../shared/tichupay.ts';
import {
  SCORE_RECHECK_MS,
  SCORE_BACKOFF_MS,
  chunkArray,
  readScore,
  settleSelection,
  markStartedEventsLive,
} from '../../shared/matchLifecycle.ts';

const LOCK_MS = 4 * 60 * 1000;
const SCORE_BATCH = 3;
const SCORE_DAYS_FROM = 3;

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
 * 2. Com a API-Football ativa, os placares já chegam confirmados pelo
 *    sincronizador (`syncFootball`) e nenhuma chamada extra é feita aqui; sem
 *    ela, o comportamento anterior (uma consulta por modalidade) é mantido.
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
    if (!footballEnabled && settings.provider !== 'the_odds_api') {
      return Response.json({ skipped: true, reason: 'Provedor ativo não fornece placares' });
    }
    if (settings.locked_until && Date.parse(settings.locked_until) > nowMs) {
      return Response.json({ skipped: true, reason: 'Outra execução está em andamento' });
    }

    await db.ProviderSettings.update(settings.id, {
      locked_until: new Date(nowMs + LOCK_MS).toISOString(),
      lock_owner: 'settle',
    });

    const job = await db.SyncJob.create({
      provider: footballEnabled ? 'api_football' : settings.provider,
      trigger: 'scheduled',
      job_type: 'results',
      status: 'running',
      started_at: nowIso,
      triggered_by: user.email,
    });

    const usage = { used: null, remaining: null, cost: 0, calls: 0 };
    const track = (info) => {
      if (!info) return;
      if (info.used !== null && info.used !== undefined) usage.used = info.used;
      if (info.remaining !== null && info.remaining !== undefined) usage.remaining = info.remaining;
      if (info.last !== null && info.last !== undefined) {
        usage.cost += Number(info.last) || 0;
        usage.calls += 1;
      }
    };

    // 1) Fechamento e status ao vivo, definidos apenas pelo horário previsto.
    const startedIds = await markStartedEventsLive(db, nowIso);

    // 2) Consulta controlada de placares (somente sem a API-Football).
    const pending = await loadPendingEvents(db);
    const due = pending.filter((event) => !event.next_check_at || Date.parse(event.next_check_at) <= nowMs);

    // Com a API-Football ativa, o futebol já recebe placar confirmado pelo
    // sincronizador central; as demais modalidades continuam sendo consultadas
    // na fonte de odds, para que nenhuma aposta fique sem resultado.
    const scoreDue = footballEnabled ? due.filter((event) => event.sport_slug !== 'futebol') : due;

    const competitionIds = [...new Set(scoreDue.map((event) => event.competition_id).filter(Boolean))];
    let keyByCompetition = new Map();
    if (competitionIds.length) {
      const page = await db.Competition.filter({ id: { $in: competitionIds } }, { limit: competitionIds.length });
      keyByCompetition = new Map((page.items || []).map((row) => [row.id, row.external_id]));
    }

    const dueByKey = new Map();
    scoreDue.forEach((event) => {
      const sportKey = keyByCompetition.get(event.competition_id);
      if (!sportKey) return;
      if (!dueByKey.has(sportKey)) dueByKey.set(sportKey, []);
      dueByKey.get(sportKey).push(event);
    });

    const apiKey = secrets.get('THE_ODDS_API_KEY');
    const base = apiBase(settings);
    const sportKeys = [...dueByKey.keys()];
    const outcomes = [];
    if (apiKey && sportKeys.length) {
      for (let index = 0; index < sportKeys.length; index += SCORE_BATCH) {
        const slice = sportKeys.slice(index, index + SCORE_BATCH);
        const batch = await Promise.allSettled(
          slice.map(async (sportKey) => {
            const response = await listScores(apiKey, base, sportKey, { daysFrom: SCORE_DAYS_FROM });
            return { sportKey, data: response.data || [], usage: response.usage };
          }),
        );
        batch.forEach((result, offset) => outcomes.push({ sportKey: slice[offset], result }));
      }
    }

    const finishedUpdates = [];
    const checkedIds = [];
    const backedOffIds = [];
    const failures = [];

    outcomes.forEach(({ sportKey, result }) => {
      const events = dueByKey.get(sportKey) || [];
      if (result.status === 'rejected') {
        failures.push(String(result.reason?.message || result.reason));
        events.forEach((event) => backedOffIds.push(event.id));
        return;
      }
      track(result.value.usage);
      const byExternalId = new Map(result.value.data.map((entry) => [entry.id, entry]));
      events.forEach((event) => {
        checkedIds.push(event.id);
        const score = byExternalId.get(event.external_id);
        if (!score || score.completed !== true) return;
        const home = readScore(score, event.home_team_name, 0);
        const away = readScore(score, event.away_team_name, 1);
        if (home === null || away === null) return;
        finishedUpdates.push({
          id: event.id,
          status: 'finished',
          tracking: 'finished',
          published: false,
          odds_status: 'unavailable',
          home_score: home,
          away_score: away,
          result_confirmed_at: nowIso,
          result_source: settings.provider,
          settlement_state: 'waiting',
          next_check_at: null,
        });
      });
    });

    for (const batch of chunkArray(finishedUpdates, 200)) {
      await db.Event.bulkUpdate(batch);
    }

    const recheckAt = new Date(nowMs + SCORE_RECHECK_MS).toISOString();
    const backoffAt = new Date(nowMs + SCORE_BACKOFF_MS).toISOString();
    for (const ids of chunkArray(checkedIds, 200)) {
      await db.Event.updateMany({ id: { $in: ids }, status: 'live' }, { $set: { next_check_at: recheckAt } });
    }
    for (const ids of chunkArray(backedOffIds, 200)) {
      await db.Event.updateMany({ id: { $in: ids }, status: 'live' }, { $set: { next_check_at: backoffAt } });
    }

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

      // 4) Credita o prêmio dos boletins ganhos. O marcador prize_paid garante
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
      footballEnabled ? `futebol pela API-Football · ${sportKeys.length} outra(s) modalidade(s)` : `${sportKeys.length} modalidade(s) consultada(s)`,
      `${finishedUpdates.length} resultado(s) confirmado(s)`,
      `${selectionUpdates.length} seleção(ões)`,
      `${settledTickets} boletim(ns)`,
      reviewEventIds.size ? `${reviewEventIds.size} em revisão` : 'sem revisão pendente',
      `custo observado ${usage.cost}`,
    ].join(' · ');

    await db.ProviderSettings.update(settings.id, {
      locked_until: null,
      lock_owner: '',
      last_sync_at: nowIso,
      last_status: failures.length ? 'partial' : 'success',
      last_error: failures.length ? failures[0].slice(0, 400) : '',
      last_run_summary: summary,
      ...(usage.used !== null ? { credits_used: usage.used } : {}),
      ...(usage.remaining !== null ? { credits_remaining: usage.remaining } : {}),
    });

    await db.SyncJob.update(job.id, {
      status: 'success',
      finished_at: new Date().toISOString(),
      requests_used: usage.cost,
      records_upserted: finishedUpdates.length + selectionUpdates.length,
      error_message: failures.length ? failures.join(' | ').slice(0, 400) : '',
    });

    if (usage.calls) {
      await db.ApiUsageLog.create({
        provider: settings.provider,
        endpoint: `/sports/{key}/scores · ${sportKeys.length} modalidade(s)`,
        status_code: 200,
        duration_ms: Date.now() - nowMs,
        records_returned: finishedUpdates.length,
        cache_hit: false,
        credits_used: usage.cost,
        params: `daysFrom=${SCORE_DAYS_FROM}`,
        note: summary.slice(0, 240),
      });
    }

    return Response.json({
      ok: true,
      started: startedIds.length,
      results_source: footballEnabled ? 'api_football' : settings.provider,
      sports_checked: sportKeys.length,
      results_confirmed: finishedUpdates.length,
      selections_settled: selectionUpdates.length,
      tickets_settled: settledTickets,
      duplicates_skipped: skippedDuplicates,
      review_events: reviewEventIds.size,
      waiting_events: waitingEventIds.size,
      prizes_paid: prizesPaid,
      failures,
      usage,
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
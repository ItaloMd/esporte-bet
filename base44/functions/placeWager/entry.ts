import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { round2 } from '../../shared/tichupay.ts';
import { bettingClosed } from '../../shared/matchLifecycle.ts';

const CLOSED_STATUSES = ['live', 'finished', 'cancelled', 'postponed'];
const MAX_SELECTIONS = 20;

/**
 * Registra um boletim validando tudo no servidor: as cotações precisam estar
 * abertas e cada partida precisa estar publicada, ainda não iniciada e fora da
 * janela de fechamento de 10 minutos. A validação acontece aqui, e não no
 * agendador, para que nenhuma aposta entre depois do horário limite.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const stake = round2(body.stake);
    const oddIds = Array.isArray(body.odd_ids) ? [...new Set(body.odd_ids.filter(Boolean))].slice(0, MAX_SELECTIONS) : [];

    if (!Number.isFinite(stake) || stake <= 0 || stake > 100000) {
      return Response.json({ error: 'Valor de aposta inválido.' }, { status: 400 });
    }
    if (!oddIds.length) {
      return Response.json({ error: 'Nenhuma seleção informada.' }, { status: 400 });
    }

    const db = base44.asServiceRole.entities;
    const oddsPage = await db.Odd.filter({ id: { $in: oddIds } }, { limit: oddIds.length });
    const odds = oddsPage.items || [];
    if (odds.length !== oddIds.length) {
      return Response.json({ error: 'Alguma cotação não está mais disponível.' }, { status: 409 });
    }

    const eventIds = [...new Set(odds.map((odd) => odd.event_id).filter(Boolean))];
    const eventsPage = await db.Event.filter({ id: { $in: eventIds } }, { limit: eventIds.length });
    const events = new Map((eventsPage.items || []).map((event) => [event.id, event]));

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const blocked = [];
    const usable = [];

    odds.forEach((odd) => {
      const event = events.get(odd.event_id);
      const closed =
        !event ||
        odd.status !== 'open' ||
        event.published !== true ||
        CLOSED_STATUSES.includes(event.status) ||
        bettingClosed(event, nowMs);
      if (closed) {
        blocked.push(odd.id);
        return;
      }
      usable.push({ odd, event });
    });

    if (blocked.length) {
      return Response.json(
        {
          error: 'Apostas encerradas: as partidas selecionadas começam em menos de 10 minutos ou já iniciaram.',
          blocked,
        },
        { status: 409 },
      );
    }

    const combined = usable.reduce((acc, item) => acc * Number(item.odd.value || 1), 1);
    if (!Number.isFinite(combined) || combined <= 1) {
      return Response.json({ error: 'Não foi possível calcular a odd combinada.' }, { status: 400 });
    }

    const ticket = await db.SimulationTicket.create({
      user_id: user.id,
      stake_points: stake,
      total_odd: Number(combined.toFixed(4)),
      potential_points: Number((stake * combined).toFixed(2)),
      selection_count: usable.length,
      status: 'open',
      note: 'Simulação registrada com odds e horário capturados no momento da confirmação.',
    });

    await db.SimulationSelection.bulkCreate(
      usable.map(({ odd, event }) => ({
        ticket_id: ticket.id,
        user_id: user.id,
        event_id: event.id,
        event_label: `${event.home_team_name} x ${event.away_team_name}`,
        sport_slug: event.sport_slug,
        competition_name: event.competition_name,
        market_id: odd.market_id,
        market_name: odd.market_name,
        market_key: odd.market_key,
        odd_id: odd.id,
        odd_code: odd.code,
        odd_label: odd.label,
        odd_value: Number(odd.value),
        odd_status_at_placement: odd.status,
        event_start_time: event.start_time,
        status: 'open',
        source: 'provider',
      })),
    );

    return Response.json({
      status: 'placed',
      ticket_id: ticket.id,
      total_odd: Number(combined.toFixed(4)),
      potential_points: Number((stake * combined).toFixed(2)),
      selection_count: usable.length,
      registered_at: nowIso,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha ao registrar a simulação.' }, { status: 500 });
  }
}
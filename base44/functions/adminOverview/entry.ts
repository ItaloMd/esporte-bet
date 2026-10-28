import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Faixa do dia no fuso de São Paulo, devolvida em ISO UTC. */
function spDayRange(now = new Date()) {
  const shifted = new Date(now.getTime() + SP_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const startMs = Date.UTC(y, m, d) - SP_OFFSET_MS;
  return {
    key: `${y}-${pad2(m + 1)}-${pad2(d)}`,
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function sumOf(agg, field) {
  const rows = (agg?.rows || []).filter((row) => row[field] !== undefined && row[field] !== null);
  return rows.reduce((acc, row) => acc + Number(row[field] || 0), 0);
}

function firstRow(agg) {
  return (agg?.rows || [])[0] || {};
}

const CLOSED_TICKET_STATUSES = ['won', 'lost', 'void', 'partial', 'cashed_out'];

/**
 * Central de KPIs, apostas em aberto e saque simulado do painel administrativo.
 * Uma única fonte de dados: todas as telas executivas leem daqui, evitando
 * cálculos duplicados e informações divergentes entre telas.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'overview');
    const day = spDayRange();
    const weekStartMs = Date.parse(day.start) - 6 * 24 * 60 * 60 * 1000;
    const weekStart = new Date(weekStartMs).toISOString();

    if (action === 'overview') {
      const [
        depositsAgg, withdrawalsAgg, betsAgg, prizesAgg, openTicketsAgg, liveCount, todayCount,
        users, snapshots, weekBetsAgg, openCount,
      ] = await Promise.all([
        db.Deposit.aggregate({ query: { status: 'paid', created_date: { $gte: day.start } }, sum: ['amount', 'fee'] }),
        db.Withdrawal.aggregate({ query: { kind: 'player', status: 'completed', created_date: { $gte: day.start } }, sum: ['amount'] }),
        db.WalletTransaction.aggregate({ query: { kind: 'bet', created_date: { $gte: day.start } }, sum: ['amount'] }),
        db.WalletTransaction.aggregate({ query: { kind: 'prize', created_date: { $gte: day.start } }, sum: ['amount'] }),
        db.SimulationTicket.aggregate({ query: { status: 'open' }, sum: ['stake_points', 'potential_points'] }),
        db.Event.count({ status: 'live' }),
        db.Event.count({ start_time: { $gte: day.start, $lte: day.end } }),
        db.User.list(),
        db.FinanceSnapshot.filter({ day: { $gte: day.key } }, { sort: 'day', limit: 7 }),
        db.WalletTransaction.aggregate({ query: { kind: 'bet', created_date: { $gte: weekStart } }, dateBucket: { field: 'created_date', unit: 'day' }, sum: ['amount'] }),
        db.SimulationTicket.count({ status: 'open' }),
      ]);

      const usersList = Array.isArray(users) ? users : users.items || [];
      const newToday = usersList.filter((row) => Date.parse(row.created_date || '') >= Date.parse(day.start)).length;
      const depositsToday = Math.abs(sumOf(depositsAgg, 'sum_amount'));
      const depositsFeeToday = Math.abs(sumOf(depositsAgg, 'sum_fee'));
      const withdrawalsToday = Math.abs(sumOf(withdrawalsAgg, 'sum_amount'));
      const volumeToday = Math.abs(sumOf(betsAgg, 'sum_amount'));
      const prizesToday = Math.abs(sumOf(prizesAgg, 'sum_amount'));
      const grossProfit = Math.round((volumeToday - prizesToday) * 100) / 100;
      const netProfit = Math.round((grossProfit - depositsFeeToday) * 100) / 100;

      const openRow = firstRow(openTicketsAgg);
      const settledToday = await db.SimulationTicket.aggregate({ query: { status: { $in: CLOSED_TICKET_STATUSES }, settled_at: { $gte: day.start } }, groupBy: 'status' });

      const betSeries = (weekBetsAgg?.rows || []).map((row) => ({
        day: String(row.created_date || row.date || '').slice(0, 10).slice(5),
        volume: Math.abs(Number(row.sum_amount) || 0),
      }));
      const financeSeries = (snapshots.items || []).map((row) => ({
        day: String(row.day || '').slice(5),
        apostado: Number(row.staked_total || 0),
        pago: Number(row.paid_total || 0),
        resultado: Number(row.real_result || 0),
      }));

      return Response.json({
        day: day.key,
        kpis: {
          deposits_today: depositsToday,
          deposits_count_today: Number(firstRow(depositsAgg).count) || 0,
          withdrawals_today: withdrawalsToday,
          gross_profit: grossProfit,
          net_profit: netProfit,
          fees_today: depositsFeeToday,
          users_total: usersList.length,
          users_new_today: newToday,
          open_bets_count: Number(openCount) || 0,
          open_bets_stake: Math.abs(Number(openRow.sum_stake_points) || 0),
          open_bets_potential: Math.abs(Number(openRow.sum_potential_points) || 0),
          settled_today: (settledToday?.rows || []).reduce((acc, row) => acc + (Number(row.count) || 0), 0),
          live_matches: Number(liveCount) || 0,
          today_matches: Number(todayCount) || 0,
          volume_today: volumeToday,
          prizes_today: prizesToday,
        },
        bet_series: betSeries,
        finance_series: financeSeries,
      });
    }

    if (action === 'open_bets') {
      const [openPage, closedAgg] = await Promise.all([
        db.SimulationTicket.filter({ status: 'open' }, { sort: '-created_date', limit: 200 }),
        db.SimulationTicket.aggregate({ query: { status: { $in: CLOSED_TICKET_STATUSES } }, groupBy: 'status' }),
      ]);
      const tickets = openPage.items || [];
      const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
      const ticketIds = tickets.map((ticket) => ticket.id);

      const selectionPages = [];
      for (let offset = 0; offset < ticketIds.length; offset += 500) {
        selectionPages.push(await db.SimulationSelection.filter(
          { ticket_id: { $in: ticketIds.slice(offset, offset + 500) } },
          { limit: 500 },
        ));
      }
      const selections = selectionPages.flatMap((page) => page.items || []);

      const eventIds = [...new Set(selections.map((row) => row.event_id).filter(Boolean))];
      const eventsById = new Map();
      if (eventIds.length) {
        const eventPage = await db.Event.filter({ id: { $in: eventIds } }, { limit: 100 });
        (eventPage.items || []).forEach((event) => eventsById.set(event.id, event));
      }

      const byEvent = new Map();
      const byMarket = new Map();
      const marketKey = (market) => `${market.market_name} · ${market.odd_label}${market.odd_value ? ` @ ${Number(market.odd_value).toFixed(2)}` : ''}`;
      selections.forEach((selection) => {
        const ticket = ticketById.get(selection.ticket_id);
        if (!ticket) return;
        const event = eventsById.get(selection.event_id);
        const stake = Number(ticket.stake_points || 0);
        const potential = Number(ticket.potential_points || 0);
        const oddValue = Number(selection.odd_value || 0);

        const eventEntry = byEvent.get(selection.event_id) || {
          event_id: selection.event_id,
          label: selection.event_label || (event ? `${event.home_team_name} x ${event.away_team_name}` : 'Partida'),
          competition: event?.competition_name || selection.competition_name || '',
          start_time: event?.start_time || selection.event_start_time || null,
          status: event?.status || 'scheduled',
          minute: event?.minute ?? null,
          score: event ? `${event.home_score ?? 0} x ${event.away_score ?? 0}` : '',
          ticket_count: 0,
          stake: 0,
          potential: 0,
          markets: new Map(),
        };
        eventEntry.ticket_count += 1;
        eventEntry.stake += stake;
        eventEntry.potential += potential;

        const marketEntry = eventEntry.markets.get(marketKey(selection)) || {
          market: selection.market_name || selection.market_key || 'Mercado',
          odd_label: selection.odd_label || '—',
          odd_value: oddValue,
          bet_count: 0,
          volume: 0,
          payout: 0,
        };
        marketEntry.bet_count += 1;
        marketEntry.volume += stake;
        marketEntry.payout += Math.round(stake * (oddValue || 1) * 100) / 100;
        eventEntry.markets.set(marketKey(selection), marketEntry);
        byEvent.set(selection.event_id, eventEntry);

        const globalMarket = byMarket.get(selection.market_key || selection.market_name) || {
          market_key: selection.market_key || selection.market_name,
          market_name: selection.market_name || 'Mercado',
          bet_count: 0,
          volume: 0,
        };
        globalMarket.bet_count += 1;
        globalMarket.volume += stake;
        byMarket.set(selection.market_key || selection.market_name, globalMarket);
      });

      const events = [...byEvent.values()]
        .map((row) => ({ ...row, markets: [...row.markets.values()].sort((a, b) => b.volume - a.volume) }))
        .sort((a, b) => b.potential - a.potential)
        .slice(0, 25);

      const closedPage = await db.SimulationTicket.filter(
        { status: { $in: CLOSED_TICKET_STATUSES } },
        { sort: '-created_date', limit: 40 },
      );

      return Response.json({
        totals: {
          open_count: tickets.length,
          open_stake: Math.round(tickets.reduce((acc, t) => acc + Number(t.stake_points || 0), 0) * 100) / 100,
          open_potential: Math.round(tickets.reduce((acc, t) => acc + Number(t.potential_points || 0), 0) * 100) / 100,
          exposure: Math.round(tickets.reduce((acc, t) => acc + Math.max(0, Number(t.potential_points || 0) - Number(t.stake_points || 0)), 0) * 100) / 100,
        },
        events,
        by_market: [...byMarket.values()].sort((a, b) => b.volume - a.volume),
        closed: {
          recent: (closedPage.items || []).map((t) => ({
            id: t.id,
            stake: t.stake_points,
            odd: t.total_odd,
            potential: t.potential_points,
            status: t.status,
            settled_at: t.settled_at || t.cashed_out_at || null,
            selections: t.selection_count,
          })),
          counts: (closedAgg?.rows || []).map((row) => ({ status: row.status, count: Number(row.count) || 0 })),
        },
      });
    }

    if (action === 'simulate_withdrawal') {
      const targetUserId = String(body.user_id || '').trim();
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!targetUserId) return Response.json({ error: 'Informe o jogador.' }, { status: 400 });
      if (!Number.isFinite(amount) || amount <= 0) {
        return Response.json({ error: 'Informe um valor válido.' }, { status: 400 });
      }
      const users = await db.User.list();
      const target = (Array.isArray(users) ? users : users.items || []).find((row) => row.id === targetUserId);
      if (!target) return Response.json({ error: 'Jogador não encontrado.' }, { status: 404 });

      const profilePage = await db.UserProfile.filter({ user_id: targetUserId }, { limit: 1 });
      const cpf = String(profilePage.items?.[0]?.cpf || '').replace(/\D/g, '');
      if (!cpf) {
        return Response.json({ error: 'O jogador não tem CPF vinculado ao perfil.' }, { status: 400 });
      }

      // Registro 100% visual: nenhum gateway é chamado e nenhum saldo é movido.
      const created = await db.Withdrawal.create({
        user_id: targetUserId,
        user_email: target.email,
        kind: 'player',
        amount,
        sent_amount: amount,
        fee: 0,
        net_amount: amount,
        pix_key: cpf,
        pix_key_type: 'cpf',
        status: 'completed',
        correlation_id: `sim_${crypto.randomUUID()}`,
        note: 'Saque simulado pelo painel administrativo — registro visual, sem transferência real.',
        processed_at: new Date().toISOString(),
      });
      await db.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'admin_finance.simulate_withdrawal',
        target_type: 'Withdrawal',
        target_id: created.id,
        details: JSON.stringify({ user_id: targetUserId, amount, visual_only: true }),
      });
      return Response.json({ ok: true, withdrawal_id: created.id, status: created.status });
    }

    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'Falha na operação.' }, { status: 500 });
  }
}
/**
 * Regras de comissão do programa de indicações.
 *
 * O modelo de remuneração é escolhido por afiliado:
 *   full_rev → percentual sobre o total depositado pelos jogadores indicados
 *   rev_cpa  → o mesmo percentual + um valor fixo por jogador qualificado
 *   cpa      → apenas o valor fixo por jogador qualificado
 *
 * Um jogador indicado só "qualifica" quando faz o primeiro depósito (FTD) de
 * valor igual ou superior ao mínimo configurado e cumpre o rollover exigido do
 * afiliado sobre esse primeiro depósito. Só jogadores qualificados geram saldo.
 */

export const AFFILIATE_MODELS = ['full_rev', 'rev_cpa', 'cpa'];

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function affiliateModel(model) {
  return AFFILIATE_MODELS.includes(model) ? model : 'full_rev';
}

/** Comissão gerada por um jogador indicado, conforme o modelo do afiliado. */
export function commissionFor(affiliate, player) {
  if (!player?.qualified) return 0;
  const model = affiliateModel(affiliate?.model);
  const cpa = round2(affiliate?.cpa_amount);
  if (model === 'cpa') return cpa;
  const rev = round2((Number(affiliate?.rev_share_percent) || 0) / 100 * Number(player.total_deposited || 0));
  return model === 'rev_cpa' ? round2(rev + cpa) : rev;
}

/** Rollover exigido do afiliado: múltiplo aplicado sobre o primeiro depósito. */
export function requiredRollover(affiliate, ftd) {
  return round2(Number(affiliate?.rollover_multiplier || 0) * Number(ftd || 0));
}

function chunk(list, size) {
  const parts = [];
  for (let index = 0; index < list.length; index += size) parts.push(list.slice(index, index + size));
  return parts;
}

async function collect(db, entity, filter, { sort, limit = 500, rounds = 6 } = {}) {
  const rows = [];
  let cursor = null;
  for (let round = 0; round < rounds; round += 1) {
    const page = await db[entity].filter(filter, {
      limit,
      ...(sort ? { sort } : {}),
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...(page.items || []));
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }
  return rows;
}

/**
 * Monta o resumo de um afiliado: jogadores indicados, depósitos, FTD, QFTD,
 * comissão elegível e saldo disponível (elegível menos o que já foi solicitado).
 */
export async function summarizeAffiliate(db, affiliate, settings = {}) {
  const minFtd = Number(settings.affiliate_qftd_min_deposit ?? 50);
  const referrals = await collect(db, 'AffiliateReferral', { referrer_user_id: affiliate.user_id });

  const userIds = [...new Set(referrals.map((row) => row.referred_user_id).filter(Boolean))];
  const depositsByUser = new Map();
  const walletByUser = new Map();

  for (const ids of chunk(userIds, 40)) {
    const deposits = await collect(db, 'Deposit', { user_id: { $in: ids }, status: 'paid' }, { sort: 'created_date' });
    deposits.forEach((row) => {
      if (!depositsByUser.has(row.user_id)) depositsByUser.set(row.user_id, []);
      depositsByUser.get(row.user_id).push(row);
    });
    const wallets = await collect(db, 'Wallet', { user_id: { $in: ids } });
    wallets.forEach((row) => walletByUser.set(row.user_id, row));
  }

  const players = referrals.map((referral) => {
    const list = (depositsByUser.get(referral.referred_user_id) || []).slice().sort(
      (a, b) => new Date(a.paid_at || a.created_date) - new Date(b.paid_at || b.created_date),
    );
    const first = list[0] || null;
    const ftd = round2(first?.amount);
    const totalDeposited = round2(list.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const wallet = walletByUser.get(referral.referred_user_id);
    const rolloverCompleted = round2(wallet?.rollover_completed);
    const rolloverNeeded = requiredRollover(affiliate, ftd);
    const qualified = Boolean(first) && ftd >= minFtd && rolloverCompleted >= rolloverNeeded;
    const player = {
      referral_id: referral.id,
      label: referral.referred_label || 'Jogador indicado',
      status: referral.status,
      attributed_at: referral.attributed_at || referral.created_date,
      deposits: list.length,
      total_deposited: totalDeposited,
      ftd,
      has_ftd: Boolean(first),
      qftd: Boolean(first) && ftd >= minFtd,
      rollover_completed: rolloverCompleted,
      rollover_required: rolloverNeeded,
      qualified,
      last_deposit_at: list.length ? list[list.length - 1].paid_at || list[list.length - 1].created_date : null,
    };
    player.commission = commissionFor(affiliate, player);
    return player;
  });

  const eligible = round2(players.reduce((sum, player) => sum + player.commission, 0));
  const payouts = await collect(db, 'Withdrawal', { user_id: affiliate.user_id, kind: 'affiliate' });
  const requested = round2(
    payouts
      .filter((row) => ['pending', 'processing', 'completed'].includes(row.status))
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
  );

  return {
    players,
    totals: {
      players: players.length,
      depositing_players: players.filter((player) => player.has_ftd).length,
      ftds: players.filter((player) => player.has_ftd).length,
      qftds: players.filter((player) => player.qftd).length,
      qualified: players.filter((player) => player.qualified).length,
      total_deposited: round2(players.reduce((sum, player) => sum + player.total_deposited, 0)),
      eligible_commission: eligible,
      requested,
      available: round2(Math.max(0, eligible - requested)),
      min_ftd: minFtd,
    },
  };
}
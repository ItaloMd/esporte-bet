/**
 * Catálogo oficial do provedor: casas de apostas (`/odds/bookmakers`) e bets
 * aceitos pelo plano (`/odds/bets`).
 *
 * Nada é presumido no código: os IDs e nomes vêm da própria API e são gravados
 * no banco. A seleção de quais casas servem de referência de preço é uma decisão
 * administrativa (campo `enabled`), nunca uma lista fixa.
 */
import { BET_NAME_TO_MARKET_KEY } from './footballMarkets.ts';
import { chunkArray } from './matchLifecycle.ts';

export const CATALOG_PROVIDER = 'api_football';

/** Casas cadastradas, ordenadas por nome. */
export async function listBookmakers(db) {
  const page = await db.Bookmaker.list({ limit: 500, sort: 'name' });
  return page.items || [];
}

/**
 * Nomes selecionados pelo administrador como referência de preço.
 * Lista vazia significa "nenhuma seleção explícita": a coleta volta à ordem de
 * preferência padrão, em vez de ficar sem nenhuma casa.
 */
export async function listEnabledBookmakers(db) {
  const rows = await listBookmakers(db);
  const enabled = rows.filter((row) => row.enabled).map((row) => String(row.name || '').trim()).filter(Boolean);
  return enabled.length ? enabled : null;
}

/**
 * Sincroniza o catálogo de casas. Preserva a seleção existente: uma casa já
 * cadastrada mantém `enabled` como está, só nome e data de sincronização mudam.
 */
export async function syncBookmakerCatalog(db, client) {
  const result = await client.call('/odds/bookmakers', {}, { timeoutMs: 20000, purpose: 'catalog' });
  const rows = (Array.isArray(result.data?.response) ? result.data.response : [])
    .map((row) => ({ provider_id: String(row?.id ?? '').trim(), name: String(row?.name || '').trim() }))
    .filter((row) => row.provider_id && row.name);

  if (!rows.length) {
    return { total: 0, created: 0, updated: 0, enabled: 0, empty: true, errors: result.errors || [] };
  }

  const existing = new Map((await listBookmakers(db)).map((row) => [String(row.provider_id), row]));
  const nowIso = new Date().toISOString();
  const creates = [];
  const updates = [];

  rows.forEach((row) => {
    const found = existing.get(row.provider_id);
    if (!found) {
      creates.push({
        provider: CATALOG_PROVIDER,
        provider_id: row.provider_id,
        name: row.name,
        enabled: false,
        synced_at: nowIso,
        last_seen_at: nowIso,
      });
    } else if (found.name !== row.name || found.last_seen_at !== nowIso) {
      updates.push({ id: found.id, name: row.name, synced_at: nowIso, last_seen_at: nowIso });
    }
  });

  for (const batch of chunkArray(creates, 200)) {
    if (batch.length) await db.Bookmaker.bulkCreate(batch);
  }
  for (const batch of chunkArray(updates, 200)) {
    if (batch.length) await db.Bookmaker.bulkUpdate(batch);
  }

  const saved = await listBookmakers(db);
  return {
    total: saved.length,
    created: creates.length,
    updated: updates.length,
    enabled: saved.filter((row) => row.enabled).length,
    empty: false,
    errors: result.errors || [],
  };
}

/**
 * Sincroniza apenas os bets que a aplicação utiliza, conferindo o nome oficial
 * de cada mercado contra a resposta real do plano. Nenhum ID é presumido: o que
 * não existir na resposta fica registrado como indisponível para o plano atual.
 */
export async function syncBetCatalog(db, client) {
  const result = await client.call('/odds/bets', {}, { timeoutMs: 20000, purpose: 'catalog' });
  const registered = new Map(
    (Array.isArray(result.data?.response) ? result.data.response : [])
      .map((row) => [String(row?.name || '').trim().toLowerCase(), String(row?.id ?? '')])
      .filter(([name]) => name),
  );

  const settingsPage = await db.MarketSettings.list({ limit: 200 });
  const existing = new Map((settingsPage.items || []).map((row) => [row.market_key, row]));
  const nowIso = new Date().toISOString();
  const checked = [];

  for (const [betName, marketKey] of BET_NAME_TO_MARKET_KEY.entries()) {
    const providerId = registered.get(betName);
    const row = existing.get(marketKey);
    const note = providerId
      ? `Bet oficial "${betName}" (id ${providerId}) confirmado no plano`
      : `Bet "${betName}" não consta na resposta de /odds/bets do plano atual`;
    const patch = {
      support_status: providerId ? 'available' : 'upgrade',
      support_checked_at: nowIso,
      support_note: note,
    };
    if (row) await db.MarketSettings.update(row.id, patch);
    checked.push({ market_key: marketKey, provider_bet: betName, available: Boolean(providerId) });
  }

  return {
    provider_bets: registered.size,
    checked: checked.length,
    available: checked.filter((row) => row.available).length,
    missing: checked.filter((row) => !row.available).map((row) => row.provider_bet),
    errors: result.errors || [],
  };
}
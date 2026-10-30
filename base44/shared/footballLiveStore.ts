/**
 * Tabela `live_fixtures`: o retrato do coletor ao vivo.
 *
 * O coletor (syncFootballLive) é o único que chama `/fixtures?live=all` e grava
 * aqui. Todo serviço secundário — monitoramento, liquidação, telas — lê esta
 * tabela (ou o cache de 120 s), nunca o provedor.
 */
import { chunkArray } from './matchLifecycle.ts';

/** Converte a partida normalizada da fonte na linha de live_fixtures. */
function rowFromFixture(fixture, nowIso, extra = {}) {
  return {
    fixture_id: fixture.fixture_id,
    event_id: extra.event_id || '',
    status: fixture.status,
    elapsed: fixture.minute ?? null,
    league_id: fixture.competition_id || '',
    league_name: fixture.competition_name || '',
    home_id: fixture.home_team_id || '',
    home_name: fixture.home_team_name || '',
    away_id: fixture.away_team_id || '',
    away_name: fixture.away_team_name || '',
    home_score: fixture.home_score ?? null,
    away_score: fixture.away_score ?? null,
    has_bets: Boolean(extra.has_bets),
    is_favorite: Boolean(extra.is_favorite),
    is_brazilian: Boolean(extra.is_brazilian),
    last_update: nowIso,
  };
}

/**
 * Grava o retrato do ciclo: atualiza as partidas em andamento, cria as novas e
 * remove as que saíram do feed (encerradas ou fora do recorte).
 */
export async function saveLiveSnapshot(db, fixtures, nowIso, { eventByFixture, betFixtureIds, favoriteFixtureIds } = {}) {
  const ids = fixtures.map((fixture) => fixture.fixture_id).filter(Boolean);
  const existing = new Map();
  for (const chunk of chunkArray(ids, 100)) {
    const page = await db.LiveFixture.filter({ fixture_id: { $in: chunk } }, { limit: 500 });
    (page.items || []).forEach((row) => existing.set(row.fixture_id, row));
  }

  const updates = [];
  const creations = [];
  fixtures.forEach((fixture) => {
    if (!fixture?.fixture_id) return;
    const row = rowFromFixture(fixture, nowIso, {
      event_id: eventByFixture?.get(fixture.fixture_id) || existing.get(fixture.fixture_id)?.event_id || '',
      has_bets: betFixtureIds?.has(fixture.fixture_id),
      is_favorite: favoriteFixtureIds?.has(fixture.fixture_id),
    });
    const found = existing.get(fixture.fixture_id);
    if (found) updates.push({ id: found.id, ...row });
    else creations.push(row);
  });

  for (const chunk of chunkArray(updates, 200)) {
    if (chunk.length) await db.LiveFixture.bulkUpdate(chunk);
  }
  for (const chunk of chunkArray(creations, 100)) {
    if (chunk.length) await db.LiveFixture.bulkCreate(chunk);
  }

  // Partidas que saíram do feed não ficam presas no retrato ao vivo.
  const active = new Set(ids);
  const stale = [...existing.values()].filter((row) => !active.has(row.fixture_id)).map((row) => row.id);
  for (const chunk of chunkArray(stale, 200)) {
    if (chunk.length) await db.LiveFixture.deleteMany({ id: { $in: chunk } });
  }

  return { updated: updates.length, created: creations.length, removed: stale.length };
}

/** Leitura do retrato ao vivo: única fonte das rotinas secundárias. */
export async function readLiveSnapshot(db, { limit = 300 } = {}) {
  const page = await db.LiveFixture.list({ sort: '-last_update', limit });
  return page.items || [];
}
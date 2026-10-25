/**
 * Utilitários compartilhados pelas rotinas da API-Football: leitura de números,
 * janela de datas no calendário brasileiro e índice de partidas por `fixture_id`.
 */
import { FOOTBALL_TIMEZONE } from './apiFootball.ts';
import { localDateString } from './oddsApi.ts';
import { chunkArray } from './matchLifecycle.ts';

export function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Próximos `days` dias no calendário brasileiro, começando hoje. */
export function windowDates(now, days) {
  const list = [];
  for (let index = 0; index < days; index += 1) {
    list.push(localDateString(new Date(now.getTime() + index * 86400000), FOOTBALL_TIMEZONE));
  }
  return list;
}

/** Índice por `fixture_id` para as partidas já conhecidas. */
export async function indexByFixtureId(db, fixtureIds) {
  const index = new Map();
  for (const ids of chunkArray(fixtureIds, 100)) {
    const page = await db.Event.filter({ fixture_id: { $in: ids } }, { limit: ids.length });
    (page.items || []).forEach((row) => index.set(row.fixture_id, row));
  }
  return index;
}
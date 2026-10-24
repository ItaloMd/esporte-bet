/**
 * Brasões dos times: busca o escudo em uma base pública de times (ESPN) pelo
 * nome exato, grava a URL no cadastro do evento (home_team_crest /
 * away_team_crest) e mantém o escudo armazenado, sem nova consulta a cada
 * listagem. Nomes sem correspondência exata ficam sem escudo — a interface
 * mostra as iniciais do time.
 */
const SEARCH_URL = 'https://site.api.espn.com/apis/common/v3/search';
const LOOKUP_BATCH = 6;
const LOOKUP_TIMEOUT_MS = 10000;
const WRITE_CHUNK = 400;

const SPORT_BY_SLUG = {
  soccer: 'soccer',
  basketball: 'basketball',
  ice_hockey: 'hockey',
  baseball: 'baseball',
  american_football: 'football',
  mma: 'mma',
  tennis: 'tennis',
  rugby: 'rugby',
  cricket: 'cricket',
  handball: 'handball',
  volleyball: 'volleyball',
  aussie_rules: 'australian-football',
  boxing: 'boxing',
};

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

export function normalizeTeamName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|sc|cf|ac|ec|afc|club|clube|football|futebol|de|do|da|dos|das)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function badgeOf(team) {
  const logos = Array.isArray(team?.logos) ? team.logos : [];
  const preferred = logos.find((logo) => (logo?.rel || []).includes('default')) || logos[0];
  return preferred?.href || null;
}

async function lookupBadge(name, sportSlug) {
  const response = await fetch(`${SEARCH_URL}?query=${encodeURIComponent(name)}&limit=6`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item?.type === 'team') : [];
  const target = normalizeTeamName(name);
  if (!target) return null;
  const matches = items.filter(
    (item) => normalizeTeamName(item.displayName) === target || normalizeTeamName(item.name) === target,
  );
  if (!matches.length) return null;
  const expected = SPORT_BY_SLUG[sportSlug];
  // Um escudo errado é pior que nenhum: só aceita nome exato e, quando o
  // esporte é conhecido, dá preferência ao time do mesmo esporte.
  const best = (expected && matches.find((item) => item.sport === expected)) || matches[0];
  return badgeOf(best);
}

export async function backfillTeamCrests(db, { maxTeams = 60 } = {}) {
  // Partidas em andamento não passam pelo catálogo publicado, mas também
  // aparecem para o jogador — por isso entram por status.
  const page = await db.Event.filter(
    { $or: [{ status: 'live' }, { status: 'scheduled', published: true }] },
    { limit: 300, sort: 'start_time' },
  );
  const events = page.items || [];
  if (!events.length) return { events: 0, teamsResolved: 0, eventsUpdated: 0, pending: 0 };

  const known = new Map();
  events.forEach((event) => {
    if (event.home_team_crest && event.home_team_name) known.set(normalizeTeamName(event.home_team_name), event.home_team_crest);
    if (event.away_team_crest && event.away_team_name) known.set(normalizeTeamName(event.away_team_name), event.away_team_crest);
  });

  const pending = new Map();
  events.forEach((event) => {
    [
      ['home_team_name', 'home_team_crest'],
      ['away_team_name', 'away_team_crest'],
    ].forEach(([nameField, crestField]) => {
      const name = event[nameField];
      if (!name || event[crestField]) return;
      const key = normalizeTeamName(name);
      if (!key || known.has(key) || pending.has(key)) return;
      pending.set(key, { name, sportSlug: event.sport_slug });
    });
  });

  const targets = [...pending.entries()].slice(0, maxTeams);
  let teamsResolved = 0;
  for (const batch of chunk(targets, LOOKUP_BATCH)) {
    const results = await Promise.allSettled(
      batch.map(async ([key, target]) => [key, await lookupBadge(target.name, target.sportSlug)]),
    );
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value[1]) {
        known.set(result.value[0], result.value[1]);
        teamsResolved += 1;
      }
    });
  }

  const updates = [];
  events.forEach((event) => {
    const patch = {};
    if (!event.home_team_crest && event.home_team_name) {
      const crest = known.get(normalizeTeamName(event.home_team_name));
      if (crest) patch.home_team_crest = crest;
    }
    if (!event.away_team_crest && event.away_team_name) {
      const crest = known.get(normalizeTeamName(event.away_team_name));
      if (crest) patch.away_team_crest = crest;
    }
    if (Object.keys(patch).length) updates.push({ id: event.id, ...patch });
  });

  for (const batch of chunk(updates, WRITE_CHUNK)) {
    await db.Event.bulkUpdate(batch);
  }

  return {
    events: events.length,
    teamsResolved,
    eventsUpdated: updates.length,
    pending: Math.max(pending.size - targets.length, 0),
  };
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { DEFAULT_WEIGHTS, DEFAULT_TEAM_SCORE, loadRelevanceConfig } from '../../shared/relevance.ts';

/** Partidas lidas por página ao montar o catálogo de campeonatos e equipes. */
const PAGE_SIZE = 500;
const MAX_PAGES = 3;
const MAX_COMPETITIONS = 200;
const MAX_TEAMS = 400;

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Pontuação de seleção entre 0 e 50 (mesma escala das competições). */
function scoreOr(value, fallback) {
  return Math.min(50, Math.max(0, Math.round(numberOr(value, fallback))));
}

function textOr(value, max) {
  return String(value || '').trim().slice(0, max);
}

/**
 * Curadoria de relevância: quais campeonatos e equipes importam.
 *
 * - `catalog` (padrão): monta as duas listas a partir das partidas futuras já
 *   importadas — nenhuma chamada à API-Football, custo zero de cota — e devolve
 *   o que já está selecionado.
 * - `save`: grava a seleção em RelevanceSettings. A repontuação das partidas é
 *   feita pelo `syncFootball` no modo `relevance`, sem consultar o provedor.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'catalog');
    const nowIso = new Date().toISOString();

    if (action === 'catalog') {
      const config = await loadRelevanceConfig(db);
      const competitions = new Map();
      const teams = new Map();
      let cursor = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await db.Event.filter(
          { source: 'provider', status: 'scheduled', start_time: { $gte: nowIso } },
          { limit: PAGE_SIZE, sort: 'start_time', ...(cursor ? { cursor } : {}) },
        );
        const items = result.items || [];
        if (!items.length) break;

        items.forEach((event) => {
          const leagueKey = String(event.league_id || event.competition_name || '');
          if (leagueKey) {
            const row = competitions.get(leagueKey) || {
              league_id: String(event.league_id || ''),
              name: event.competition_name || 'Competição sem nome',
              country: event.country || '',
              matches: 0,
            };
            row.matches += 1;
            competitions.set(leagueKey, row);
          }

          [
            [event.home_team_id, event.home_team_name, event.home_team_crest],
            [event.away_team_id, event.away_team_name, event.away_team_crest],
          ].forEach(([id, name, crest]) => {
            const teamKey = String(id || name || '');
            if (!teamKey) return;
            const row = teams.get(teamKey) || {
              team_id: String(id || ''),
              name: name || 'Equipe sem nome',
              crest: crest || '',
              matches: 0,
            };
            row.matches += 1;
            teams.set(teamKey, row);
          });
        });

        cursor = result.next_cursor;
        if (!result.has_more) break;
      }

      const selectedCompetitions = new Map(
        (config.priorityCompetitions || []).map((row) => [String(row.league_id || row.name || ''), row]),
      );
      const selectedTeams = new Map((config.priorityTeams || []).map((row) => [String(row.team_id || row.name || ''), row]));

      const competitionRows = [...competitions.values()]
        .sort((a, b) => b.matches - a.matches)
        .slice(0, MAX_COMPETITIONS)
        .map((row) => {
          const chosen = selectedCompetitions.get(String(row.league_id || row.name));
          return { ...row, selected: Boolean(chosen), score: chosen ? scoreOr(chosen.score, 40) : 40 };
        });

      const teamRows = [...teams.values()]
        .sort((a, b) => b.matches - a.matches)
        .slice(0, MAX_TEAMS)
        .map((row) => {
          const chosen = selectedTeams.get(String(row.team_id || row.name));
          return { ...row, selected: Boolean(chosen), score: chosen ? scoreOr(chosen.score, DEFAULT_TEAM_SCORE) : DEFAULT_TEAM_SCORE };
        });

      return Response.json({
        competitions: competitionRows,
        teams: teamRows,
        selected_competitions: config.priorityCompetitions || [],
        selected_teams: config.priorityTeams || [],
        weights: config.weights,
        totals: { competitions: competitions.size, teams: teams.size },
        window_days: competitions.size ? null : 0,
      });
    }

    if (action === 'save') {
      const competitionsIn = Array.isArray(body.priority_competitions) ? body.priority_competitions : [];
      const teamsIn = Array.isArray(body.priority_teams) ? body.priority_teams : [];

      const priorityCompetitions = competitionsIn
        .slice(0, MAX_COMPETITIONS)
        .map((row) => ({
          league_id: textOr(row?.league_id, 20),
          name: textOr(row?.name, 120),
          country: textOr(row?.country, 60),
          group: row?.group === 'br' ? 'br' : 'intl',
          score: scoreOr(row?.score, 40),
          tokens: Array.isArray(row?.tokens) ? row.tokens.slice(0, 5).map((token) => textOr(token, 40)) : [],
        }))
        .filter((row) => row.name || row.league_id);

      const priorityTeams = teamsIn
        .slice(0, MAX_TEAMS)
        .map((row) => ({
          team_id: textOr(row?.team_id, 20),
          name: textOr(row?.name, 120),
          score: scoreOr(row?.score, DEFAULT_TEAM_SCORE),
        }))
        .filter((row) => row.name || row.team_id);

      const weightTeam = Math.min(40, Math.max(0, Math.round(numberOr(body.weight_team, DEFAULT_WEIGHTS.team))));
      const payload = {
        priority_competitions: JSON.stringify(priorityCompetitions),
        priority_teams: JSON.stringify(priorityTeams),
        weight_team: weightTeam,
        updated_at: nowIso,
      };

      const existingPage = await db.RelevanceSettings.list({ limit: 1 });
      const existing = existingPage.items?.[0] || null;
      if (existing) await db.RelevanceSettings.update(existing.id, payload);
      else await db.RelevanceSettings.create({ weight_competition: DEFAULT_WEIGHTS.competition, ...payload });

      await db.AdminAuditLog.create({
        actor_id: user.id,
        actor_email: user.email,
        action: 'relevance.selection_updated',
        target_type: 'RelevanceSettings',
        target_id: existing?.id || '',
        details: `${priorityCompetitions.length} competição(ões) · ${priorityTeams.length} equipe(s) · peso de equipe ${weightTeam}`.slice(0, 400),
        severity: 'warning',
      }).catch(() => null);

      return Response.json({
        ok: true,
        competitions: priorityCompetitions.length,
        teams: priorityTeams.length,
        weight_team: weightTeam,
      });
    }

    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
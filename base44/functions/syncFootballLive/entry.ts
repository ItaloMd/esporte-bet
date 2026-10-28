import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  fetchFixturesLiveAll,
  footballApiBase,
  mapFixture,
} from '../../shared/apiFootball.ts';
import {
  DEFAULT_DAILY_LIMIT,
  acquireLock,
  canSpend,
  chargeQuota,
  effectiveDailyLimit,
  loadQuota,
  lockHeld,
  quotaDayKey,
  quotaLevel,
  quotaPercent,
  quotaPolicy,
  releaseLock,
  saveQuota,
} from '../../shared/footballQuota.ts';
import { chunkArray } from '../../shared/matchLifecycle.ts';
import { indexByFixtureId, numberOr } from '../../shared/footballSync.ts';
import {
  isCriticalMinute,
  liveIntervalMinutes,
  queueNextCheckAt,
  queuePriority,
} from '../../shared/footballMonitor.ts';

const LOCK_MS = 90 * 1000;

/**
 * Detector global de jogos ao vivo (GET /fixtures?live=all).
 *
 * Uma única chamada por execução detecta partidas iniciadas, atualiza
 * placares, minutos, status e tempo de jogo, mantém a fila de prioridades
 * (crítica / favorita / com apostas / padrão) e encerra o monitoramento no FT —
 * a partida sai da fila e nunca mais é consultada pelo detector.
 *
 * O intervalo é configurável (padrão 2 minutos) e respeitado mesmo quando o
 * workflow dispara antes. Em contingência (orçamento acima de 95%), o detector
 * só roda se houver apostas pendentes.
 */
export default async function (req) {
  let base44;
  let quotaRecord = null;
  let settings = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const dryRun = Boolean(payload?.dry_run);

    const now = new Date();
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    settings = settingsPage.items?.[0] || null;
    if (!settings) return Response.json({ skipped: true, reason: 'Configuração do provedor não encontrada' });
    if (!settings.football_enabled) {
      return Response.json({ skipped: true, reason: 'Integração API-Football desabilitada' });
    }

    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    let limit = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
    quotaRecord = await loadQuota(db, day);
    // O orçamento real é o menor entre o interno e o limite do plano contratado.
    limit = effectiveDailyLimit(limit, quotaRecord?.provider_limit);
    const usedBefore = numberOr(quotaRecord?.used, 0);
    const level = quotaLevel(usedBefore, limit);
    const policy = quotaPolicy(level);
    const intervalMinutes = liveIntervalMinutes(settings);

    if (dryRun) {
      return Response.json({
        ok: true,
        dry_run: true,
        live_interval_minutes: intervalMinutes,
        last_live_at: settings.football_last_live_at || null,
        quota: { used: usedBefore, limit, percent: quotaPercent(usedBefore, limit), level },
      });
    }

    if (lockHeld(quotaRecord, nowMs)) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootballLive', LOCK_MS);
    let used = usedBefore;

    // Contingência: o detector só roda se houver apostas pendentes de resultado.
    if (policy.criticalOnly) {
      const openBets = await db.SimulationSelection.count({ status: 'open' });
      if (!openBets) {
        await releaseLock(db, quotaRecord);
        return Response.json({
          skipped: true,
          reason: 'Contingência: sem apostas pendentes',
          quota: { used, limit, level },
        });
      }
    }

    // Respeita o intervalo configurado mesmo com o workflow disparando antes.
    const lastLiveMs = Date.parse(settings.football_last_live_at || '');
    if (Number.isFinite(lastLiveMs) && nowMs - lastLiveMs < intervalMinutes * 60000 - 5000) {
      await releaseLock(db, quotaRecord);
      return Response.json({
        skipped: true,
        reason: `Intervalo de ${intervalMinutes} min ainda não decorrido`,
        quota: { used, limit, level },
      });
    }

    if (!canSpend(used, limit, policy.reserve, 1)) {
      await releaseLock(db, quotaRecord);
      return Response.json({ skipped: true, reason: 'Orçamento diário esgotado', quota: { used, limit, level } });
    }

    const job = await db.SyncJob.create({
      provider: 'api_football',
      trigger: payload?.trigger === 'manual' ? 'manual' : 'scheduled',
      job_type: 'live',
      status: 'running',
      started_at: nowIso,
      triggered_by: user.email,
    });

    const failures = [];
    const quotaPatch = {};
    const applyQuota = (quota) => {
      if (!quota) return;
      if (quota.limit !== null && quota.limit !== undefined) quotaPatch.provider_limit = quota.limit;
      if (quota.remaining !== null && quota.remaining !== undefined) quotaPatch.provider_remaining = quota.remaining;
      if (quota.used !== null && quota.used !== undefined) quotaPatch.provider_used = quota.used;
    };

    const callStartedAt = Date.now();
    let responseRows = 0;
    let fixtures = [];

    try {
      const result = await fetchFixturesLiveAll(apiKey, base);
      const charged = await chargeQuota(db, {
        record: quotaRecord,
        day,
        limit,
        cost: 1,
        purpose: 'live',
        endpoint: '/fixtures?live=all',
        reserve: policy.reserve,
      });
      quotaRecord = charged.record || quotaRecord;
      used = charged.used;
      applyQuota(result.quota);
      const durationMs = Date.now() - callStartedAt;

      if (result.errors.length) {
        failures.push(result.errors.join(' | '));
      }
      const list = Array.isArray(result.data?.response) ? result.data.response : [];
      responseRows = list.length;
      fixtures = list.map(mapFixture).filter((item) => item.fixture_id);

      // Apostas pendentes e favoritos definem a prioridade de cada partida na fila.
      const openEventIds = new Set();
      let openCursor = null;
      for (let round = 0; round < 3; round += 1) {
        const page = await db.SimulationSelection.filter(
          { status: 'open' },
          { limit: 500, ...(openCursor ? { cursor: openCursor } : {}) },
        );
        (page.items || []).forEach((row) => openEventIds.add(row.event_id));
        openCursor = page.next_cursor;
        if (!page.has_more) break;
      }
      const favoriteFixtureIds = new Set();
      if (fixtures.length) {
        const ids = fixtures.map((fixture) => fixture.fixture_id);
        for (const chunkIds of chunkArray(ids, 100)) {
          const page = await db.FavoriteMatch.filter({ fixture_id: { $in: chunkIds } }, { limit: 500 });
          (page.items || []).forEach((row) => favoriteFixtureIds.add(row.fixture_id));
        }
      }

      const known = await indexByFixtureId(db, fixtures.map((fixture) => fixture.fixture_id));

      const eventUpdates = [];
      const queueRows = [];
      let liveCount = 0;
      let finishedCount = 0;
      let updatedCount = 0;

      fixtures.forEach((fixture) => {
        const event = known.get(fixture.fixture_id);
        if (!event) return;

        const patch = {};
        const touch = () => {
          patch.live_updated_at = nowIso;
          patch.last_sync_at = nowIso;
        };
        if (fixture.status !== event.status) {
          patch.status = fixture.status;
          patch.phase = fixture.phase;
          patch.phase_label = fixture.phase_label;
          touch();
        }
        if (fixture.minute !== event.minute) {
          patch.minute = fixture.minute;
          touch();
        }
        if (fixture.home_score !== null && fixture.home_score !== event.home_score) {
          patch.home_score = fixture.home_score;
          touch();
        }
        if (fixture.away_score !== null && fixture.away_score !== event.away_score) {
          patch.away_score = fixture.away_score;
          touch();
        }
        if (fixture.reg_home_score !== null && fixture.reg_away_score !== null) {
          patch.reg_home_score = fixture.reg_home_score;
          patch.reg_away_score = fixture.reg_away_score;
        }
        if (fixture.extra_time) patch.extra_time = true;
        if (fixture.penalties) patch.penalties = true;

        if (fixture.finished) {
          finishedCount += 1;
          patch.status = 'finished';
          patch.tracking = 'finished';
          patch.published = false;
          patch.odds_status = 'unavailable';
          patch.result_confirmed_at = nowIso;
          patch.result_source = 'api_football';
          patch.next_check_at = null;
          if (event.settlement_state !== 'settled') patch.settlement_state = 'waiting';
        } else if (fixture.live) {
          liveCount += 1;
        }

        if (Object.keys(patch).length) {
          eventUpdates.push({ id: event.id, ...patch });
          updatedCount += 1;
        }

        const hasBets = openEventIds.has(event.id);
        const isFavorite = favoriteFixtureIds.has(fixture.fixture_id);
        const critical = isCriticalMinute(fixture.minute, settings) && !fixture.finished;
        const { priority, reason } = queuePriority({ hasBets, isFavorite, isCritical: critical });
        queueRows.push({
          fixture_id: fixture.fixture_id,
          event_id: event.id,
          home_team_name: event.home_team_name || fixture.home_team_name || '',
          away_team_name: event.away_team_name || fixture.away_team_name || '',
          competition_name: event.competition_name || fixture.competition_name || '',
          priority,
          reason,
          status: fixture.finished ? 'finished' : 'queued',
          has_bets: hasBets,
          is_favorite: isFavorite,
          is_critical: critical,
          score: fixture.home_score !== null && fixture.away_score !== null ? `${fixture.home_score}x${fixture.away_score}` : '',
          minute: fixture.minute,
          next_check_at: fixture.finished ? null : queueNextCheckAt(priority, settings, nowMs),
          last_checked_at: nowIso,
        });
      });

      for (const batch of chunkArray(eventUpdates, 200)) {
        if (batch.length) await db.Event.bulkUpdate(batch);
      }

      // Upsert da fila por fixture_id: atualiza a partida conhecida ou cria o registro.
      const existingQueue = new Map();
      const fixtureIds = queueRows.map((row) => row.fixture_id);
      for (const ids of chunkArray(fixtureIds, 100)) {
        const page = await db.MatchMonitorQueue.filter({ fixture_id: { $in: ids } }, { limit: ids.length + 10 });
        (page.items || []).forEach((row) => existingQueue.set(row.fixture_id, row));
      }
      const queueUpdates = [];
      const queueCreates = [];
      queueRows.forEach((row) => {
        const existing = existingQueue.get(row.fixture_id);
        if (existing) queueUpdates.push({ id: existing.id, ...row, checked_count: numberOr(existing.checked_count, 0) + 1 });
        else queueCreates.push({ ...row, checked_count: 1 });
      });
      for (const batch of chunkArray(queueUpdates, 200)) {
        if (batch.length) await db.MatchMonitorQueue.bulkUpdate(batch);
      }
      for (const batch of chunkArray(queueCreates, 100)) {
        if (batch.length) await db.MatchMonitorQueue.bulkCreate(batch);
      }

      const priorityCounts = { p1: 0, p2: 0, p3: 0, p4: 0 };
      queueRows.forEach((row) => {
        if (row.status !== 'queued') return;
        priorityCounts[`p${row.priority}`] += 1;
      });

      const summary = [
        'detector ao vivo',
        `${responseRows} partida(s) na fonte`,
        `${updatedCount} atualizada(s)`,
        `${liveCount} em andamento`,
        `${finishedCount} encerrada(s)`,
        `fila ${queueRows.length} (críticas ${priorityCounts.p4} · favoritas ${priorityCounts.p3} · com apostas ${priorityCounts.p2} · padrão ${priorityCounts.p1})`,
        `orçamento ${used}/${limit}`,
      ].join(' · ');

      const savedQuota = await saveQuota(db, quotaRecord, {
        ...(quotaRecord?.id ? {} : { day }),
        used,
        limit,
        level: quotaLevel(used, limit),
        ...quotaPatch,
        last_status_at: nowIso,
        last_status_code: 200,
        last_error: failures.join(' | ').slice(0, 400),
      });
      await releaseLock(db, savedQuota || quotaRecord);

      await db.ProviderSettings.update(settings.id, {
        football_last_live_at: nowIso,
        football_last_sync_at: nowIso,
        football_last_status: failures.length ? 'partial' : 'success',
        football_last_error: failures.length ? failures.join(' | ').slice(0, 400) : '',
        football_last_summary: summary,
        football_alert_level: quotaLevel(used, limit),
        football_next_run_at: new Date(nowMs + intervalMinutes * 60000).toISOString(),
      });

      await db.SyncJob.update(job.id, {
        status: failures.length ? 'partial' : 'success',
        finished_at: new Date().toISOString(),
        requests_used: 1,
        records_upserted: updatedCount + queueRows.length,
        error_message: failures.length ? failures.join(' | ').slice(0, 400) : '',
      });

      await db.ApiUsageLog.create({
        provider: 'api_football',
        endpoint: '/fixtures?live=all',
        status_code: 200,
        duration_ms: durationMs,
        records_returned: responseRows,
        cache_hit: false,
        credits_used: 1,
        params: `live=all · dia=${day}`,
        note: summary.slice(0, 240),
        error_message: failures.length ? failures.join(' | ').slice(0, 240) : '',
      });

      return Response.json({
        ok: true,
        calls: 1,
        source_matches: responseRows,
        events_updated: updatedCount,
        live_matches: liveCount,
        finished_matches: finishedCount,
        queue: { total: queueRows.length, ...priorityCounts },
        quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
        failures,
        summary,
      });
    } catch (error) {
      failures.push(String(error?.message || error));
      throw error;
    }
  } catch (error) {
    if (base44 && quotaRecord?.id) {
      await base44.asServiceRole.entities.ApiQuota
        .update(quotaRecord.id, { lock_until: null, lock_owner: '', last_error: String(error?.message || error).slice(0, 400) })
        .catch(() => null);
    }
    if (base44 && settings?.id) {
      await base44.asServiceRole.entities.ProviderSettings
        .update(settings.id, { football_last_status: 'error', football_last_error: String(error?.message || error).slice(0, 400) })
        .catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import {
  FOOTBALL_TIMEZONE,
  footballApiBase,
  mapFixture,
} from '../../shared/apiFootball.ts';
import {
  CADENCE_TOLERANCE_MS,
  FOOTBALL_CADENCE,
  FOOTBALL_CACHE_TTL,
  FOOTBALL_TTL,
  LIVE_CACHE_KEY,
} from '../../shared/footballConfig.ts';
import { isThrottleError, openFootballClient } from '../../shared/footballClient.ts';
import { saveLiveSnapshot } from '../../shared/footballLiveStore.ts';
import {
  DEFAULT_DAILY_LIMIT,
  acquireLock,
  canSpend,
  effectiveDailyLimit,
  loadQuota,
  lockHeld,
  quotaDayKey,
  quotaLevel,
  quotaPercent,
  quotaPolicy,
  releaseLock,
  saveQuota,
  writeCache,
} from '../../shared/footballQuota.ts';
import { LIVE_WINDOW_MS, chunkArray } from '../../shared/matchLifecycle.ts';
import { indexByFixtureId, numberOr } from '../../shared/footballSync.ts';
import { applyRelevancePatch, loadRelevanceConfig } from '../../shared/relevance.ts';
import { isBrazilianMatch } from '../../shared/brazilianCompetitions.ts';
import {
  isCriticalMinute,
  liveIntervalMinutes,
  queueNextCheckAt,
  queuePriority,
} from '../../shared/footballMonitor.ts';

const LOCK_MS = 90 * 1000;
/** Partidas por chamada em lote: limite documentado de /fixtures?ids. */
const IDS_PER_CALL = 20;
/** Teto de suspeitas confirmadas por execução, protegendo a cota diária. */
const MAX_SUSPECTS_PER_RUN = 100;

/**
 * Detector global de jogos ao vivo (GET /fixtures?live=all).
 *
 * Uma única chamada por execução detecta partidas iniciadas, atualiza
 * placares, minutos, status e tempo de jogo e mantém a fila de prioridades
 * (crítica / favorita / com apostas / padrão). Partidas que saem do feed ao
 * vivo sem o encerramento visto — o feed não devolve partidas encerradas —
 * são confirmadas em lote na hora (/fixtures?ids): nenhuma fica "ao vivo"
 * com placar congelado até a janela de 6 horas.
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
    // Qualquer usuário autenticado pode acionar o detector: a execução é
    // compartilhada e gated (intervalo, trava e orçamento), então milhares de
    // visitantes simultâneos continuam gerando no máximo uma chamada por
    // intervalo — nunca uma por pessoa.

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
    if (settings.football_paused) {
      return Response.json({ skipped: true, reason: 'Coleta pausada no Monitoramento da API' });
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
    // Cadência adaptativa: com partida em andamento vale o intervalo configurado
    // (padrão 60s); sem nada acontecendo o detector desacelera, porque consultar
    // a fonte a cada minuto sem jogos só consome cota.
    const intervalMinutesBase = liveIntervalMinutes(settings);
    const liveSignalIso = new Date(nowMs - FOOTBALL_TTL.liveSignal * 1000).toISOString();
    const liveNow = await db.Event.count({ status: 'live', live_updated_at: { $gte: liveSignalIso } });
    const intervalMinutes = liveNow > 0 ? intervalMinutesBase : FOOTBALL_CADENCE.liveIdleSeconds / 60;

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
    // Camada central de requisições: pausa pós-429, limite por minuto e
    // orçamento diário compartilhados com todas as outras rotinas.
    const client = await openFootballClient(db, {
      apiKey,
      base,
      settings,
      day,
      limit,
      reserve: policy.reserve,
      label: 'detector ao vivo',
    });

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
    if (Number.isFinite(lastLiveMs) && nowMs - lastLiveMs < intervalMinutes * 60000 - CADENCE_TOLERANCE_MS) {
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

    const callStartedAt = Date.now();
    let responseRows = 0;
    let fixtures = [];

    try {
      // Falha da fonte não é ausência de jogos: em pausa pós-429 ou limite por
      // minuto a execução para SEM tocar na aba ao vivo — os dados confirmados
      // permanecem e a próxima execução revalida quando a fonte voltar.
      let result;
      try {
        result = await client.call('/fixtures', { live: 'all' }, { timeoutMs: 25000, purpose: 'live' });
      } catch (error) {
        if (isThrottleError(error)) {
          const reason = String(error.message);
          await releaseLock(db, quotaRecord);
          await db.SyncJob.update(job.id, {
            status: 'partial',
            finished_at: new Date().toISOString(),
            error_message: reason.slice(0, 400),
          }).catch(() => null);
          await db.ProviderSettings.update(settings.id, {
            football_last_status: 'partial',
            football_last_error: reason.slice(0, 400),
          }).catch(() => null);
          return Response.json({
            skipped: true,
            reason,
            quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
          });
        }
        throw error;
      }
      used = client.used;
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
      const relevanceConfig = await loadRelevanceConfig(db);

      // FONTE ÚNICA: o coletor grava o retrato em live_fixtures e no cache de
      // 120 s. Monitoramento, liquidação e telas leem daqui — jamais do provedor.
      const eventByFixture = new Map();
      known.forEach((event, fixtureId) => eventByFixture.set(fixtureId, event.id));
      const betFixtureIds = new Set();
      eventByFixture.forEach((eventId, fixtureId) => {
        if (openEventIds.has(eventId)) betFixtureIds.add(fixtureId);
      });
      await saveLiveSnapshot(db, fixtures, nowIso, {
        eventByFixture,
        betFixtureIds,
        favoriteFixtureIds,
      }).catch(() => null);
      await writeCache(db, {
        key: LIVE_CACHE_KEY,
        endpoint: '/fixtures',
        params: 'live=all',
        ttlSeconds: FOOTBALL_CACHE_TTL.live,
        records: fixtures.length,
        note: `${fixtures.length} partida(s) no retrato ao vivo`,
      }).catch(() => null);

      /**
       * Patch comum de uma partida da fonte aplicada ao evento conhecido. Fase
       * e rótulo evoluem independentemente do status — durante a partida o
       * status permanece 'live' enquanto 1H → HT → 2H avançam, e o rótulo
       * precisa acompanhar o jogo. Encerradas e anuladas recebem o tratamento
       * completo: resultado confirmado, publicação encerrada e fila liberada.
       */
      const patchFromFixture = (fixture, event, { forceTouch = false } = {}) => {
        const patch = {};
        const touch = () => {
          patch.live_updated_at = nowIso;
          patch.last_sync_at = nowIso;
        };
        if (fixture.status !== event.status) {
          patch.status = fixture.status;
          touch();
        }
        if (fixture.phase !== event.phase || fixture.phase_label !== event.phase_label) {
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
        if (fixture.ht_home_score !== null && fixture.ht_away_score !== null) {
          if (fixture.ht_home_score !== event.ht_home_score || fixture.ht_away_score !== event.ht_away_score) {
            patch.ht_home_score = fixture.ht_home_score;
            patch.ht_away_score = fixture.ht_away_score;
            touch();
          }
        }
        if (fixture.season && fixture.season !== event.season) patch.season = fixture.season;
        if (
          fixture.reg_home_score !== null &&
          fixture.reg_away_score !== null &&
          (fixture.reg_home_score !== event.reg_home_score || fixture.reg_away_score !== event.reg_away_score)
        ) {
          patch.reg_home_score = fixture.reg_home_score;
          patch.reg_away_score = fixture.reg_away_score;
          touch();
        }
        if (fixture.extra_time) patch.extra_time = true;
        if (fixture.penalties) patch.penalties = true;
        if (fixture.finished) {
          patch.status = 'finished';
          patch.tracking = 'finished';
          patch.published = false;
          patch.odds_status = 'unavailable';
          patch.result_confirmed_at = nowIso;
          patch.result_source = 'api_football';
          patch.next_check_at = null;
          if (event.settlement_state !== 'settled') patch.settlement_state = 'waiting';
        } else if (fixture.void) {
          patch.status = fixture.status;
          patch.tracking = 'finished';
          patch.published = false;
          patch.odds_status = 'unavailable';
          patch.next_check_at = null;
        }
        if (fixture.review) patch.settlement_state = 'review';
        if (forceTouch) touch();
        return patch;
      };

      const eventUpdates = [];
      const queueRows = [];
      let liveCount = 0;
      let finishedCount = 0;
      let updatedCount = 0;
      let brazilianLiveCount = 0;

      fixtures.forEach((fixture) => {
        const event = known.get(fixture.fixture_id);
        if (!event) return;

        const patch = patchFromFixture(fixture, event);
        // Configuração centralizada de competições brasileiras: a seção Ao Vivo
        // lê esta marca, gravada aqui sem nenhuma consulta extra.
        const brazilian = isBrazilianMatch({
          leagueId: event.league_id || fixture.competition_id,
          country: event.country || fixture.country,
          competitionName: event.competition_name || fixture.competition_name,
        });
        if (brazilian !== Boolean(event.is_brazilian)) patch.is_brazilian = brazilian;
        if (brazilian && !fixture.finished) brazilianLiveCount += 1;
        // Relevância: partida ao vivo sobe no componente de importância —
        // recálculo puro a partir dos dados já gravados, sem novas chamadas.
        applyRelevancePatch(
          patch,
          {
            ...event,
            league_id: event.league_id || fixture.competition_id,
            competition_name: event.competition_name || fixture.competition_name,
            country: event.country || fixture.country,
          },
          relevanceConfig,
          { isLive: !fixture.finished },
        );
        if (fixture.finished) finishedCount += 1;
        else if (fixture.live) liveCount += 1;

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

      /* --------- suspeitas: saíram do feed ao vivo sem o FT visto --------- */
      // O feed live=all não devolve partidas encerradas: quando a partida sai
      // do feed, ela ficaria "ao vivo" com placar congelado até a janela de 6
      // horas — a auditoria de rotina só alcança partidas com cotação ou aposta
      // pendente. Toda suspeita é confirmada em lote na hora e o resultado
      // correto chega em minutos, não em horas.
      let suspectsQueued = 0;
      let suspectsConfirmed = 0;
      let suspectsFinished = 0;
      const suspectFixtureIds = new Map();
      if (!result.errors.length) {
        // 1) Fila: partidas monitoradas que não vieram no feed desta execução.
        const seenIds = new Set(fixtures.map((fixture) => fixture.fixture_id));
        const goneQueueUpdates = [];
        let goneCursor = null;
        for (let round = 0; round < 4; round += 1) {
          const page = await db.MatchMonitorQueue.filter(
            { status: { $in: ['queued', 'live'] } },
            { limit: 500, ...(goneCursor ? { cursor: goneCursor } : {}) },
          );
          (page.items || []).forEach((row) => {
            if (seenIds.has(row.fixture_id) || !row.fixture_id || !row.event_id) return;
            goneQueueUpdates.push({
              id: row.id,
              status: 'removed',
              reason: 'saiu do feed ao vivo',
              next_check_at: null,
              last_checked_at: nowIso,
            });
            suspectFixtureIds.set(row.fixture_id, row.event_id);
          });
          goneCursor = page.next_cursor;
          if (!page.has_more) break;
        }
        if (goneQueueUpdates.length) {
          for (const batch of chunkArray(goneQueueUpdates, 200)) await db.MatchMonitorQueue.bulkUpdate(batch);
        }

        // 2) Rede de segurança: partida "ao vivo" sem atualização há 45 minutos
        // também é suspeita — cobre falhas da fila e do próprio detector.
        const staleLiveIso = new Date(nowMs - 45 * 60000).toISOString();
        const staleFloorIso = new Date(nowMs - LIVE_WINDOW_MS).toISOString();
        let staleCursor = null;
        for (let round = 0; round < 4; round += 1) {
          const page = await db.Event.filter(
            {
              source: 'provider',
              status: 'live',
              start_time: { $gte: staleFloorIso, $lt: staleLiveIso },
              live_updated_at: { $lt: staleLiveIso },
            },
            { limit: 200, sort: 'start_time', ...(staleCursor ? { cursor: staleCursor } : {}) },
          );
          (page.items || []).forEach((row) => {
            if (row.fixture_id) suspectFixtureIds.set(row.fixture_id, row.id);
          });
          staleCursor = page.next_cursor;
          if (!page.has_more || suspectFixtureIds.size >= MAX_SUSPECTS_PER_RUN) break;
        }
      }

      // Confirmação em lote: até 20 suspeitas por chamada, teto por execução.
      const suspectIds = [...suspectFixtureIds.keys()].slice(0, MAX_SUSPECTS_PER_RUN);
      suspectsQueued = suspectIds.length;
      if (suspectIds.length) {
        const suspectEvents = new Map();
        for (const ids of chunkArray(suspectIds, 100)) {
          const page = await db.Event.filter(
            { fixture_id: { $in: ids }, status: { $in: ['scheduled', 'live'] } },
            { limit: ids.length + 5 },
          );
          (page.items || []).forEach((row) => suspectEvents.set(row.fixture_id, row));
        }
        for (const batch of chunkArray(suspectIds, IDS_PER_CALL)) {
          if (!canSpend(used, limit, policy.reserve, 1)) break;
          const confirmStartedAt = Date.now();
          try {
            const confirmResult = await client.call('/fixtures', { ids: batch.join('-') }, { purpose: 'live_confirm' });
            used = client.used;
            if (confirmResult.errors.length) {
              failures.push(`confirmação: ${confirmResult.errors.join(' | ')}`);
              break;
            }
            const response = Array.isArray(confirmResult.data?.response) ? confirmResult.data.response : [];
            const byId = new Map(response.map((row) => [String(row?.fixture?.id), row]));
            const confirmUpdates = [];
            batch.forEach((fixtureId) => {
              const event = suspectEvents.get(fixtureId);
              if (!event) return;
              const raw = byId.get(String(fixtureId));
              const fixture = raw ? mapFixture(raw) : null;
              if (!fixture) {
                // Sem retorno do provedor: registra a checagem e deixa a
                // janela de 6 horas encerrar depois — resultado não é inventado.
                confirmUpdates.push({ id: event.id, live_updated_at: nowIso, last_sync_at: nowIso });
                return;
              }
              suspectsConfirmed += 1;
              const patch = patchFromFixture(fixture, event, { forceTouch: true });
              if (fixture.finished) {
                suspectsFinished += 1;
                patch.audit_checks = numberOr(event.audit_checks, 0) + 1;
              }
              confirmUpdates.push({ id: event.id, ...patch });
            });
            for (const inner of chunkArray(confirmUpdates, 200)) {
              if (inner.length) await db.Event.bulkUpdate(inner);
            }
            await db.ApiUsageLog.create({
              provider: 'api_football',
              endpoint: `/fixtures?ids=${batch.length}`,
              status_code: 200,
              duration_ms: Date.now() - confirmStartedAt,
              records_returned: response.length,
              cache_hit: false,
              credits_used: 1,
              params: `confirmação de suspeitas · dia=${day}`,
              note: `${batch.length} suspeita(s) confirmada(s) · ${suspectsFinished} encerrada(s)`,
              error_message: '',
            });
          } catch (error) {
            failures.push(`confirmação: ${String(error?.message || error)}`);
            break;
          }
        }
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
        `${brazilianLiveCount} brasileira(s)`,
        `${finishedCount} encerrada(s)`,
        `fila ${queueRows.length} (críticas ${priorityCounts.p4} · favoritas ${priorityCounts.p3} · com apostas ${priorityCounts.p2} · padrão ${priorityCounts.p1})`,
        `suspeitas ${suspectsQueued} · ${suspectsFinished} encerrada(s) na confirmação`,
        `orçamento ${used}/${limit}`,
      ].join(' · ');

      const savedQuota = await saveQuota(db, quotaRecord, {
        ...(quotaRecord?.id ? {} : { day }),
        used,
        limit,
        level: quotaLevel(used, limit),
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
        brazilian_live_matches: brazilianLiveCount,
        finished_matches: finishedCount,
        queue: { total: queueRows.length, ...priorityCounts },
        suspects: { queued: suspectsQueued, confirmed: suspectsConfirmed, finished: suspectsFinished },
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
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { FOOTBALL_TIMEZONE, footballApiBase, mapFixture } from '../../shared/apiFootball.ts';
import { isThrottleError, openFootballClient } from '../../shared/footballClient.ts';
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
} from '../../shared/footballQuota.ts';
import { chunkArray, markStartedEventsLive } from '../../shared/matchLifecycle.ts';
import { numberOr } from '../../shared/footballSync.ts';
import {
  IDS_PER_RESULT_CALL,
  LIVE_STALE_MS,
  MAX_FIXTURES_PER_RUN,
  MAX_RESULT_ATTEMPTS,
  auditPriorityFor,
  buildResultPatch,
  closeAuditQueueRows,
  firstAttemptAt,
  groupPendingByEvent,
  hasConfirmedResult,
  isVoidEvent,
  loadEventsByIds,
  nextAttemptAt,
  syncAuditQueue,
} from '../../shared/pendingResults.ts';
import { settlePendingBets } from '../../shared/settlement.ts';

const LOCK_MS = 3 * 60 * 1000;

/**
 * Auditoria de resultados pendentes.
 *
 * Consulta a API-Football **somente** para partidas que possuem apostas sem
 * liquidação e cujo resultado ainda não está confirmado no banco. As apostas
 * são agrupadas por evento e os eventos pelo `fixture_id`: uma partida com 200
 * apostas gera uma consulta, nunca 200. Resultado confirmado é reutilizado por
 * todos os bilhetes e nunca é consultado de novo.
 *
 * Nada aqui cria uma integração paralela: todas as chamadas externas passam
 * pelo cliente central (cota por minuto, orçamento diário, pausa pós-429).
 */
export default async function (req) {
  let base44;
  let quotaRecord = null;
  let settings = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((error) => (error.status === 401 ? null : Promise.reject(error)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
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

    // 1) Fechamento de apostas e reconciliação de status: somente banco, sem API.
    const startedIds = await markStartedEventsLive(db, nowIso);

    // 2) Pendências agrupadas: uma linha por partida, com apostas e bilhetes.
    const pending = await groupPendingByEvent(db);
    const pendingEventIds = [...pending.keys()];

    if (!pendingEventIds.length) {
      const removed = await closeAuditQueueRows(db, []);
      await db.SyncJob.create({
        provider: 'api_football',
        trigger: payload?.trigger === 'manual' ? 'manual' : 'scheduled',
        job_type: 'results_audit',
        status: 'success',
        started_at: nowIso,
        finished_at: nowIso,
        requests_used: 0,
        records_upserted: 0,
        error_message: '',
        triggered_by: user.email,
        note: `fila vazia · ${removed} linha(s) encerrada(s)`,
      }).catch(() => null);
      return Response.json({
        ok: true,
        calls: 0,
        reason: 'Nenhuma aposta pendente na plataforma',
        queue: { removed },
        started_events: startedIds.length,
      });
    }

    const events = await loadEventsByIds(db, pendingEventIds);

    // Linhas já existentes: preservam o histórico de tentativas de cada partida.
    const existingRows = new Map();
    const pendingFixtureIds = [];
    pending.forEach((info, eventId) => {
      const event = events.get(eventId);
      if (event?.fixture_id) pendingFixtureIds.push(event.fixture_id);
    });
    for (const ids of chunkArray(pendingFixtureIds, 100)) {
      const page = await db.ResultAuditQueue.filter({ fixture_id: { $in: ids } }, { limit: ids.length + 5 });
      (page.items || []).forEach((row) => existingRows.set(row.fixture_id, row));
    }

    // 3) Classificação: resultado confirmado é reutilizado sem nenhuma consulta.
    const queueRows = new Map();
    const settlementEvents = [];
    const candidates = [];

    for (const [eventId, info] of pending) {
      const event = events.get(eventId);
      if (!event) continue;
      const fixtureId = event.fixture_id || '';
      const existing = fixtureId ? existingRows.get(fixtureId) : null;
      const attempts = numberOr(existing?.attempts, 0);
      const confirmed = hasConfirmedResult(event);
      const voided = isVoidEvent(event);
      const liveFresh =
        event.status === 'live' && Date.parse(event.live_updated_at || '') >= nowMs - LIVE_STALE_MS;
      const priority = auditPriorityFor(event, attempts);

      const base = {
        fixture_id: fixtureId,
        event_id: event.id,
        home_team_name: event.home_team_name || '',
        away_team_name: event.away_team_name || '',
        competition_name: event.competition_name || '',
        match_status: event.status,
        priority,
        pending_selections: info.selections,
        pending_tickets: info.tickets.size,
        market_keys: [...info.markets].filter(Boolean).join(',').slice(0, 200),
        attempts,
        last_error: '',
      };

      if (confirmed || voided) {
        // Resultado guardado: a partida sai da fila e entra na liquidação.
        settlementEvents.push(event);
        queueRows.set(fixtureId || event.id, {
          ...base,
          status: 'confirmed',
          result_state: 'confirmed',
          next_attempt_at: null,
          score:
            Number.isFinite(Number(event.home_score)) && Number.isFinite(Number(event.away_score))
              ? `${event.home_score}x${event.away_score}`
              : '',
        });
        continue;
      }

      if (attempts >= MAX_RESULT_ATTEMPTS) {
        // Sem resultado depois de várias tentativas: decide um humano.
        settlementEvents.push(event);
        queueRows.set(fixtureId || event.id, {
          ...base,
          status: 'confirmed',
          result_state: 'review',
          next_attempt_at: null,
        });
        continue;
      }

      if (liveFresh) {
        // Partida em andamento já atualizada pelo detector ao vivo: sem consulta.
        queueRows.set(fixtureId || event.id, {
          ...base,
          status: 'pending',
          result_state: 'pending',
          next_attempt_at: existing?.next_attempt_at || nextAttemptAt(3, attempts, nowMs),
        });
        continue;
      }

      const firstAt = firstAttemptAt(event, settings, nowMs);
      if (event.status === 'scheduled' && Date.parse(firstAt) > nowMs) {
        // Partida futura: só é consultada perto do encerramento previsto.
        queueRows.set(fixtureId || event.id, {
          ...base,
          status: 'pending',
          result_state: 'pending',
          next_attempt_at: firstAt,
        });
        continue;
      }

      if (!fixtureId) {
        // Evento sem vínculo com a fonte: nada a consultar.
        queueRows.set(event.id, { ...base, status: 'pending', result_state: 'unavailable', next_attempt_at: null });
        continue;
      }

      const dueAt = Date.parse(existing?.next_attempt_at || '');
      const due = !Number.isFinite(dueAt) || dueAt <= nowMs;
      queueRows.set(fixtureId, {
        ...base,
        status: 'pending',
        result_state: 'pending',
        next_attempt_at: existing?.next_attempt_at || nowIso,
      });
      if (due) candidates.push({ event, attempts, priority });
    }

    /* ------------------- 4) consulta em lote dos resultados ------------------- */
    const failures = [];
    let used = 0;
    let calls = 0;
    let confirmedNow = 0;
    let unavailableNow = 0;
    let reviewNow = 0;
    let throttledReason = '';
    const audited = candidates.slice(0, MAX_FIXTURES_PER_RUN);

    if (audited.length) {
      const apiKey = secrets.get('API_FOOTBALL_KEY');
      if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
      const base = footballApiBase(settings);
      const limitSetting = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
      quotaRecord = await loadQuota(db, day);
      const limit = effectiveDailyLimit(limitSetting, quotaRecord?.provider_limit);
      if (lockHeld(quotaRecord, nowMs)) {
        return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
      }
      quotaRecord = await acquireLock(db, quotaRecord, day, 'auditarResultadosPendentes', LOCK_MS);
      used = numberOr(quotaRecord?.used, 0);
      const level = quotaLevel(used, limit);
      const policy = quotaPolicy(level);

      const client = await openFootballClient(db, {
        apiKey,
        base,
        settings,
        day,
        limit,
        reserve: policy.reserve,
        label: 'auditoria de resultados',
      });

      for (const batch of chunkArray(audited, IDS_PER_RESULT_CALL)) {
        if (throttledReason || !canSpend(client.used, limit, policy.reserve, 1)) {
          throttledReason = throttledReason || 'Orçamento diário reservado atingido';
          break;
        }
        const ids = batch.map((item) => item.event.fixture_id);
        try {
          const result = await client.call('/fixtures', { ids: ids.join('-') }, { purpose: 'results_audit' });
          calls += 1;
          used = client.used;
          if (result.errors?.length) {
            failures.push(result.errors.join(' | '));
            break;
          }
          const response = Array.isArray(result.data?.response) ? result.data.response : [];
          const byFixture = new Map(response.map((row) => [String(row?.fixture?.id), row]));
          const patches = [];

          for (const item of batch) {
            const { event } = item;
            const raw = byFixture.get(String(event.fixture_id));
            const fixture = raw ? mapFixture(raw) : null;
            const attempts = item.attempts + 1;
            const row = queueRows.get(event.fixture_id);
            const patch = buildResultPatch(fixture, event, nowIso);
            patches.push({ id: event.id, ...patch });

            const updated = { ...event, ...patch };
            const nextRow = {
              ...(row || {}),
              fixture_id: event.fixture_id,
              event_id: event.id,
              attempts,
              last_attempt_at: nowIso,
              match_status: updated.status,
              pending_selections: pending.get(event.id)?.selections || 0,
              pending_tickets: pending.get(event.id)?.tickets.size || 0,
            };

            if (fixture?.finished || fixture?.void) {
              confirmedNow += 1;
              settlementEvents.push(updated);
              queueRows.set(event.fixture_id, {
                ...nextRow,
                status: 'confirmed',
                result_state: 'confirmed',
                last_error: '',
                next_attempt_at: null,
                score:
                  fixture.home_score !== null && fixture.away_score !== null
                    ? `${fixture.home_score}x${fixture.away_score}`
                    : '',
              });
            } else if (fixture?.review) {
              reviewNow += 1;
              settlementEvents.push(updated);
              queueRows.set(event.fixture_id, {
                ...nextRow,
                status: 'confirmed',
                result_state: 'review',
                last_error: '',
                next_attempt_at: null,
              });
            } else {
              unavailableNow += 1;
              queueRows.set(event.fixture_id, {
                ...nextRow,
                status: 'pending',
                result_state: 'unavailable',
                last_error: fixture ? `resultado ainda não disponível (${fixture.phase_label || fixture.phase})` : 'sem retorno do provedor',
                next_attempt_at: nextAttemptAt(auditPriorityFor(updated, attempts), attempts, nowMs),
              });
            }
          }
          for (const chunk of chunkArray(patches, 200)) {
            if (chunk.length) await db.Event.bulkUpdate(chunk);
          }
          await db.ApiUsageLog.create({
            provider: 'api_football',
            endpoint: `/fixtures?ids=${ids.length}`,
            status_code: 200,
            duration_ms: 0,
            records_returned: response.length,
            cache_hit: false,
            credits_used: 1,
            params: `auditoria de resultados · dia=${day}`,
            note: `${ids.length} partida(s) com apostas pendentes`,
            error_message: '',
          }).catch(() => null);
        } catch (error) {
          failures.push(`auditoria: ${String(error?.message || error)}`);
          if (isThrottleError(error)) throttledReason = String(error?.message || error);
          break;
        }
      }

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
    }

    // 5) Liquidação: tudo que já tem resultado confirmado no banco, sem consulta.
    const settlement = await settlePendingBets(db, {
      nowIso,
      events: settlementEvents,
    });

    // 6) Fila: grava o estado atual e retira quem não tem mais pendência.
    const rows = [...queueRows.values()].filter((row) => row.fixture_id);
    const written = await syncAuditQueue(db, rows);
    const activeFixtureIds = rows
      .filter((row) => row.status === 'pending' && row.result_state !== 'review')
      .map((row) => row.fixture_id);
    const removed = await closeAuditQueueRows(db, activeFixtureIds);

    const remaining = rows.filter((row) => row.status === 'pending').length;
    const summary = [
      'auditoria de resultados',
      `${pending.size} partida(s) com apostas pendentes`,
      `${calls} consulta(s) em lote`,
      `${audited.length} partida(s) consultada(s)`,
      `${confirmedNow} resultado(s) confirmado(s)`,
      `${unavailableNow} ainda indisponível(is)`,
      `${settlement.selections_settled} seleção(ões) liquidada(s)`,
      `${settlement.tickets_settled} boletim(ns)`,
      `${remaining} na fila`,
      throttledReason ? `parada: ${throttledReason.slice(0, 80)}` : `orçamento ${used}`,
    ].join(' · ');

    await db.ProviderSettings.update(settings.id, {
      football_last_status: failures.length || throttledReason ? 'partial' : 'success',
      football_last_error: [...failures, throttledReason].filter(Boolean).join(' | ').slice(0, 400),
      football_last_summary: summary,
    }).catch(() => null);

    await db.SyncJob.create({
      provider: 'api_football',
      trigger: payload?.trigger === 'manual' ? 'manual' : 'scheduled',
      job_type: 'results_audit',
      status: failures.length || throttledReason ? 'partial' : 'success',
      started_at: nowIso,
      finished_at: new Date().toISOString(),
      requests_used: calls,
      records_upserted: settlement.selections_settled,
      error_message: [...failures, throttledReason].filter(Boolean).join(' | ').slice(0, 400),
      triggered_by: user.email,
      note: summary.slice(0, 240),
    }).catch(() => null);

    return Response.json({
      ok: true,
      calls,
      started_events: startedIds.length,
      fixtures_pending: pending.size,
      fixtures_queried: audited.length,
      fixtures_with_confirmed_result: rows.filter((row) => row.status === 'confirmed').length,
      results_confirmed: confirmedNow,
      results_unavailable: unavailableNow,
      results_review: reviewNow,
      pending_selections: [...pending.values()].reduce((total, info) => total + info.selections, 0),
      pending_tickets: new Set([...pending.values()].flatMap((info) => [...info.tickets])).size,
      settlement,
      queue: { ...written, removed, remaining },
      quota: { used, percent: quotaPercent(used, numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT)), level: quotaLevel(used, numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT)) },
      failures,
      throttled: throttledReason,
      summary,
    });
  } catch (error) {
    if (base44 && quotaRecord?.id) {
      await base44.asServiceRole.entities.ApiQuota
        .update(quotaRecord.id, { lock_until: null, lock_owner: '', last_error: String(error?.message || error).slice(0, 400) })
        .catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
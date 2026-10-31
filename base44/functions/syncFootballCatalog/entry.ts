import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { secrets } from 'base44:runtime';
import { FOOTBALL_TIMEZONE, footballApiBase } from '../../shared/apiFootball.ts';
import { isThrottleError, openFootballClient } from '../../shared/footballClient.ts';
import { syncBetCatalog, syncBookmakerCatalog } from '../../shared/footballCatalog.ts';
import {
  DEFAULT_DAILY_LIMIT,
  acquireLock,
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
import { numberOr } from '../../shared/footballSync.ts';

const LOCK_MS = 2 * 60 * 1000;
const RESERVE_CALLS = 6;

/**
 * Sincroniza o catálogo oficial do provedor: casas de apostas
 * (`/odds/bookmakers`) e bets liberados pelo plano (`/odds/bets`).
 *
 * Nenhum ID é presumido no código — o catálogo é lido da própria API e gravado
 * no banco. A seleção de quais casas servem de referência de preço é feita no
 * painel e preservada a cada sincronização. Ação administrativa: consome no
 * máximo 2 requisições e nunca roda automaticamente.
 */
export default async function (req) {
  let base44;
  let quotaRecord = null;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((error) => (error.status === 401 ? null : Promise.reject(error)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const db = base44.asServiceRole.entities;
    const payload = await req.json().catch(() => ({}));
    const requested = String(payload?.action || 'all');
    const action = ['bookmakers', 'bets', 'all'].includes(requested) ? requested : 'all';

    const now = new Date();
    const day = quotaDayKey(now, FOOTBALL_TIMEZONE);

    const settingsPage = await db.ProviderSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || null;
    if (!settings) return Response.json({ skipped: true, reason: 'Configuração do provedor não encontrada' });
    if (settings.football_paused) {
      return Response.json({ skipped: true, reason: 'Coleta pausada no Monitoramento da API' });
    }

    const apiKey = secrets.get('API_FOOTBALL_KEY');
    if (!apiKey) return Response.json({ skipped: true, reason: 'Chave da API-Football não configurada' });
    const base = footballApiBase(settings);

    let limit = numberOr(settings.football_daily_limit, DEFAULT_DAILY_LIMIT);
    quotaRecord = await loadQuota(db, day);
    limit = effectiveDailyLimit(limit, quotaRecord?.provider_limit);
    if (lockHeld(quotaRecord, Date.now())) {
      return Response.json({ skipped: true, reason: 'Outra sincronização está em andamento' });
    }
    quotaRecord = await acquireLock(db, quotaRecord, day, 'syncFootballCatalog', LOCK_MS);

    const level = quotaLevel(numberOr(quotaRecord?.used, 0), limit);
    if (level === 3) {
      await releaseLock(db, quotaRecord);
      return Response.json({ skipped: true, reason: 'Orçamento da API-Football esgotado (contingência)' });
    }
    const policy = quotaPolicy(level);

    const client = await openFootballClient(db, {
      apiKey,
      base,
      settings,
      day,
      limit,
      reserve: RESERVE_CALLS,
      label: 'catálogo do provedor',
    });

    const job = await db.SyncJob.create({
      provider: 'api_football',
      trigger: 'manual',
      job_type: 'catalog',
      status: 'running',
      started_at: now.toISOString(),
      triggered_by: user.email,
    });

    const failures = [];
    let bookmakers = null;
    let bets = null;
    let throttled = false;

    if (action === 'bookmakers' || action === 'all') {
      try {
        bookmakers = await syncBookmakerCatalog(db, client);
        if (bookmakers.errors?.length) failures.push(bookmakers.errors.join(' | '));
        if (bookmakers.empty) failures.push('catálogo de casas vazio na resposta do provedor');
      } catch (error) {
        failures.push(`casas: ${String(error?.message || error)}`);
        if (isThrottleError(error)) throttled = true;
      }
    }

    if ((action === 'bets' || action === 'all') && !throttled) {
      try {
        bets = await syncBetCatalog(db, client);
        if (bets.errors?.length) failures.push(bets.errors.join(' | '));
      } catch (error) {
        failures.push(`bets: ${String(error?.message || error)}`);
        if (isThrottleError(error)) throttled = true;
      }
    }

    const used = numberOr(client.used, 0);
    const savedQuota = await saveQuota(db, quotaRecord, {
      used,
      limit,
      level: quotaLevel(used, limit),
      last_status_at: new Date().toISOString(),
      last_error: failures.join(' | ').slice(0, 400),
    });
    await releaseLock(db, savedQuota || quotaRecord);

    const summary = [
      'catálogo do provedor',
      bookmakers ? `${bookmakers.total} casa(s) · ${bookmakers.enabled} selecionada(s)` : 'casas não sincronizadas',
      bets ? `${bets.provider_bets} bet(s) · ${bets.available} mercado(s) do app disponíveis` : 'mercados não sincronizados',
      `orçamento ${used}/${limit}`,
    ].join(' · ');

    await db.SyncJob.update(job.id, {
      status: throttled ? 'skipped' : failures.length ? 'partial' : 'success',
      finished_at: new Date().toISOString(),
      requests_used: numberOr(quotaRecord?.call_count, 0),
      records_upserted: numberOr(bookmakers?.created, 0) + numberOr(bookmakers?.updated, 0),
      error_message: failures.join(' | ').slice(0, 400),
      note: summary.slice(0, 400),
    });

    return Response.json({
      ok: !failures.length,
      action,
      bookmakers,
      bets,
      quota: { used, limit, percent: quotaPercent(used, limit), level: quotaLevel(used, limit) },
      policy,
      throttled: throttled ? 'limite do provedor sinalizado' : '',
      failures,
      summary,
    });
  } catch (error) {
    if (base44 && quotaRecord?.id) {
      await base44.asServiceRole.entities.ApiQuota
        .update(quotaRecord.id, {
          lock_until: null,
          lock_owner: '',
          last_error: String(error?.message || error).slice(0, 400),
        })
        .catch(() => null);
    }
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
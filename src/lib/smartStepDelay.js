/**
 * Espera adaptativa entre as etapas do ciclo completo do painel.
 *
 * A decisão vem da própria resposta da rotina já executada — nada de chamadas
 * novas ao provedor: quanto do orçamento foi consumido, se a etapa foi ignorada
 * e se o provedor sinalizou limite de consultas.
 */

/** Espera mínima entre etapas (ms). */
export const STEP_GAP_MIN_MS = 4000;
/** Espera quando a etapa anterior rodou normalmente (ms). */
export const STEP_GAP_DEFAULT_MS = 9000;
/** Teto da espera, usado também quando o limite é sinalizado (ms). */
export const STEP_GAP_MAX_MS = 45000;

const LIMIT_SIGNALS = [/429/, /limite excedido/i, /rate.?limit/i, /muitas requisi/i, /throttl/i];
const HALT_SIGNALS = [...LIMIT_SIGNALS, /cotaç(ões|ao) suspensa/i, /conting[êe]ncia/i];

const textOf = (value) => (Array.isArray(value) ? value.join(' ') : String(value || ''));

/** Textos da resposta que podem indicar bloqueio do provedor. */
export function stepText(payload) {
  if (!payload) return '';
  return [payload.error, payload.reason, payload.summary, textOf(payload.failures), textOf(payload.errors)]
    .filter(Boolean)
    .join(' | ');
}

export function matchesSignal(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classifica o retorno de uma rotina:
 * `error` falhou · `throttled` bateu no limite do provedor ·
 * `skipped` nada foi consultado · `ok` executou normalmente.
 */
export function classifyStep(payload) {
  if (payload?.error) return 'error';
  const text = stepText(payload);
  if (payload?.pages_limited || payload?.rate_limited || matchesSignal(text, LIMIT_SIGNALS)) return 'throttled';
  if (payload?.skipped) return 'skipped';
  return 'ok';
}

/** Limite sinalizado ou contingência de orçamento: as etapas restantes param. */
export function shouldHalt(payload) {
  if (!payload || payload.error) return false;
  return classifyStep(payload) === 'throttled'
    || (Boolean(payload.skipped) && matchesSignal(stepText(payload), HALT_SIGNALS));
}

/** Pressão de consumo (0 a 1) a partir do orçamento informado pela rotina. */
export function consumptionPressure(payload) {
  const quota = payload?.quota || payload?.consumption || null;
  const used = Number(quota?.used);
  const limit = Number(quota?.limit);
  const percent = Number(
    quota?.percent ?? (Number.isFinite(used) && limit > 0 ? (used / limit) * 100 : NaN),
  );
  if (!Number.isFinite(percent)) return 0;
  if (percent >= 80) return 1;
  if (percent >= 60) return 0.6;
  if (percent >= 40) return 0.3;
  return 0;
}

/**
 * Espera até a próxima etapa: cresce com o consumo do orçamento e com sinal de
 * limite, e encurta quando a etapa anterior já demorou o suficiente para
 * espaçar as chamadas sozinha.
 */
export function nextStepWait({ payload, outcome, elapsedMs = 0 }) {
  if (outcome === 'throttled') return STEP_GAP_MAX_MS;
  const base = outcome === 'skipped' ? STEP_GAP_MIN_MS : STEP_GAP_DEFAULT_MS;
  const pressure = consumptionPressure(payload);
  const target = Math.min(STEP_GAP_MAX_MS, base + pressure * (STEP_GAP_MAX_MS - base));
  const remaining = target - Math.min(elapsedMs, target - STEP_GAP_MIN_MS);
  return Math.max(STEP_GAP_MIN_MS, Math.round(remaining));
}

/** Aguarda `ms` informando o tempo restante (segundos) a cada segundo. */
export function waitWithCountdown(ms, onTick) {
  return new Promise((resolve) => {
    const endsAt = Date.now() + ms;
    onTick(Math.ceil(ms / 1000));
    const timer = setInterval(() => {
      const remaining = Math.ceil((endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(timer);
        onTick(0);
        resolve();
        return;
      }
      onTick(remaining);
    }, 1000);
  });
}
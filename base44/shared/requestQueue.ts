/**
 * Fila serializada de requisições externas (API-Football).
 *
 * Uma única fila por execução garante três coisas que a API-Football exige:
 *
 * - **serialização**: nunca duas chamadas ao provedor ao mesmo tempo;
 * - **espaçamento mínimo** entre chamadas consecutivas (`gapMs`, 200 ms), o que
 *   sozinho limita o ritmo a 5 req/s = 300 req/min, o teto do plano Pro;
 * - **prioridade**: quando há fila, placar ao vivo e apuração de resultado
 *   passam na frente de cotações e insights — se for preciso selecionar, o que
 *   é crítico para os jogos é atendido primeiro.
 *
 * A fila é o primeiro filtro (barato, em memória). O controle de cota,
 * a pausa pós-429 e a leitura de X-RateLimit-Remaining continuam no cliente
 * central (footballClient), que é quem conhece o estado do dia.
 */

import { MIN_CALL_GAP_MS } from './footballConfig.ts';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Prioridade por finalidade (menor número é atendido antes).
 * Placar ao vivo e resultados primeiro: são eles que movem os jogos.
 */
const PURPOSE_PRIORITY: Record<string, number> = {
  live: 10,
  live_confirm: 15,
  audit: 20,
  results_audit: 20,
  statistics: 30,
  events: 30,
  calendar: 40,
  odds: 50,
  insights: 60,
  validate: 60,
  discover: 60,
};

const DEFAULT_PRIORITY = 45;

/** Prioridade numérica de uma chamada, considerando a marca de urgência da partida. */
export function priorityFor(purpose: string, urgency?: string) {
  if (String(urgency || '').toUpperCase() === 'CRITICA') return 5;
  return PURPOSE_PRIORITY[String(purpose || '').toLowerCase()] ?? DEFAULT_PRIORITY;
}

type Job = {
  priority: number;
  run: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

export class RequestQueue {
  private readonly gapMs: number;
  private lastFinishedAt = 0;
  private jobs: Job[] = [];
  private draining = false;

  constructor(gapMs: number) {
    this.gapMs = Math.max(0, Number(gapMs) || 0);
  }

  /** Enfileira uma chamada e devolve o resultado dela. */
  push<T>(priority: number, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ priority, run: task, resolve, reject });
      this.jobs.sort((a, b) => a.priority - b.priority);
      this.drain();
    });
  }

  /** Processa a fila em série, respeitando o espaçamento mínimo entre chamadas. */
  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift() as Job;
        const waitMs = this.lastFinishedAt + this.gapMs - Date.now();
        if (waitMs > 0) await sleep(waitMs);
        try {
          job.resolve(await job.run());
        } catch (error) {
          job.reject(error);
        }
        this.lastFinishedAt = Date.now();
      }
    } finally {
      this.draining = false;
    }
  }
}

/**
 * Fila compartilhada por todas as rotinas acionadas na mesma execução.
 * O espaçamento vem do teto do plano (300/min → 200 ms), em footballConfig.
 */
const sharedQueue = new RequestQueue(MIN_CALL_GAP_MS);

export function requestQueue() {
  return sharedQueue;
}
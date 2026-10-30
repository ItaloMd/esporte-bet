import React from "react";
import { Radio, Timer, Scale, Database } from "lucide-react";

const PRIORITIES = [
  { key: "CRITICA", label: "Crítica", cadence: "60 s", rule: "Partida em andamento (IN_PLAY)" },
  { key: "FAVORITA", label: "Favorita", cadence: "120 s", rule: "Partida marcada pelo jogador" },
  { key: "APOSTA_ABERTA", label: "Aposta aberta", cadence: "180 s", rule: "Bilhete pendente na partida" },
  { key: "NORMAL", label: "Normal", cadence: "300 s", rule: "Demais partidas da grade do dia" },
];

const BUDGET = [
  { label: "Ao vivo", share: "40%", hint: "coletor único" },
  { label: "Cotações", share: "30%", hint: "fila prioritária" },
  { label: "Apuração", share: "20%", hint: "resultados e estatísticas" },
  { label: "Emergência", share: "10%", hint: "reserva intocável" },
];

const CACHE = [
  { label: "live_fixtures", ttl: "120 s" },
  { label: "odds", ttl: "300 s" },
  { label: "predictions", ttl: "24 h" },
  { label: "standings", ttl: "12 h" },
  { label: "team/player statistics", ttl: "24 h" },
];

function Block({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        <p className="text-xs font-semibold">{title}</p>
      </div>
      {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

export default function CollectionArchitecture() {
  return (
    <section className="card-surface space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Arquitetura de coleta</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Um único coletor fala com a API-Football. Todo o resto lê o banco e o cache — sem chamadas paralelas.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Block icon={Radio} title="Fonte única" subtitle="somente o coletor chama /fixtures e /fixtures?live=all">
          <p className="text-[11px] text-muted-foreground">
            Coletor ao vivo a cada 60 s grava <span className="text-foreground">live_fixtures</span>; monitoramento,
            liquidação e telas leem só a tabela e o cache.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Toda chamada passa pelo cliente central: token bucket pelos cabeçalhos do provedor, janela de 60 s e
            disjuntor por endpoint com backoff 30 / 60 / 120 / 300 s.
          </p>
        </Block>

        <Block icon={Timer} title="Fila de cotações" subtitle="cadência por prioridade">
          {PRIORITIES.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{row.label}</span> · {row.rule}
              </span>
              <span className="score-num shrink-0 text-foreground">{row.cadence}</span>
            </div>
          ))}
        </Block>

        <Block icon={Scale} title="Orçamento diário" subtitle="contenção em 80% e 90%">
          {BUDGET.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{row.label}</span> · {row.hint}
              </span>
              <span className="score-num shrink-0 text-foreground">{row.share}</span>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-muted-foreground">
            Em 80% do orçamento as cotações normais param; em 90% só jogos críticos e apuração seguem.
          </p>
        </Block>

        <Block icon={Database} title="Cache compartilhado" subtitle="mesma chave, sem nova chamada">
          {CACHE.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="score-num shrink-0 text-foreground">{row.ttl}</span>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-muted-foreground">
            Resultado encerrado é gravado uma única vez: partida apurada nunca é consultada de novo.
          </p>
        </Block>
      </div>
    </section>
  );
}
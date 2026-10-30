# Ao Vivo brasileiro e auditoria de resultados pendentes — relatório da entrega

## 1. Como funcionava o consumo antes

- **Detector ao vivo** (`syncFootballLive`): `GET /fixtures?live=all` a cada 2 minutos, cobrindo **todos** os países, e uma confirmação em lote (`/fixtures?ids`) para cada partida que saía do feed sem o FT visto — até 100 suspeitas por execução (até 5 chamadas extras a cada execução).
- **Auditoria de resultados** (`syncFootball`, modo `audit`): consultava **toda partida com cotação** (`odds_status != unavailable`), independentemente de haver aposta, até 300 partidas por execução, 20 por chamada — até 15 chamadas a cada 5 minutos (≈180/hora).
- **Estatísticas e eventos** eram buscados por partida encerrada quando havia aposta — correto, mas somado ao item anterior gerava volume desnecessário.
- Não existia fila dedicada de resultados: a fila existente (`MatchMonitorQueue`) só acompanhava partidas ao vivo.

## 2. Quais rotinas geravam chamadas desnecessárias

1. `syncFootball` modo `audit` consultava partidas publicadas **sem nenhuma aposta pendente**.
2. O detector global atualizava todas as partidas do feed, sem separar o que alimenta a aba Ao Vivo.
3. A auditoria não reutilizava resultado já confirmado como critério de parada antecipada.

## 3. Nova lógica do Ao Vivo brasileiro

- Configuração centralizada em `base44/shared/brazilianCompetitions.ts`: país oficial (`Brazil`), IDs oficiais das competições nacionais e tokens de nome apenas como reforço para estaduais/regionais.
- O detector grava `is_brazilian` em cada partida do feed (sem custo extra de API) e reporta `brazilian_live_matches` no resumo.
- A aba Ao Vivo consulta **somente partidas brasileiras** (`country = Brazil`) e não exibe mais seções internacionais. Lista única, servida do banco para todos os visitantes; ninguém dispara consulta individual.
- Intervalo continua centralizado (60 s com jogos em andamento, 5 min sem jogos), respeitado mesmo com disparos antecipados. Sem jogos brasileiros, nada é consultado além do próprio detector.

## 4. Como funciona a auditoria de resultados pendentes

Rotina `auditarResultadosPendentes` (nova função, dentro da camada central existente):

1. Fecha apostas e reconcilia status — **somente banco**.
2. Agrupa todas as seleções abertas por partida (`groupPendingByEvent`), com quantidade de apostas, bilhetes e mercados.
3. Se não há pendência: retorna com **zero consultas** e limpa a fila.
4. Resultado já confirmado no banco (`result_confirmed_at`) é **reutilizado sem consulta**.
5. Só consulta a API para partidas **sem resultado e com aposta pendente**, 20 `fixture_id` por chamada, pelo cliente central (cota por minuto, orçamento diário, pausa pós-429).
6. Guarda o resultado, atualiza a fila e roda a liquidação.

## 5. Agrupamento de múltiplas apostas

Todas as apostas de uma partida apontam para o mesmo `fixture_id`; a consulta é feita **por `fixture_id`**, nunca por aposta ou por bilhete. Uma partida com 200 apostas e 200 bilhetes gera **uma** posição na fila e **uma** consulta dentro do lote.

## 6. Liquidação idempotente

`base44/shared/settlement.ts` (regra única, usada pela auditoria e por `settleMatches`):

- Liquida apenas com resultado confirmado (fonte oficial ou decisão de revisão) — nunca por placar parcial.
- Adiada/cancelada anula a seleção; suspensa, interrompida, W.O. e decisão administrativa ficam pendentes para revisão humana.
- Cada seleção é liquidada uma única vez; cada bilhete gera um único `SimulationResult`; o prêmio é creditado uma única vez (`prize_paid`).
- Bilhete com várias partidas só fecha quando nenhuma seleção está aberta.
- Correção aplicada: códigos de linha gravados como `over-9-5` (mercados secundários) agora são reconhecidos como `9.5`, permitindo liquidar mercados que antes ficavam presos em revisão.

## 7. Frequência de cada rotina

| Rotina | Frequência | Custo por execução |
| --- | --- | --- |
| Detector ao vivo | 60 s com jogos / 5 min sem jogos | 1 chamada `live=all` (+ confirmações em lote de saídas do feed) |
| Auditoria de pendências | a cada 5 min (workflow) | 0 chamadas se nada venceu; 1 por lote de 20 partidas devidas |
| Calendário | diário | 1 chamada por data importada |
| Cotações | conforme configuração (1 por hora por dia) | até 3 páginas/dia |

## 8. Estimativa de consumo diário

- Detector: ~672 chamadas/dia (8 h com jogos a 1/min + 16 h a 1/5 min).
- Auditoria: uma consulta por partida encerrada com apostas + tentativas progressivas (2, 5, 10, 20, 40, 60 min) quando a fonte atrasa. Cenário de 100 partidas com apostas por dia ≈ 100–200 chamadas; 500 partidas ≈ 500–900.
- Total típico: **700 a 1.500/dia** contra 7.500 do plano — sem relação com o número de usuários.

## 9. Testes executados

| Cenário | Resultado |
| --- | --- |
| 200 apostas + 4 de um bilhete na mesma partida | **1** partida consultada; fila registrou 204 apostas — nenhuma consulta por aposta |
| Bilhete com cinco seleções (1 liquidada, 4 abertas) | Bilhete permaneceu **aberto**; só a seleção decidida foi liquidada |
| Partidas com resultado já confirmado | **0** chamadas de API; 8 seleções e 5 bilhetes liquidados só com o dado guardado |
| Execução repetida | 0 liquidações novas, 0 créditos duplicados |
| HTTP 429 / pausa de segurança | Rotina parou com `calls: 0`, fila e pendências preservadas |
| Fila de auditoria | 15 linhas → 11 `confirmed` / 4 `pending`, prioridades p1 (encerrada), p3 (ao vivo com apostas), p4 (futura) |
| Filtro do Ao Vivo | 87 partidas ao vivo no banco → **4 brasileiras** exibidas |
| `settleMatches` após refatoração | Mesma regra de liquidação, 0 duplicidades |
| Build do app | `vite build` sem erros |

Os testes com dados simulados foram criados e removidos em seguida; nenhuma cota extra foi consumida por eles.

## 10. Pontos que ainda precisam de validação

1. **Orçamento interno diário está em 500** no painel, embora o plano seja 7.500 — recomendo elevar conforme a operação (Central API-Football → configurações).
2. **36 partidas em revisão**, sendo 8 com apostas presas em mercados que exigem estatísticas/eventos (escanteios, primeiro gol). Precisam de coleta de estatísticas ou decisão no painel de revisão.
3. Os IDs nacionais da configuração brasileira devem ser conferidos contra `GET /leagues` (o filtro usa, nesta ordem, país oficial → IDs → tokens de nome).
4. Concorrência real de duas execuções simultâneas não foi provocada em produção; a trava global e a pausa pós-429 foram observadas em execução real.
5. Partidas adiadas/suspensas: regra implementada (anulação/pendência), sem caso real novo para acompanhar.
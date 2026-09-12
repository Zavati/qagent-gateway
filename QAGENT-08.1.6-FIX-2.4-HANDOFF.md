# QAgent — 08.1.6 FIX-2.4
## Negative Intent Preservation & Request Repair

**Estado:** implementação incremental sobre a FIX-2.3, validada localmente. Não houve deploy, D1 remoto, chamada ao OrangeHRM nem chamada a um provedor real de IA. Build Next/React lockado não concluído; consulte o relatório de validação. Dados de referência e validação: 11/09/2026.

## 1. Problema e escopo

O caso `GET /web/index.php/api/v2/pim/employees/{id}/custom-fields` possui dois negativos cuja condição não estava modelada: omitir ID e fornecer uma query inválida. O fallback OBSERVED preenchia dependências como num caso positivo. A inspeção podia então propor trocar o status esperado 400 por 200.

A correção distingue **request preparável** de **condição negativa efetivamente realizada**. Preserva o histórico e impede que uma execução sem a condição pretendida fundamente uma normalização de expectativa para sucesso.

**Serviços alterados:** Gateway, Runner, Test Evolution, Test Registry, Test Results e Console.

**Sem alteração:** Catalog, Normalizer, Observation, Plugin e Test Generation Orchestrator. Não há novo Worker, fila, banco independente, endpoint público, configuração de IA ou flag. A refatoração das cópias do helper de elegibilidade continua adiada conforme a decisão de produto.

## 2. Comportamento dos quatro casos

| Caso | Comportamento |
|---|---|
| `missing_id` sem estratégia | Não preenche ID como uma dependência comum para executar o negativo. Com a evidência compatível já existente da execução mal construída, propõe uma variante explícita de caminho. |
| `invalid_query_param` sem estratégia | Não chama o valor observado de inválido. Quando há um único parâmetro inequívoco e evidência utilizável, propõe uma sondagem sintética revisável, explicitamente sem prova de invalidez. |
| `no_auth` | Continua independente, resolve as dependências normais e preserva UNAUTHENTICATED; pode ser confirmado mesmo se o agregado do Run tiver falhado. |
| Funcionário inexistente | Continua exigindo estratégia/evidência da condição. Não usa um ID positivo para declarar inexistência. |

Os padrões são delimitados por intenção, categoria e DSL, não por IDs, hostname, projeto ou endpoint do OrangeHRM. Linguagem livre não é um classificador universal de negócio. A classificação pode recusar casos ambíguos; não inventa uma perturbação permissiva.

## 3. Duas estratégias declarativas restritas

Campo aditivo e aprovado: `scenario.spec.negativeStrategy`, contrato `qagent.negative-request-strategy.v1`.

### 3.1 OMIT_PATH_SEGMENT

```json
{
  "contractVersion": "qagent.negative-request-strategy.v1",
  "operation": "OMIT_PATH_SEGMENT",
  "target": "PATH_PARAM",
  "selector": "id",
  "sourcePath": "/web/index.php/api/v2/pim/employees/{id}/custom-fields",
  "basis": "REVIEWED_PATH_VARIANT",
  "segmentIndex": 6
}
```

`segmentIndex` é zero-based, sem contar a barra inicial. A implementação aceita um placeholder de segmento inteiro e não permite remover o primeiro segmento.

A identidade do endpoint do Catalog e seu template original permanecem na especificação. O runtime prepara a variante aprovada:

```text
Original: /web/index.php/api/v2/pim/employees/{id}/custom-fields
Variante: /web/index.php/api/v2/pim/employees/custom-fields
```

**A variante pode atingir outra rota ou não encontrar rota.** Não se afirma que é a mesma operação lógica, nem que necessariamente retorna 400. A UI mostra os dois caminhos antes da aprovação. Não usa string vazia, null, preenchimento automático ou remoção silenciosa de segmento.

### 3.2 QUERY_VALUE_PROBE

```json
{
  "contractVersion": "qagent.negative-request-strategy.v1",
  "operation": "QUERY_VALUE_PROBE",
  "target": "QUERY",
  "selector": "screen",
  "sourcePath": "/web/index.php/api/v2/pim/employees/{id}/custom-fields",
  "basis": "UNVERIFIED_VALUE_HYPOTHESIS",
  "probeValue": "qagent_probe_screen_unobserved_v1"
}
```

A sugestão usa um valor sintético limitado e verifica que é diferente do valor seguro da execução fonte. Esse valor **não é inferido como inválido por estar fora das observações**. `invalidityProven:false` acompanha a projeção/evidência. Não foi implementada a inferência de um enum completo, de um contrato de negócio ou de uma restrição de domínio.

O binding OBSERVED do alvo `screen` é retirado somente no cenário aprovado; o literal de sondagem passa a representar o experimento. O ID normal continua sendo resolvido pelo mecanismo OBSERVED existente. Não há geração arbitrária de código nem alteração do Auth Profile.

Se houver vários parâmetros possíveis, múltiplos placeholders, selector sensível, valor negativo explícito concorrente ou ausência de base utilizável, não há escolha silenciosa. Uma entrada já explicitamente modelada como literal não é substituída pela sondagem.

## 4. Condições e limitações do reparo nesta entrega

O reparo de estratégia usa **um Result Set LEARNING já persistido** do mesmo tenant/projeto/endpoint/ambiente/versão/cenário, com request sanitizada utilizável e resposta 2xx que tenha divergido da rejeição esperada. É o caso da execução anterior mal construída que motivou esta FIX.

Isso mantém o vínculo de evidência das propostas existentes. **Não foi criado um fluxo de proposta sem Result Set**. Se a fonte não existir, estiver fora da janela, suprimida, ambígua ou pertencer a outra versão, a análise explica a limitação e mantém o caso retido. Não execute deliberadamente uma request mal construída só para fornecer evidência ao reparador.

Sem essa evidência, este pacote ainda protege o negativo de fallback indevido e de atualização de expectativa, mas não promete resolver automaticamente a construção de todos os testes novos.

A busca continua limitada aos cinco Result Sets recentes no Analyze e à janela recente da revalidação. Não há rebase entre versões nem busca histórica ilimitada. Se uma aprovação anterior já tiver criado outra versão, a origem precisa ser reavaliada; o pacote não altera a versão fonte para contornar o conflito.

Somente GET/HEAD/OPTIONS, sem body de consulta e com política de ambiente existente. Cenários com auth inválida, condição de inexistência/estado vazio, body negativo ou outra estratégia não modelada continuam fora deste suporte.

## 5. Fluxo no Analyze e Evolution existentes

Rotas públicas inalteradas:

```text
POST /v1/console/projects/:projectId/test-evolution/resolutions/analyze
POST /v1/console/projects/:projectId/test-evolution/resolutions/approve
POST /v1/console/projects/:projectId/test-evolution/resolutions/verify
```

Novo tipo de alteração: `NEGATIVE_REQUEST_REPAIR`.

```text
Analisar a execução mal construída
  -> diagnosticar condição negativa não realizada
  -> propor estratégia restrita + avaliação pelo assessor existente
  -> revisão humana individual ou em lote
  -> append de uma versão com request reparada, ainda REVIEW_REQUIRED
  -> autorizar execução LEARNING da versão nova
  -> verificar condição da request e assertions
  -> reanalisar a evidência nova
  -> confirmar a hipótese ou revisar a rejeição, conforme evidência
  -> nova aprovação para prontidão de regressão
```

A estratégia candidata é construída/validada pelo sistema; o assessor de IA existente avalia a proposta e recomenda a decisão. Não se afirma que a IA tenha descoberto uma restrição de domínio quando somente sugerimos uma sondagem.

Analyze pode persistir proposta/assessment, mas não executa ou aplica. Aprovar não executa. `AUTO_SAFE` não aplica automaticamente `NEGATIVE_REQUEST_REPAIR`. Os limites atuais de seleção/agrupamento permanecem.

A nova versão de reparo conserva as assertions e a autenticação; recebe `learning.kind=NEGATIVE_REQUEST_REPAIR`, `phase=PENDING_VERIFICATION` e referências à aprovação/evidência. Continua REVIEW_REQUIRED: salvar a estratégia não prova sua rejeição pela aplicação.

As propostas de reparo de cenários diferentes do mesmo Test Design/parent e a confirmação independente do caso sem auth podem ser agrupadas num único append. No mesmo cenário, não se mistura reparo com mudança simultânea de assertion/request. Parent obsoleto, prova incompatível e conflito são recusados. O replay após resposta perdida do Registry recupera a versão já criada.

## 6. Prova interna e proteção de expectativas

A prova `qagent.negative-request-repair-proof.v1` contém escopo, IDs de Run/Results/cenário/versão, hashes do cenário e das assertions, estratégia delimitada e declarações OBSERVED adicionadas. Não inclui cookies, tokens, body ou o ID capturado.

O browser aprova apenas IDs de propostas/alterações e motivo; não envia a prova nem um estado READY. O Registry confere origem, hashes, estratégia derivável e o conjunto exato de declarações. A inclusão de `spec.negativeStrategy` pelo append normal de geração da IA é recusada; ela deve passar pelo caminho de aprovação do reparo.

A proteção vale na inspeção e na materialização de alterações, incluindo propostas de status antigas abertas em outra aba. Nos negativos de rejeição 4xx, não se permite transformar a expectativa em não-4xx para esconder uma condição ausente. Para estratégias executadas suportadas, a revisão de rejeição fica delimitada aos status 400/404/405/422. Respostas de autenticação/infraestrutura não viram genericamente contrato de validação.

Uma sondagem que recebe 2xx mantém a hipótese inconclusiva e as assertions falhando; o sistema não afirma que o servidor aceitou uma entrada comprovadamente inválida. Uma condição realmente enviada que receba 422 em vez de 400 pode alimentar a proposta de STATUS do Evolution existente, com revisão, sem perder a estratégia.

Os Runs anteriores e propostas já aplicadas permanecem históricos. Não há limpeza retroativa nem reclassificação de seus outcomes para PASSED.

## 7. Preparação, Runner e Results

- O Gateway impede fallback no alvo da condição negativa; usa dados observados nas dependências normais.
- Configuração explícita para o alvo é um conflito, não uma autorização para sobrescrever silenciosamente seu valor. Analyze e runtime conferem isso. Uma configuração que mude depois da proposta/aprovação pode impedir a execução; não há transação distribuída com as configurações.
- O Execution Plan inclui a estratégia aprovada no conteúdo coberto por hash. O Runner valida a declaração, constrói a variante limitada e confere a condição depois da materialização, antes do despacho.
- Não altera origin, método, autenticação ou políticas de egress para viabilizar o negativo.
- A request fornece `negativeRequest` no envelope de evidência existente. O contrato `qagent.negative-request-execution.v1` registra a estratégia, `conditionEstablished:true`, a indicação de variante e `invalidityProven:false`.
- Results recompõe a condição a partir da request sanitizada e não confia somente na flag. Persiste no `request_json` existente: **não há migration de Results nesta FIX**.
- Evolution recompõe a condição de novo antes de oferecer/aplicar aprendizado. Ausência, alteração ou redaction que impeça comprovar a condição não produz confirmação.

Os caminhos em Results continuam sanitizados; quando um template é acompanhado por pathParams seguros, a correspondência é conferida sem expor valores adicionais na proposta. A prova de omissão não pode conter o ID que se pretendia retirar.

O Runner mudou porque passa a interpretar duas estratégias declarativas de request e verificar sua realização; não recebeu um motor de IA. HTTP, Auth Runtime, Test Data e fila continuam nos mecanismos existentes.

## 8. Verificação e transição posterior

O Verify das propostas de reparo cria um Run LEARNING pelo mecanismo existente, com seleção e autorização explícitas. A versão fonte não pode verificar a própria alteração.

Outcomes novos no ledger:

- `REQUEST_REPAIR_VERIFIED`: condição comprovada e assertions atendidas na versão reparada.
- `REQUEST_REPAIR_NOT_VERIFIED`: condição realizada, mas expectativa não atendida.
- `VERIFICATION_BLOCKED`: evidência/execução insuficiente para concluir.

Todos usam `recoveryConfirmed:false`: não se contam esses casos como recuperação confirmada de bug/falha da aplicação.

Um reparo verificado ainda exige a confirmação de hipótese existente para incorporar o cenário como READY. Analyze da versão reparada não fica preso ao vínculo APPLIED do reparo anterior. A confirmação preserva a estratégia e cria a versão apta à regressão, seguida da verificação prevista na FIX-2.2. O fluxo integrado local também executou a versão final em REGRESSION.

A versão do Test Design é imutável; o resultado da verificação é mantido no ledger, não reescreve `learning.phase` histórico. Atualize inventário e materialize um snapshot novo da suite quando a versão de regressão for incorporada.

## 9. Console

O painel de aprendizagem e a tela completa do Evolution apresentam:

- motivo concreto de condição negativa não estabelecida;
- template original e variante sem o segmento;
- valor sintético de sondagem e aviso de invalidez não comprovada;
- dependências normais reaproveitadas por OBSERVED;
- assertions preservadas e prontidão ainda em revisão;
- ações distintas de aplicar, executar e verificar.

Nenhuma estratégia é aplicada por abrir um link ou atualizar um Run. A reanálise automática e o Orchestrator continuam fora desta entrega. O Top Endpoints lazy, o Readiness Explorer, as baselines e as extensões de cobertura anteriores permanecem.

## 10. Arquivos principais

- Comum nas fronteiras existentes: `src/negativeRequestStrategy.js` (Gateway/Runner/Evolution/Registry/Results), validadores e evidência da estratégia. Não é um serviço novo.
- Evolution/Registry: `src/negativeRequestRepair.js`, criação/validação/aplicação da prova.
- Gateway: `handlers/consoleLearningResolution.js`, `services/exploratoryLearningData.js`, `services/executionPlanMaterializerService.js`, `services/evolutionRerunService.js`, `services/learningCycleService.js`, `services/testEvolutionAiService.js`, guard de geração.
- Runner: `bundleValidator.js`, `runtimeMaterializer.js`, `httpRequestBuilder.js` e a cópia de elegibilidade.
- Evolution: `service.js`, `eligibility.js`, `approvalGroups.js`, `riskPolicy.js`, confirmação e nova migration.
- Registry: validações de append/evolution e `repository/testDesignRepository.js`.
- Results: `contracts.js` e evidência no armazenamento já existente.
- Console: DTOs, painéis e `NegativeRepairSummary.tsx`.

O manifesto enumera todos os arquivos novos/modificados e hashes. Os helpers compartilhados relevantes foram conferidos byte a byte. A centralização arquitetural permanece uma dívida técnica conhecida, não foi antecipada neste pacote.

## 11. Migration, configuração e publicação

**Uma migration nova, somente Test Evolution:**

```text
migrations/0012_negative_request_repair.sql
Binding: TEST_EVOLUTION_DB
```

Reconstrói `test_evolution_changes` e `test_evolution_outcome_verifications` para ampliar CHECKs, copiando registros e recriando índices. O teste local preservou linhas históricas, índices e FKs e recusou enums arbitrários. A nova migration não altera migrations passadas.

Antes de aplicar: backup, conferir conta/binding/banco, listar todas as pendentes e comparar personalizações do schema. Triggers/tabelas externas não foram examinados. Não executar DROP manual ou desabilitar FKs. A aplicação pelo processo existente pode aplicar todas as pendentes, não apenas a 0012.

Após resolver gates de build/checks, publicar:

```text
Registry + Results -> Runner -> Evolution -> Gateway -> Console
```

A migration precisa estar aplicada antes do Evolution produzir os tipos novos. Runner e Results precisam estar compatíveis antes de consumir Runs reparados.

**Sem flag nova.** Preserve `OBSERVED_BASELINE_GENERATION_ENABLED=true`, bindings, secrets e IDs. A antiga allowlist de projetos continua ignorada como na FIX-2.1. Nenhum wrangler ou lockfile foi alterado. Os ZIPs completos conservam o default de exemplo false do Gateway; prefira CHANGED-FILES ou faça merge cuidadoso.

Checks nos seis repositórios:

```bash
npm ci
npm run test:f08-1-6-fix2-4
npm run check:08.1.6-fix2-4
```

Console também: `npm run build`. Não desligue a política de mutações só para satisfazer o teste legado do Runner; confira a intenção dessa configuração conforme o relatório.

## 12. Smoke recomendado

1. Manter a versão que originou o Run de aprendizagem mal construído, o mesmo ambiente e as evidências persistidas. Não apagar projeto ou remonitorar.
2. Analisar `missing_id`, `invalid_query_param` e `no_auth`. Se a fonte compatível e utilizável estiver na janela, esperar duas propostas de reparo e, se ainda pertinente, a confirmação independente sem auth.
3. Revisar os caminhos, sondagem, aviso de hipótese e adições OBSERVED. Um literal de consulta diferente não é prova de invalidez.
4. Aprovar propostas compatíveis juntas: uma nova versão, assertions/auth intactas, reparos ainda REVIEW_REQUIRED. Demais cenários intactos.
5. Autorizar **Verificar versões aplicadas**, que cria execuções LEARNING para os reparos. Conferir caminho efetivo/query/prova, sem revelar credenciais.
6. Reanalisar a versão reparada: se a condição e as assertions foram atendidas, usar confirmação existente. Se veio outro 4xx compatível, revisar a proposta de expectativa. Se veio 2xx, não aceitar sucesso automaticamente.
7. Aprovar a confirmação, verificar a nova versão e atualizar o snapshot de regressão. Não regenerar o Test Design para incorporar as alterações já aprovadas.

Se o GET da versão tiver mudado durante outras aprovações, respeitar o conflito de origem. O pacote não garante reuso cross-version do resultado antigo.

## 13. Rollback

Parar primeiro novas ações no Gateway/Console/Evolution. Manter os leitores/executores compatíveis enquanto existirem versões com estratégias/propostas novas ou Runs pendentes. Não restaurar CHECKs antigos por cima de dados novos, apagar versões ou excluir histórico. Não reverter um Runner antigo para consumir planos que ele não conhece.

## 14. Limites de validação

O relatório contém os comandos/resultados. Foram usados fonte de Test Design do usuário (identidades de infraestrutura substituídas nas fixtures), request builder/materializador/validação/avaliação reais, Results/Registry/Evolution com SQLite local e respostas HTTP/assessor de IA controladas. Isso não é execução real contra OrangeHRM nem emulação integral de Cloudflare/D1/Queues.

O browser exercitou componentes reais com React 18.2.0 disponível localmente e adaptadores de Next/auth/transporte. O projeto trava React 19.2.3/Next 16.2.11: esse build não concluiu. Nenhum gate de build/deploy externo é declarado aprovado.

# QAgent — 08.1.6 FIX-2.2
## Evidence-backed Hypothesis Confirmation

**Data:** 11/09/2026. **Estado:** implementação incremental sobre FIX-2.1/FIX-2, com validação local. Sem deploy, banco remoto, HTTP ao OrangeHRM ou chamada real à IA. Build Next/hidratação pendentes, conforme relatório.

## 1. Problema fechado

O Run LEARNING pode passar sem gerar uma proposta de correção. Antes desta alteração, ANALYZE voltava a responder `LEARNING_AVAILABLE / NO_SUPPORTED_FAILED_ASSERTION`, sem concluir a revisão da hipótese. Reexecutar não mudava a prontidão persistida.

A FIX-2.2 acrescenta **confirmação de hipótese já atendida** ao fluxo existente de Evolution. Não cria outro serviço, fila, banco ou endpoint público. As assertions não são alteradas para obter aprovação.

```
Resultado LEARNING compatível, assertions preservadas e aprovadas
  → inspeção determinística de confirmação
  → proposta persistida no Evolution
  → avaliação pelo assessor de IA já configurado
  → revisão individual ou lote pelo usuário
  → append do Registry, vN+1, prontidão READY
  → verificação posterior na versão nova
  → HYPOTHESIS_VERIFIED ou HYPOTHESIS_NOT_VERIFIED
```

Analisar não executa nem aprova. Aplicar não executa. A verificação exige autorização própria e reutiliza `createEvolutionRerunV1` e o ledger já existente. AUTO_SAFE **não** aplica confirmações automaticamente nesta entrega.

## 2. O que muda no caso test_003 / test_006

- `test_003`: mantém UNAUTHENTICATED e STATUS 401. A declaração reutilizável de PATH_PARAM `id` por OBSERVED é incorporada ao cenário na versão nova, se foi a preparação segura utilizada e validada na aprendizagem. Não grava o valor capturado como literal/FIXED.
- `test_006`: mantém REQUIRED, STATUS 200 e JSON_PATH_EXISTS `$.meta.total`, além do binding OBSERVED existente. A confirmação não cria uma verificação matemática do total.
- Ambas as propostas, se do mesmo Test Design e parent, podem ser aprovadas juntas em **um único append**.
- `test_002` (inexistente), `test_007` (vazio) e demais cenários não selecionados não são modificados.
- LEGACY permanece LEGACY quando a origem não estava registrada. Não há reclassificação retroativa para OBSERVED_BASELINE/AI_EXPLORATORY.

A versão antiga e o Result Set permanecem intactos. Os antigos textos de grounding continuam descrevendo a origem; um novo bloco de aprendizagem informa a aprovação fundamentada em execução.

## 3. Tipo de alteração e prova interna

Novo `changeType` persistido:

```
SCENARIO_READINESS_CONFIRMATION
```

A proposta contém uma prova interna `qagent.learning-confirmation-proof.v1`, criada com Results e Registry autoritativos. Inclui tenant/projeto/endpoint/ambiente, versão, cenário, Run/ResultSet/scenarioResult, instante, status, quantidade de assertions, hash das assertions e do cenário completo, motivos resolvidos e declarações OBSERVED adicionadas. Não inclui cookies, tokens, valores de parâmetros ou body.

O Registry verifica a forma/escopo, o hash do cenário de origem, as assertions, a admissão e o conjunto exato das declarações propostas. Uma prova com campos extras, escopo trocado, hash adulterado, binding posicional diferente ou alteração simultânea de assertion/request no mesmo cenário é recusada.

A prova não é aceita como payload do browser: a aprovação pública recebe somente IDs de propostas/alterações e motivo. Revalidação e materialização são feitas dentro dos serviços autenticados existentes.

## 4. Condições para confirmação

- Cenário não-baseline, em REVIEW_REQUIRED ou NEEDS_DATA com motivos reconhecidos pela admissão exploratória FIX-2.1.
- Resultado de propósito LEARNING, na versão/endpoint/ambiente correspondentes.
- Cenário PASSED, resposta HTTP efetiva, sem redirect e sem 5xx.
- Todas as assertions presentes, únicas por índice, do tipo e referência esperados, e avaliadas como PASSED.
- STATUS obrigatório e compatível. 401/403 podem ser fatos esperados de um teste de autorização, não falhas universais de ambiente; a intenção deve corresponder.
- Evidência da request utilizável: parâmetros, literais declarados e fontes de binding coerentes com o cenário.
- UNAUTHENTICATED não pode conter credencial de Auth Runtime em header/query. REQUIRED precisa de evidência de injeção via header do Auth Runtime neste caminho de confirmação.
- Assertions sobre body não são confirmadas com transporte truncado ou evidência suprimida.
- Sem dependências desconhecidas, condição negativa não estabelecida ou secrets ausentes.

**Limite:** confirmar assertions executadas não comprova toda a intenção expressa em linguagem natural, regras de negócio não testadas, todos os ambientes ou ausência de bugs. A UI declara esse limite. Query-auth, bodies de consulta não vazios, path params repetidos e outras formas não cobertas podem permanecer pendentes em vez de serem inferidas arbitrariamente.

## 5. Não reutilizar aprovação de evidência ultrapassada

ANALYZE conserva a janela existente de até cinco Result Sets recentes do endpoint/ambiente. Filtra pela versão/cenário; `hasMore` continua informando o limite, não uma busca integral do histórico.

Uma proposta de confirmação a partir de um resultado mais antigo não é criada quando já foi examinado um resultado compatível mais recente. Na aprovação, o Evolution consulta o histórico recente do cenário (limite 10) e exige que a fonte da proposta ainda seja a evidência compatível mais recente disponível. Evidência substituída, inclusive por outro sucesso, solicita nova análise; não se escolhe apenas um resultado verde conveniente.

Se a fonte saiu da janela, não se presume inexistência nem aprovação. Esta entrega não acrescenta pesquisa histórica ilimitada ou um seletor de ResultSet no browser.

Não há transação distribuída entre chegada de Results e append do Registry. A prova é revalidada antes de aplicar; uma execução posterior à aprovação não é apagada nem neutralizada por ela e poderá revelar falha normalmente.

## 6. Versionamento, lote e reconciliação

Reutiliza as rotas de resolução existentes:

```
POST /v1/console/projects/:projectId/test-evolution/resolutions/analyze
POST /v1/console/projects/:projectId/test-evolution/resolutions/approve
POST /v1/console/projects/:projectId/test-evolution/resolutions/verify
```

A análise devolve `PROPOSAL_AVAILABLE` com reason `LEARNING_HYPOTHESIS_CONFIRMED`, uma projeção segura da confirmação e `learning.allowed:false` quando existe proposta. Não incentiva outra execução para produzir a mesma evidência.

A aprovação preserva os limites existentes (10 propostas / 30 alterações), o agrupamento por parent, lease, controle otimista e idempotência. Confirmação não pode ser misturada com edição de request/assertion no mesmo cenário. Grupos diferentes não são uma transação global.

O replay após perda de resposta do Registry recupera a versão já gravada pelo generationRequestId do grupo. Não refaz materialização de evidência ultrapassada quando o commit correspondente já foi provado, nem cria versões duplicadas. Identidade, escopo e chave do grupo são conferidos.

Na nova versão, somente os cenários aprovados recebem READY, os bloqueios reconhecidos são resolvidos e a política reutilizável de dados é mantida. A preparação da regressão normal reutiliza a precedência de configuração explícita/observada da FIX-2.1 para esses cenários. Uma mudança posterior de configuração pode continuar impedindo a execução; aprovação não torna dados eternos.

## 7. Proveniência e verificação

Metadata aditiva:

```
scenario.learning.kind = HYPOTHESIS_CONFIRMATION
scenario.learning.phase = PENDING_VERIFICATION
```

Inclui IDs da proposta/Run/Results/versão parent, ambiente, hash das assertions, motivos resolvidos, aprovador e data. `generationClass` e as assertions originais permanecem.

A metadata registra o instante da criação da versão. A verificação posterior fica no ledger do Evolution, não reescreve essa versão imutável. O painel lê ambos. A confirmação não dispara aprendizagem arbitrária de novos valores literais apenas porque permanece `evolutionState: LEARNING`.

Novos outcomes do ledger:

- `HYPOTHESIS_VERIFIED`: a versão nova foi verificada com sucesso.
- `HYPOTHESIS_NOT_VERIFIED`: a verificação posterior recebeu resposta, mas falhou.
- `VERIFICATION_BLOCKED`: verificação não concluída adequadamente.

Todos têm `recoveryConfirmed:false`. O ciclo usa HEALTHY ou REVIEW_REQUIRED conforme aplicável; os contadores de falhas recuperadas não são incrementados por confirmar algo que já passava. A versão fonte/Run de aprendizagem não verifica a si própria. A seleção, as credenciais, o idempotency key e os mecanismos de execução existentes continuam válidos.

## 8. Console

O painel existente oferece “Aplicar selecionadas · não executar” para a confirmação. Mostra readiness anterior/novo, status recebido, quantidade de assertions preservadas e declarações OBSERVED incorporadas. A UI não recebe a prova inteira nesse painel nem exibe valores de parâmetros.

O card da nova versão indica “Hipótese confirmada com evidência de execução” e a origem do aprendizado. A verificação segue em “Verificar versões aplicadas”. A tela completa de Evolution também reconhece o novo tipo, sem apresentá-lo como mudança de schema.

Depois do append, atualizar o inventário consulta as versões atuais. Snapshots de suite antigos não são atualizados automaticamente: materialize o próximo snapshot para a regressão normal. READY não equivale a PASSED nem a autorização contextual universal.

Top Endpoints lazy, Readiness Explorer, fonte protegida e demais melhorias anteriores foram preservados.

## 9. Serviços e migration

**Alterados:** Gateway, Test Evolution, Test Registry, Console.

**Sem alteração:** Runner, Results, Catalog, Normalizer, Plugin, Observation, Orchestrator. O Runner usado nos testes de compatibilidade é o FIX-2.1 já entregue.

Migration única, no Test Evolution:

```
migrations/0010_learning_hypothesis_confirmation.sql
binding: TEST_EVOLUTION_DB
```

Ela reconstrói `test_evolution_changes` e `test_evolution_outcome_verifications` para ampliar CHECKs, copiando as linhas/colunas existentes e recriando seus índices. Não altera migrations históricas, não limpa propostas e não modifica outros bancos. A preservação de dados/FKs/índices foi testada em SQLite local.

**Antes de aplicar:** confirmar destino, backup e diferenças do schema realmente publicado, inclusive triggers/tabelas customizados. Nenhuma tabela dos fontes recebidos referencia essas duas como tabela-pai. Personalizações externas não foram examinadas. Não fazer DROP manual, não desligar FKs e não inferir que o banco seja descartável.

## 10. Publicação e smoke

1. Aplicar sobre Gateway/Console FIX-2.1, Registry/Evolution FIX-2. Conferir diffs locais.
2. Preservar `wrangler`, secrets/bindings/IDs e `OBSERVED_BASELINE_GENERATION_ENABLED=true`. PROJECT_IDS continua ignorada pelo código existente. Sem flag nova.
3. Instalar dependências e executar `npm run test:f08-1-6-fix2-2`, `npm run check:08.1.6-fix2-2`. Na Console, também `npm run build` e smoke no navegador.
4. No Evolution, usar o processo de migrations existente: listar pendentes, conferir banco/backup e aplicar somente após revisão. O comando de aplicação aplica todas as pendentes, não somente 0010.
5. Publicar Registry → Evolution → Gateway → Console, com a migration aplicada antes do Evolution novo produzir mudanças/verificações.
6. Abrir a mesma versão dos cenários que passaram em LEARNING, selecionar o ambiente correto e Analisar com IA. Não regenerar nem remonitorar para esse smoke.
7. Se a evidência necessária estiver disponível, conferir duas propostas de confirmação, assertions intactas e binding reutilizável do `test_003`.
8. Aprovar as duas juntas. Deve haver uma nova versão (v3 se o parent ainda for v2), com READY nos dois casos. Os outros permanecem intactos.
9. Autorizar verificação da versão aplicada e consultar o resultado/ledger. Só uma nova execução pode produzir HYPOTHESIS_VERIFIED. Se as condições do ambiente mudarem, registrar o que realmente ocorrer, sem reaproveitar o Run fonte como verificação.
10. Atualizar inventário/indicadores e materializar snapshot novo antes da regressão normal. Nenhuma execução é disparada apenas por atualizar a tela.

## 11. Rollback

Reverter primeiro Console/Gateway para não iniciar novas confirmações. Manter Registry/Evolution capazes de ler os novos dados enquanto houver propostas/versões novas. Não remover a migration, apagar linhas ou restaurar CHECKs antigos por cima de registros novos. Não é um rollback por exclusão de histórico.

O pacote CHANGED-FILES não contém wrangler/lockfiles/dependências, mas inclui package.json, testes e a migration nova. Reconciliar alterações próprias antes de substituir arquivos. Os ZIPs completos conservam os wrangler recebidos, cujo Gateway tem flag de exemplo false: não sobrescrever a ativação publicada sem revisar.

## 12. Validação e limites

Veja `QAGENT-08.1.6-FIX-2.2-VALIDATION-REPORT.md` e o pacote de validação para comandos, logs, fixtures e diffs.

Não houve provider IA real: o assessor foi exercitado com saída controlada, enquanto propostas, contexto, Registry e persistência são os módulos reais. Não foi feito deploy nem replay dos IDs reais do projeto.

O build Next não concluiu: npm ci retornou `Exit handler never called!`; build retornou `next: not found`. Os testes de Console são client/DTO, transpilação e estrutura de componentes, não hidratação/browser. Não se declara esses gates aprovados.

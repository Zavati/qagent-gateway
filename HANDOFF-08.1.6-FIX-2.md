# QAgent — 08.1.6 FIX-2 — Active Learning & AI-Assisted Resolution

## Estado da entrega

Implementação retomada **das bases cumulativas**, não do ZIP de recuperação: ele só continha documentação/manifesto, sem fontes parciais recuperáveis. Há código funcional e testes locais nesta entrega. **Não houve publicação, acesso ao banco remoto, chamada à aplicação do cliente ou chamada a um provedor real de IA.**

O smoke integrado e as interações locais passaram. Os gates oficiais de build/toolchain descritos no relatório continuam pendentes. Esta entrega deve passar pelo ambiente de homologação antes de produção.

## 1. Objetivo e integração

Reutiliza Test Evolution, Continuous Learning Cycle, catálogo de schemas, append do Registry, Run Control Plane, Runner, Results e Console existentes. Não adiciona um Worker, fila de aprendizagem, banco independente ou motor de IA. Os novos handlers do Gateway apenas coordenam operações existentes com seleções limitadas.

Fluxo entregue:

```text
Cenário selecionado + ambiente + versão explícita
  → analisar execuções compatíveis já persistidas
  → proposta de Evolution, ou indicação de execução para aprender
  → autorização explícita de execução LEARNING quando necessária
  → request da fonte + regras conhecidas preservadas
  → resposta atual produz estrutura tipada sanitizada
  → Evolution/Catalog propõem enriquecimento monotônico
  → IA existente assessora a proposta, sem aplicar por analisar
  → aprovação individual ou lote compatível → vN+1
  → autorização explícita de verificação → execução posterior
  → ledger de Evolution registra recuperação ou não recuperação
```

## 2. Separação entre prontidão e conhecimento

Uma baseline antiga em NEEDS_DATA não ganha READY por um GET da tela. Quando seus únicos impedimentos são resposta/autoconsistência parciais, pode ser selecionada explicitamente para LEARNING.

Precondições permanecem: request COMPLETE, fonte disponível/não expirada, ambiente e identidade corretos, runtime utilizável, autenticação resolvível, método de consulta permitido. Request parcial, secret ausente, fonte expirada, escopo incompatível e mutação não autorizada não são liberados.

Nesta entrega, a entrada de aprendizagem e a verificação assistida são limitadas a **GET, HEAD e OPTIONS**. Isso não prova que toda operação com esses métodos seja sem efeitos no sistema externo; as políticas existentes continuam sendo verificadas e o usuário autoriza o ambiente e os casos. POST/PUT/PATCH/DELETE permanecem no fluxo de execução/mutação já governado, não ganham bypass.

Uma execução LEARNING pode terminar ERROR quando a assertion SCHEMA permanece NOT_EVALUATED. Isso é limitação do conhecimento e não falha de rede nem aprovação da aplicação. O novo painel explica a distinção. O agregado histórico de Results não foi renomeado nem recalculado.

## 3. Regras conhecidas e enriquecimento

O validador deixa de abandonar toda a validação ao encontrar um schema parcial. Divergências nas regras conhecidas continuam FAILED. Ramos desconhecidos geram evidência incompleta, não comparação `unknown != integer`, e não convertem o resultado global em PASSED.

O módulo `activeLearningSchema.js` é compartilhado por cópia byte-idêntica entre os serviços necessários. Infere tipos, presença observada e estrutura sem copiar valores de domínio. Aplica limites de profundidade/nós/tamanho e sanitização. Arrays e tipos mistos têm interpretação determinística.

O enriquecimento só é candidato quando há:

- resposta JSON utilizável, 2xx, sem truncamento de transporte;
- estrutura recebida completa segundo o contrato de evidência;
- avaliação correspondente de todas as assertions da fonte;
- nenhuma violação de regra conhecida;
- referência exata ao schema/versão e escopo correspondentes;
- progresso real na estrutura desconhecida, sem enfraquecer regras conhecidas.

`401`, `403`, `5xx`, timeout, resposta inválida, evidência suprimida/truncada, schema adulterado, fonte incompatível e contradição não completam automaticamente o contrato de sucesso. Uma lista vazia não permite inferir campos dos elementos que não foram examinados.

O Catalog reutiliza o fluxo de evolução de schema. O Registry exige prova estrutural e verifica que a alteração é um refinamento; não basta um texto da IA dizer que as regras foram preservadas. Não se altera um `csv_*` compartilhado em lugar: novas versões/referências são criadas.

## 4. Proveniência e maturidade

A baseline conserva seu evento, sessão, ambiente, request fingerprint, schema original, cobertura original e self-check original. Quando aprovada, recebe `baseline.enrichment` com referência à proposta, execução/cenário de origem, parent Test Design, schema/hash efetivo, aprovador e horário. O schema efetivo é resolvido para a nova execução sem fingir que a captura antiga era completa.

AI_EXPLORATORY permanece AI_EXPLORATORY depois de aprender. A versão nova recebe metadata de aprendizagem com `PENDING_VERIFICATION`. A confirmação da execução posterior reside no **ledger existente de Evolution**; não se reescreve a versão imutável para transformá-la retroativamente em STABLE. O painel consulta esse ledger para exibir a verificação.

Após um append aprovado, os leitores de inventário/prontidão refletem a nova versão no refresh. A cobertura mostrada como origem continua podendo ser PARTIAL mesmo quando há enriquecimento posterior: são dois fatos distintos. O detalhe apresenta ambos. Snapshots antigos da suite não são atualizados automaticamente; materialize o snapshot novo para a próxima regressão normal.

## 5. APIs públicas implementadas no Gateway

Autenticação da Console, associação ao projeto e papel owner/admin/member são verificados antes da operação. OrganizationId do cliente não é usado como autoridade.

### Analisar

```http
POST /v1/console/projects/:projectId/test-evolution/resolutions/analyze
```

```json
{
  "environmentId": "env_EXEMPLO",
  "selections": [
    {
      "endpointId": "cep_EXEMPLO",
      "testDesignVersionId": "tdv_ATUAL",
      "scenarioId": "baseline_EXEMPLO"
    }
  ]
}
```

Até **5 cenários por chamada**. Busca até os **5 Result Sets recentes do endpoint/ambiente**, restringindo à mesma versão e cenário; declara quando há resultados antigos não examinados. Reutiliza Results/inspeção/proposta/contexto/assessor IA existentes. Os modelos e credenciais continuam na configuração atual da capacidade `test-evolution`; não há configuração de provedor nova.

Uma policy OFF impede a avaliação pela IA. Configurar a policy atual por projeto (SUGGEST é apropriado para o primeiro aceite). Propostas/assessments existentes compatíveis são reaproveitados. Propostas rejeitadas ou obsoletas não são reaplicadas automaticamente.

Resposta `qagent.learning-resolution.v1`: itens PROPOSAL_AVAILABLE, LEARNING_AVAILABLE, APPLIED, BLOCKED ou ERROR; contagens/bounds e códigos seguros. `executionStarted:false` e `appliedByThisOperation:false`.

É uma operação limitada/síncrona com respostas por item; **não é um job novo de análise de todos os endpoints do projeto**. Pode persistir uma proposta/assessment, mas não executa a aplicação nem grava uma nova versão do teste por si só.

### Aprovar

```http
POST /v1/console/projects/:projectId/test-evolution/resolutions/approve
```

```json
{
  "items": [
    {"proposalId":"tep_EXEMPLO_A", "acceptedChangeIds":["tec_EXEMPLO_A"]},
    {"proposalId":"tep_EXEMPLO_B", "acceptedChangeIds":["tec_EXEMPLO_B"]}
  ],
  "reason":"Aprovação do enriquecimento estrutural proposto."
}
```

Até **10 propostas / 30 alterações**. Mesmo Test Design + parent version formam um único grupo compatível, com um append no Registry. Controle otimista recusa parent obsoleto e mudanças conflitantes na mesma assertion/binding. Lease persistido impede aplicação concorrente do mesmo grupo. Replay após resposta perdida recupera a versão já criada. O motivo original da primeira aprovação é preservado.

Grupos de Test Designs diferentes têm respostas independentes: não há transação global entre endpoints, nem entre bancos de Evolution e Registry. Idempotência e reconciliação tratam perda de resposta após commit. A resposta pode informar projeção do Learning Cycle DEFERRED sem negar que o teste foi salvo.

### Executar para aprender

Reutiliza a rota existente de criação de Run, acrescentando o propósito:

```http
POST /v1/console/projects/:projectId/runs
```

```json
{
  "contractVersion":"qagent.run-create.v1",
  "purpose":"LEARNING",
  "testDesignVersionId":"tdv_ATUAL",
  "environmentId":"env_EXEMPLO",
  "scenarioIds":["baseline_EXEMPLO"],
  "confirmDiscoveredRuntime":true
}
```

Usa a chave de idempotência exigida pelo client de Runs existente. Sem purpose explícito, continua REGRESSION. LEARNING exige seleção explícita de cenários; não seleciona automaticamente todos os NEEDS_DATA. O propósito participa da identidade do Run para impedir replay de uma operação com semântica diferente.

### Verificar depois da aplicação

```http
POST /v1/console/projects/:projectId/test-evolution/resolutions/verify
```

```json
{"proposalIds":["tep_EXEMPLO_A"],"confirmExecution":true}
```

Reutiliza `createEvolutionRerunV1` e o processamento existente de verificação. Só aceita propostas APPLIED e a versão criada por elas. Repetir o pedido usa o mesmo vínculo de verificação. Um resultado já verificado é retornado sem nova execução. Não transforma um rerun em um novo trigger recursivo.

O caminho interno de aprovação em lote do Evolution é `POST /internal/v1/projects/:projectId/test-evolution-proposals/approve-batch`, preservando autorização/escopo entre serviços. O endpoint individual antigo continua suportado.

## 6. Console

Novo painel **Aprendizagem e resolução com IA** no detalhe de Test Design e no detalhe dos cenários do Readiness Explorer. Começa recolhido; ao abrir, carrega configuração do ambiente, não analisa nem executa automaticamente.

Permite selecionar até cinco cenários do endpoint, ambiente, analisar, revisar propostas e aceitar alterações. A aplicação exige motivo. A execução tem confirmação própria e botões distintos. Estados antigos são descartados na troca de projeto/token/versão; após append, é necessário recarregar a versão para nova análise, mas os vínculos de verificação continuam visíveis.

Aprovação direta nesse painel exibe e suporta enriquecimento estrutural e mudanças de expectativa de status. Alterações com valores de request/literais não mostrados nessa projeção possuem link para o **fluxo completo de Evolution existente**, em vez de serem aprovadas às cegas. Não foi criado editor paralelo de secrets ou de Test Data.

Os indicadores FIX-1 permanecem dinâmicos; Top Endpoints continua lazy. A FIX-2 não escreve status de prontidão por abrir ou filtrar a tela. Não existe aprovação indiscriminada de todo o projeto em um clique.

## 7. Captura coordenada

No Plugin e Observation, a amostra sanitizada de body passa de 4 KiB para **8 KiB** e o limite de elementos por array de 20 para **50**. O Normalizer examina até 50 elementos para manter coerência. O teto de captura bruto de CDP continua **64 KiB**; profundidade de sanitização e outros limites continuam explícitos.

A ingestão trata a amostra sanitizada de JSON separadamente do corte genérico de strings da envelope; nenhum body bruto é restaurado depois da sanitização. O orçamento do evento sanitizado passa de 16 para 48 KiB. Permanecem limites de batch/transportes.

Foi necessário ajustar o CHECK da tabela `network_samples` de 4096 para 8192 bytes. Sem a migration do Observation, a nova amostra válida seria recusada pelo banco.

No Runner, a estrutura de aprendizagem tem teto de 32 KiB, 2.000 nós e até 500 itens de array examinados. O orçamento do envelope de Results continua limitado; estrutura que não cabe é sinalizada/omitida, não tratada como completa. O preview visual e a evidência estrutural são independentes e podem ter cobertura diferente.

**Não é captura ilimitada:** JSON acima dos orçamentos ainda pode virar amostra parcial. A entrega não inclui uma tela de configuração de limites por cliente, inferência streaming de conteúdo arbitrariamente grande ou recuperação de bytes históricos perdidos. O smoke de captura valida uma fixture de 29 registros/6081 bytes, não todos os ERPs possíveis.

## 8. Migrations novas

| Serviço | Binding | Migration |
|---|---|---|
| Test Results | RESULTS_DB | `0006_active_learning_execution_purpose.sql` |
| Test Evolution | TEST_EVOLUTION_DB | `0009_active_learning_approval_groups.sql` |
| Observation | OBSERVATION_DB | `0012_active_learning_sample_budget.sql` |

Não há migration nova no Gateway, Registry, Catalog, Runner ou Normalizer. As migrations antigas não foram alteradas.

**A 0012 do Observation reconstrói network_samples**, preservando as colunas/valores, FKs e índices da base enviada. Nenhuma tabela dos fontes fornecidos a referencia como tabela-pai. Antes de aplicar, conferir divergências do schema publicado, tabelas/triggers personalizados, backup e conta/binding. Não executar DROP manual nem desabilitar FKs. O teste de preservação foi feito em SQLite local, não D1 remoto.

Dentro de cada repositório, listar primeiro as pendentes e só aplicar após confirmar o destino e backup:

```bash
# qagent-test-results
npx wrangler d1 migrations list RESULTS_DB --remote
npx wrangler d1 migrations apply RESULTS_DB --remote

# qagent-test-evolution
npx wrangler d1 migrations list TEST_EVOLUTION_DB --remote
npx wrangler d1 migrations apply TEST_EVOLUTION_DB --remote

# qagent-observation
npx wrangler d1 migrations list OBSERVATION_DB --remote
npx wrangler d1 migrations apply OBSERVATION_DB --remote
```

Se a publicação usa `--env`, acrescentar o mesmo ambiente explicitamente. O comando aplica todas as migrations pendentes, não somente a FIX-2. Nenhum desses comandos remotos foi executado nesta entrega.

Referências operacionais oficiais consultadas: Cloudflare D1 Wrangler commands (`https://developers.cloudflare.com/d1/wrangler-commands/`) e foreign keys (`https://developers.cloudflare.com/d1/sql-api/foreign-keys/`).

## 9. Publicação e configuração

1. Conferir os diffs contra os repositórios realmente publicados; preservar variáveis, bindings, secrets, IDs, flags e overrides locais.
2. Instalar dependências e resolver os gates oficiais de teste/build no ambiente de homologação.
3. Aplicar as migrations novas nos destinos conferidos, antes dos novos emissores.
4. Publicar Test Registry, Catalog e Test Results compatíveis; depois Test Evolution. Publicar Gateway e Runner compatíveis antes de usar os controles novos da Console.
5. Publicar Normalizer e Observation atualizados antes do Plugin. A migration de Observation precede sua versão nova. Só atualizar o Plugin após ambos os receptores estarem prontos.
6. Publicar Console e iniciar por uma consulta GET do projeto piloto. O fluxo não exige novo monitoramento para aprender de uma fonte parcial existente.

Os repositórios completos conservam os wrangler da base original: por exemplo, a flag `OBSERVED_BASELINE_GENERATION_ENABLED` do Gateway original estava desligada. **Preserve a configuração já ativada por você e OBSERVED_BASELINE_PROJECT_IDS.** A FIX-2 não precisa de flag nova, novo banco de aprendizagem ou secret de IA novo. Policy/configuração da Evolution existente continuam necessárias.

O ZIP CHANGED-FILES contém só arquivos novos/alterados, incluindo package.json e as três migrations novas, sem wrangler/lockfiles. Não usar esse pacote como substituto de um repositório completo.

## 10. Smoke recomendado sem recaptura

- Abrir `GET /web/index.php/api/v2/recruitment/candidates`, na versão atual com request COMPLETE e response/self-check PARTIAL.
- Abrir o painel, selecionar a baseline e o mesmo ambiente da fonte.
- Analisar. Se houver evidência compatível entre os resultados recentes, revisar a proposta. Se não houver, aparecerá a possibilidade de executar para aprender, sujeita ao preflight.
- Autorizar a consulta de aprendizagem. O resultado pode ter status/content type aprovados e schema ainda NOT_EVALUATED. Isso não é aprovação da regressão completa.
- Concluído o Run, analisar de novo. A estrutura recebida deve fundamentar a proposta e a origem da execução deve estar identificada.
- Revisar o diff, informar o motivo e aplicar. Conferir nova versão, origem antiga preservada, request/fingerprint inalterados e referência nova de enriquecimento.
- Autorizar verificação. Somente a execução posterior confirma ou refuta a mudança. O painel mostra o outcome do ledger de Evolution.
- Atualizar inventário e materializar novo snapshot para uma regressão normal. Não reexecutar um snapshot antigo esperando expectativas novas.

Controle negativo obrigatório: alterar um tipo já protegido ou retornar status divergente na fixture. O caso deve continuar falhando e não criar uma proposta que enfraqueça essa regra. Fonte vencida, dados incompletos da request ou secret ausente devem permanecer bloqueados.

Para lote: selecionar dois cenários do mesmo Test Design com evidência compatível; analisar, aprovar alterações selecionadas e conferir **um append**. Duas propostas conflitantes na mesma assertion não devem ser mescladas silenciosamente.

## 11. Testes e limites de validação

Ver VALIDATION-REPORT para contagens e comandos. Resumo: 71 testes novos Node passaram; fluxos locais integrados de baseline, lote/idempotência, segurança, Run Control, captura e migration passaram; oito checkpoints Chromium passaram. As respostas da aplicação e da IA foram controladas nas fixtures.

O build Next não concluiu: npm ci retornou `Exit handler never called!`, e `npm run build` parou em `next: not found`. As chains de Catalog/Normalizer/Observation pararam em Wrangler ausente; Plugin em tipos de Chrome ausentes. Runner mantém uma falha preexistente de expectativa de configuração de mutação. Não se declara aprovação desses gates.

Os testes de browser usaram componentes reais com React 18.2 disponível no ambiente e adaptadores de navegação/auth; não são a aplicação Next com React 19 lockado e o provider real. Falta smoke nessa composição e D1/filas remotos no ambiente do usuário.

## 12. Rollback e limites funcionais

Não disparar novos controles de aprendizagem durante rollback. Como novas versões podem conter enrichment/purpose, não reverter leitores/validadores incompatíveis enquanto houver esses dados em uso. Preservar migrations e histórico; não apagar fontes/propostas/Results para reverter UI. Retomar versões antigas explicitamente é decisão operacional separada.

Esta entrega não resolve automaticamente qualquer falta de Test Data, não inventa secrets, não torna qualquer negativo correto, não executa até obter verde e não declara maturidade com base em repetição da mesma resposta. Continua usando classificação/política e verificação do Evolution existente. Alterações de negócio nos invariantes protegidos permanecem assunto de revisão da baseline, não enriquecimento de lacuna.

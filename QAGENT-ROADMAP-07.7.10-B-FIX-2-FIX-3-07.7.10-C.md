# QAgent — Mutation Safety → Controlled CRUD → Suite Results

**Status:** PLANNED / ARCHITECTURAL HANDOFF  
**Baseline:** Foundation 07.7.10-B + FIX-1 production validated  
**Next sequence:**

```text
07.7.10-B ✅
Read-only Suite Orchestration

↓

07.7.10-B FIX-2
Mutation Safety Contract
+ Durable Mutation Journal
+ Environment Mutation Policy
+ Retry Safety
+ Side-effect Preflight
+ Suite Run Eligibility v2

↓

07.7.10-B FIX-3
Controlled POST / PUT / PATCH / DELETE
+ real STG validation

↓

07.7.10-C
Suite Results & Regression History
```

---

# 1. Objetivo

Fechar o cenário básico de automação real de API do QAgent com segurança e governança.

O QAgent já consegue:

```text
monitorar aplicação real
→ descobrir APIs
→ consolidar schemas/evidências
→ gerar Test Designs
→ persistir versões imutáveis
→ resolver Environment/Runtime/Auth/Test Data
→ executar GET/HEAD/OPTIONS
→ avaliar Assertions
→ persistir Results
→ montar Auto Suite zero-config
→ executar Suite multi-endpoint com fan-out durável
→ agregar PASSED/FAILED/ERROR
```

A lacuna atual é a execução de **mutations de negócio**:

```text
POST / PUT / PATCH / DELETE
```

Hoje esses cenários podem estar semanticamente `READY`, mas são bloqueados pelo Runner antes do HTTP por:

```text
RUNNER_HTTP_SIDE_EFFECT_METHOD_DISABLED
```

Isso é proposital e correto até existir um mecanismo durável para garantir:

- autorização explícita por ambiente;
- rastreabilidade do side effect;
- retry seguro;
- comportamento fail-closed quando não é possível saber se o request foi aplicado;
- isolamento multi-tenant;
- execução conservadora em PROD;
- ausência de secrets no journal/logs/results;
- integração correta com Suite Run.

A meta desta sequência é chegar a:

```text
Suite READY
  ├── GET    → executável
  ├── POST   → executável se policy do Environment permitir
  ├── PUT    → executável se policy do Environment permitir
  ├── PATCH  → executável se policy do Environment permitir
  └── DELETE → executável se policy do Environment permitir

                ↓

        Durable Mutation Journal
                ↓

        Runner / HTTP Executor
                ↓

          Results / Dashboard
```

---

# 2. Estado atual congelado

## 2.1 07.7.10-B validada em produção

A regressão zero-config atualmente foi validada com:

```text
suitev_2
4 endpoints executáveis
21 cenários executáveis

srun_*
4/4 endpoints concluídos
4 passed
0 failed
0 error
PASSED
```

O fan-out server-side e o fluxo completo Runner → Results funcionaram.

## 2.2 Estado atual de mutations

### Test Registry

Arquivo existente:

```text
qagent-test-registry/src/domain/executionEligibility.js
```

Hoje contém:

```js
SAFE_METHODS = GET, HEAD, OPTIONS
SIDE_EFFECT_METHODS = POST, PUT, PATCH, DELETE
```

E mutations READY recebem:

```text
MUTATION_EXECUTION_DISABLED
```

A Auto Suite atual usa:

```text
qagent.suite-selection-policy.v1.1
LATEST_TEST_DESIGNS_EXECUTION_ELIGIBLE_SCENARIOS
```

Consequentemente a `suitev_2` contém somente os cenários read-only executáveis.

### Runner

Arquivos existentes relevantes:

```text
src/httpPolicy.js
src/httpExecutor.js
src/httpExecutionCoordinator.js
src/httpRequestBuilder.js
src/consumer.js
src/runnerControlClient.js
src/authRuntime.js
src/testDataRuntime.js
src/resultsClient.js
```

Classes existentes:

```text
HttpEgressPolicy
HttpScenarioExecutor
HttpExecutionCoordinator
AuthRuntimeCoordinator
TestDataRuntimeCoordinator
```

Hoje `HttpEgressPolicy.assertMethod()` bloqueia mutations quando:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
```

### Gateway

Arquivos existentes relevantes:

```text
src/services/runService.js
src/services/suiteRunService.js
src/repositories/runRepository.js
src/repositories/runExecutionClaimRepository.js
src/repositories/suiteRunRepository.js
src/handlers/internalRunnerControl.js
src/handlers/consoleRuns.js
src/handlers/consoleSuiteRuns.js
src/handlers/suiteRunQueue.js
src/lib/runContracts.js
src/lib/suiteRunContracts.js
src/routing/gatewayRouter.js
```

Migrations atuais do Gateway vão até:

```text
0015_foundation_07_7_10_b_suite_run_orchestration.sql
```

### Test Registry

Migrations atuais vão até:

```text
0004_foundation_07_7_10_b_suite_execution_items.sql
```

### Results Plane

`qagent-test-results` atualmente possui:

```text
result_sets
scenario_results
assertion_results
```

A tabela `scenario_results` já aceita métodos:

```text
GET POST PUT PATCH DELETE HEAD OPTIONS
```

Logo o Results Plane não precisa ser redesenhado para aceitar CRUD; precisa apenas receber correlações adicionais quando necessário.

### Console

Arquivos atuais relevantes:

```text
app/projects/automation/page.tsx
components/automation/RegressionReadiness.tsx
lib/automation.ts
lib/suiteRuns.ts
components/catalog/CatalogEndpointAutomationSnapshot.tsx
components/catalog/CatalogEndpointTestDesign.tsx
```

---

# 3. Invariantes arquiteturais — NÃO QUEBRAR

Estas regras são congeladas.

1. **Gateway = Run Control Plane.**
2. **Runner executa; Runner não escreve diretamente no QAGENT_DB.**
3. **Test Registry define Test Designs/Suites imutáveis.**
4. **Results Plane guarda evidência detalhada de execução.**
5. **Secrets nunca entram em Test Design, Suite, Queue, Runtime Snapshot, Execution Plan, Mutation Journal, logs ou Results.**
6. **Explicit user configuration sempre vence discovery.**
7. **Mutation permanece DENY por padrão.**
8. **Discovery nunca habilita mutation automaticamente.**
9. **Não habilitar mutations apenas por uma env var global.**
10. **Nenhum retry cego depois que um side effect pode ter sido enviado.**
11. **Toda decisão de mutation é tenant-scoped:** `organizationId + projectId + environmentId + endpointId + method`.
12. **Suite Version representa intenção de teste; Suite Run representa o que é executável naquele Environment.**
13. **Multi-tenant deve continuar eficiente: sem N+1 por endpoint/cenário.**
14. **Migrations já aplicadas são imutáveis.**
15. **POST de infraestrutura de Auth Runtime (ex.: `/oauth/token`) não é mutation de negócio e continua fora deste mecanismo.**

---

# 4. Arquitetura alvo

```text
                         TEST REGISTRY
                    ┌───────────────────────┐
                    │ latest Test Designs   │
                    │ Suite semantic READY │
                    │ suitev_* imutável     │
                    └──────────┬────────────┘
                               │ refs
                               ▼
                         QAGENT GATEWAY
        ┌────────────────────────────────────────────┐
        │ Run Control Plane                          │
        │                                            │
        │ Environment Mutation Policy                │
        │ Mutation Policy Versions                   │
        │ Durable Mutation Journal                   │
        │ Mutation Journal Events                    │
        │ Suite Run Eligibility v2                   │
        │ Suite Run Execution Units                  │
        │                                            │
        │ run_* / srun_* / attempt / lease          │
        └──────────────┬─────────────────────────────┘
                       │ internal HMAC control
                       ▼
                         QAGENT RUNNER
        ┌────────────────────────────────────────────┐
        │ Side-effect Preflight                      │
        │ Test Data Runtime                          │
        │ Auth Runtime JIT                           │
        │ Mutation request fingerprint               │
        │ Dispatch Intent                            │
        │ HTTP                                       │
        │ Mutation Response                          │
        │ Assertions                                 │
        │ Mutation Complete                          │
        └──────────────┬─────────────────────────────┘
                       │ sanitized evidence
                       ▼
                    QAGENT TEST RESULTS
        ┌────────────────────────────────────────────┐
        │ rset_* / sres_* / ares_*                  │
        │ mutationExecutionId reference              │
        │ no raw body / no secret                    │
        └────────────────────────────────────────────┘
```

---

# 5. Decisão central: Suite Definition ≠ Environment Eligibility

A Auto Suite atual (`v1.1`) remove mutations antes de materializar a Suite.

Isso foi correto para a fase read-only, mas não é o modelo definitivo.

## Modelo alvo

### Test Registry

Suite congela **todos os cenários semanticamente READY**:

```text
Suite Version
READY scenarios = 24

GET 21
POST 2
PUT 1
```

A Suite não decide se STG ou PROD pode mutar dados.

### Gateway / Suite Run

Ao criar:

```text
suitev_3 + Environment STG
```

Gateway calcula:

```text
READY                         24
safe read-only                21
mutation allowed in STG        2
mutation policy hold           1
--------------------------------
EXECUTION PLAN                23
```

Em PROD a mesma Suite pode gerar:

```text
READY                         24
safe read-only                21
mutation allowed               0
mutation policy hold           3
--------------------------------
EXECUTION PLAN                21
```

Isso preserva corretamente:

```text
Test Registry = intenção imutável
Gateway       = policy/runtime por Environment
```

---

# 6. 07.7.10-B FIX-2 — Mutation Safety Contract

**Objetivo:** construir toda a infraestrutura de segurança e governança **sem liberar HTTP mutation de negócio ainda**.

Ao final do FIX-2:

```text
POST/PUT/PATCH/DELETE continuam bloqueados no HTTP Executor
```

mas policy, journal, preflight e Suite Run Eligibility v2 já estarão funcionais e testáveis.

---

# 7. FIX-2 / Etapa A — Contracts congelados

Criar no Gateway:

```text
src/lib/mutationContracts.js                         NEW
```

Contratos sugeridos:

```text
qagent.mutation-policy.v1
qagent.mutation-policy-version.v1
qagent.mutation-preflight.v1
qagent.mutation-dispatch-intent.v1
qagent.mutation-response.v1
qagent.mutation-complete.v1
qagent.mutation-journal.v1
qagent.suite-run-eligibility.v2
```

Schemas:

```text
docs/contracts/qagent.mutation-policy.v1.schema.json
docs/contracts/qagent.mutation-preflight.v1.schema.json
docs/contracts/qagent.mutation-dispatch-intent.v1.schema.json
docs/contracts/qagent.mutation-response.v1.schema.json
docs/contracts/qagent.mutation-journal.v1.schema.json
```

## Mutation methods

```text
POST
PUT
PATCH
DELETE
```

Não assumir que PUT ou DELETE são idempotentes apenas pela semântica HTTP.

---

# 8. FIX-2 / Etapa B — Environment Mutation Policy

## Serviço proprietário

**Gateway**, pois policy de execução é Runtime/Control Plane, não definição de Test Design.

## Novos arquivos

```text
src/repositories/mutationExecutionPolicyRepository.js    NEW
src/services/mutationExecutionPolicyService.js            NEW
src/handlers/consoleMutationPolicies.js                    NEW
```

## Persistência

Nova migration Gateway:

```text
0016_foundation_07_7_10_b_fix_2_mutation_safety.sql
```

Criar:

```text
mutation_execution_policies
mutation_execution_policy_versions
mutation_execution_journal
mutation_execution_events
suite_run_execution_units
```

### mutation_execution_policies

Root estável:

```text
policy_id                  mup_*
organization_id
project_id
environment_id
endpoint_id
method
status                     ACTIVE / DISABLED
latest_version
latest_version_id
created_at
updated_at

UNIQUE(org, project, environment, endpoint, method)
```

### mutation_execution_policy_versions

Versões imutáveis:

```text
policy_version_id          mupv_*
policy_id
version
organization_id
project_id
environment_id
endpoint_id
method

execution_decision         ALLOW / DENY
retry_mode                 NO_AUTOMATIC_RETRY / IDEMPOTENCY_HEADER
idempotency_header_name    nullable
production_confirmation    boolean
reason                     nullable
created_by_user_id
created_at
```

## Regras

### Default

```text
policy inexistente = DENY
```

### Discovery

```text
discovery jamais cria ALLOW
```

### Scope v1

Somente policy exata:

```text
organization
+ project
+ environment
+ endpoint
+ method
```

Não criar `ALLOW ALL POST` por Project na primeira versão.

### PROD

Para `environmentType=PROD`:

```text
policy ALLOW
+
Suite Run / Run confirmation explícita
```

### DEV/STG

```text
policy ALLOW explícita
```

é suficiente.

---

# 9. FIX-2 / Etapa C — Durable Mutation Journal

## Novos arquivos

```text
src/repositories/mutationExecutionJournalRepository.js     NEW
src/services/mutationExecutionJournalService.js             NEW
```

Opcionalmente um coordenador:

```text
src/services/mutationExecutionPreflightService.js           NEW
```

## Journal root

Tabela:

```text
mutation_execution_journal
```

Campos principais:

```text
mutation_execution_id          mex_*
organization_id
project_id
environment_id
endpoint_id

run_id
scenario_id
first_attempt_id
latest_attempt_id
test_design_version_id

method
canonical_path
policy_version_id
retry_mode
idempotency_header_name
idempotency_key_hash
request_fingerprint

state
network_dispatch_may_have_occurred
http_status_code
last_error_code

prepared_at
dispatching_at
response_received_at
asserted_at
completed_at
unknown_at
created_at
updated_at

UNIQUE(run_id, scenario_id)
```

**Importante:** usar `UNIQUE(run_id, scenario_id)` e não `attempt_id`, para uma Queue redelivery/retry encontrar o mesmo journal.

## Estados

```text
PREPARED
POLICY_DENIED
FAILED_BEFORE_DISPATCH
DISPATCHING
RESPONSE_RECEIVED
ASSERTED
COMPLETED
UNKNOWN_SIDE_EFFECT
```

### Semântica

```text
PREPARED
policy validada; nenhum request de negócio pode ter saído ainda

DISPATCHING
intent de envio duravelmente registrado;
a partir daqui o side effect pode ter acontecido

RESPONSE_RECEIVED
houve resposta HTTP conhecida

COMPLETED
assertions/results finalizaram

UNKNOWN_SIDE_EFFECT
request pode ter chegado à aplicação, mas não existe confirmação segura
```

## Event log

Tabela append-only:

```text
mutation_execution_events
```

Campos:

```text
event_id
mutation_execution_id
organization_id
project_id
run_id
scenario_id
from_state
to_state
event_code
safe_diagnostics_json
created_at
```

Nunca persistir:

```text
Authorization
Cookie
password
token
clientSecret
apiKey
request body
response body
query values
raw path params
```

---

# 10. FIX-2 / Etapa D — Request Fingerprint

O fingerprint deve ser calculado no Runner depois de Test Data materializado, mas antes do `fetch`.

Criar no Runner:

```text
src/mutationSafety.js                 NEW
```

Classe proposta:

```text
MutationSafetyCoordinator
```

Funções auxiliares propostas:

```text
buildMutationRequestFingerprint()
buildMutationIdempotencyKey()
isMutationMethod()
```

## Fingerprint

SHA-256 sobre representação canônica da operação:

```text
method
origin
materialized path          HASH ONLY
materialized query         HASH ONLY
body bytes                 HASH ONLY
content-type
scenarioId
runId
```

Excluir do fingerprint persistido:

```text
Authorization
Cookie
Auth JIT material
```

O Gateway recebe somente o hash final.

---

# 11. FIX-2 / Etapa E — Side-effect Preflight ANTES de Auth/Test Data

Este é o antigo Side-Effect Preflight que agora passa a ser requisito de segurança.

## Ordem atual aproximada

```text
claim
→ runtime
→ test data
→ auth
→ HTTP
```

## Ordem alvo

```text
claim
→ runtime ready
→ MUTATION POLICY PREFLIGHT
→ test data
→ auth
→ mutation dispatch prepare
→ HTTP
→ response journal
→ assertions
→ complete journal
→ results
```

O preflight inicial não precisa do body final.

Ele verifica:

```text
org/project scope
run/attempt/lease
scenarioId
endpointId
method
environmentId
testDesignVersionId
policy atual
PROD confirmation
```

Se DENY:

```text
MUTATION_POLICY_DENIED
```

E deve parar **antes** de:

```text
Auth JIT
Test Data materialization
HTTP
```

---

# 12. FIX-2 / Etapa F — Runner Control APIs

Estender o arquivo existente:

```text
qagent-gateway/src/handlers/internalRunnerControl.js
```

Adicionar handlers propostos:

```text
postInternalRunnerMutationPreflight()
postInternalRunnerMutationDispatching()
postInternalRunnerMutationResponseReceived()
postInternalRunnerMutationComplete()
postInternalRunnerMutationUnknown()
```

Rotas internas sugeridas:

```text
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/preflight
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/dispatching
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/response-received
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/complete
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/unknown
```

Todas continuam protegidas pelo mecanismo existente:

```text
RUNNER_CONTROL_HMAC_SECRET
attemptId
leaseToken
run scope
```

No Runner estender:

```text
src/runnerControlClient.js
```

com:

```text
prepareMutationExecution()
recordMutationDispatching()
recordMutationResponseReceived()
completeMutationExecution()
markMutationUnknownSideEffect()
```

---

# 13. FIX-2 / Etapa G — Mutation Isolation v1

Para reduzir drasticamente o risco de retry, a primeira versão deve impor:

```text
1 side-effect scenario por run_*
```

Não permitir inicialmente:

```text
run_*
  POST cenário 1
  POST cenário 2
  DELETE cenário 3
```

Motivo:

se cenário 1 aplica efeito e cenário 3 sofre falha transitória, um retry do Run inteiro poderia repetir cenário 1.

## Regra

Em `qagent-gateway/src/services/runService.js`:

```text
safe-only run
→ vários cenários permitido

mutation run
→ exatamente 1 cenário mutation
→ sem mistura safe + mutation
```

Código de erro sugerido:

```text
MUTATION_RUN_REQUIRES_SINGLE_SCENARIO
```

O Console deve refletir essa regra para execução manual no Endpoint Detail.

---

# 14. FIX-2 / Etapa H — Suite Run Eligibility v2

## Problema

A Suite v2 atual remove mutation no Test Registry.

## Evolução

### Test Registry

Evoluir:

```text
src/domain/executionEligibility.js
src/repository/suiteRepository.js
src/domain/suiteContracts.js
```

Novo selection policy:

```text
qagent.suite-selection-policy.v2
LATEST_TEST_DESIGNS_READY_SCENARIOS
```

A Auto Suite deve materializar **todos os READY**, independentemente de Environment.

Os campos já existentes na projection possuem:

```text
readyScenarioIds
method
endpointId
testDesignVersionId
```

Logo esta evolução pode ser feita sem parse pesado do `specification_json` e, idealmente, sem migration nova no Registry.

Resultado esperado:

```text
suitev_3
READY scenarios = 24
```

A `suitev_2` permanece imutável e histórica.

### Gateway

`src/services/suiteRunService.js` passa a resolver execution eligibility por Environment.

Para cada slice do Registry:

```text
GET/HEAD/OPTIONS
→ ALLOW

POST/PUT/PATCH/DELETE
→ batch policy lookup no Gateway D1
→ ALLOW ou POLICY_HOLD
```

**Não fazer uma query D1 por endpoint.**

Implementar batch lookup:

```text
listMutationPoliciesForEndpoints(
  organizationId,
  projectId,
  environmentId,
  endpointIds[]
)
```

Uma query por slice.

---

# 15. FIX-2 / Etapa I — Suite Run Execution Units

Criar tabela:

```text
suite_run_execution_units
```

Ela é o plano environment-specific congelado do `srun_*`.

Campos:

```text
execution_unit_id            sru_*
suite_run_id
organization_id
project_id
ordinal
source_suite_item_ordinal
endpoint_id
test_design_version_id
test_design_version
method
scenario_ids_json
scenario_count
execution_kind               READ_ONLY_BATCH / MUTATION_SINGLE
decision                     EXECUTE / POLICY_HOLD
policy_version_id            nullable
retry_mode                   nullable
status                       PLANNED / RUN_CREATED / COMPLETED / ERROR / POLICY_HELD
run_id                       nullable
last_error_code
created_at
updated_at
```

### Safe endpoint

```text
GET endpoint com 8 READY
→ 1 execution unit
→ 8 scenarioIds
```

### Mutation endpoint

```text
POST endpoint com 2 READY
policy ALLOW
→ 2 execution units
→ 1 scenario por unit
```

### Mutation policy DENY

```text
POST endpoint com 2 READY
policy DENY
→ units POLICY_HELD
→ nenhum run_* criado
```

Isso mantém Mutation Isolation v1 sem perder a semântica da Suite.

---

# 16. FIX-2 / Etapa J — Suite Run state model

Suite Run deve ganhar fase de planejamento.

Estado recomendado:

```text
CREATED
→ PLANNING
→ QUEUED
→ DISPATCHING
→ RUNNING
→ PASSED / FAILED / ERROR / CANCELLED
```

Durante PLANNING:

```text
suitev_* slices
+
Environment policies
→ suite_run_execution_units
→ eligibilityFingerprint
→ policySnapshotHash
```

Novos counts no `suite_runs`:

```text
ready_scenario_count
executable_scenario_count
policy_held_scenario_count
read_only_scenario_count
mutation_scenario_count
mutation_enabled_scenario_count
mutation_held_scenario_count
execution_unit_count
policy_snapshot_hash
eligibility_policy_version
```

Não reinterpretar `suitev_*` durante a execução.

---

# 17. FIX-2 / Etapa K — Console Mutation Governance

## Novos arquivos sugeridos

```text
qagent-console/lib/mutationPolicies.ts                  NEW
qagent-console/components/automation/MutationPolicyPanel.tsx   NEW
```

Alterar:

```text
components/automation/RegressionReadiness.tsx
lib/suiteRuns.ts
components/catalog/CatalogEndpointAutomationSnapshot.tsx
```

## Endpoint Detail

Mutation endpoint deve mostrar:

```text
MUTATION EXECUTION

Environment       STG
Method            POST
Policy            DENY / ALLOW
Retry mode        NO AUTOMATIC RETRY

[ Permitir execução em STG ]
```

Para PROD:

```text
⚠ Production mutation
Explicit policy + execution confirmation required
```

## Automation Center

Ao selecionar Environment específico:

```text
READY                     24
READ-ONLY                  21
MUTATION ENABLED            2
POLICY HOLD                 1
EXECUTABLE NOW             23
```

O bloco Policy Hold deve oferecer:

```text
Configurar →
```

---

# 18. FIX-2 / Etapa L — Performance / Multi-tenant

Esta etapa deve ser projetada para muitos tenants desde o início.

## Regras

### Nenhum N+1

Proibido:

```text
for endpoint:
  SELECT mutation policy
```

Usar:

```text
1 Registry slice
+ 1 batch policy query
+ batch inserts execution units
```

### Hot path

Continuar usando:

```text
test_design_execution_inventory
```

Não voltar a parsear `specification_json` no dashboard.

### Journal indexes

Criar índices:

```text
(org, project, run_id)
(org, project, environment_id, created_at DESC)
(run_id, scenario_id)
(state, updated_at)
```

### Event retention

Journal/eventos são pequenos e metadata-only.

No futuro retention/archival pode ser adicionado, mas não mover o journal para Results Plane: ele pertence ao Control Plane porque interfere diretamente em retry/execução.

### Suite planning

Continuar bounded por Queue:

```text
slice <= 25
fan-out bounded
child concurrency bounded
```

Não materializar uma Suite de milhares de endpoints em um único request HTTP síncrono.

---

# 19. FIX-2 / Etapa M — Tests e Production Gate

## Gateway tests

Criar:

```text
test/test-foundation-07-7-10-b-fix-2-mutation-policy.js
test/test-foundation-07-7-10-b-fix-2-mutation-journal-sqlite.js
test/test-foundation-07-7-10-b-fix-2-suite-run-eligibility-v2.js
```

Testar SQLite real para journal e transitions.

### Casos obrigatórios

```text
policy missing → DENY
policy STG ALLOW → eligible
policy tenant A não vale para tenant B
policy env STG não vale para PROD
policy endpoint A não vale para endpoint B
PROD exige confirmation
journal UNIQUE(runId, scenarioId)
PREPARED replay é idempotente
invalid transition fail-closed
DISPATCHING não volta para PREPARED
UNKNOWN_SIDE_EFFECT terminal
no secret/raw body columns
batch policy resolution sem N+1
```

## Runner tests

No FIX-2 mutations ainda não fazem HTTP.

Testar:

```text
preflight acontece antes de test data/auth
DENY → auth não chamado
DENY → test data não chamado
DENY → HTTP não chamado
mutation sem preflight → fail closed
safe GET não depende de mutation journal
```

## Registry tests

```text
suite selection policy v2 usa READY
suitev antiga permanece imutável
mutation READY entra na nova suite
projection-only hot path
```

## Console tests

```text
policy hold visível
STG allow control
PROD warning
counts environment-specific
```

## Production Gate FIX-2

Não executar mutation real ainda.

Validar:

```text
1. Suite nova contém 24 READY
2. STG sem policy: 21 executable + 3 held
3. habilitar exatamente 1 mutation em STG
4. Suite Run planning mostra 22 executable + 2 held
5. Runner preflight reconhece ALLOW
6. HTTP mutation ainda permanece globalmente bloqueado
```

Somente depois disso iniciar FIX-3.

---

# 20. 07.7.10-B FIX-3 — Controlled POST/PUT/PATCH/DELETE

**Objetivo:** ligar de verdade o HTTP de mutations, usando obrigatoriamente a infraestrutura construída no FIX-2.

Nenhum novo caminho bypassa policy/journal.

---

# 21. FIX-3 / Etapa A — Remover o toggle como autoridade

Hoje existe:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS
```

Ele não deve ser suficiente para executar mutation.

## Novo modelo

Criar kill switch:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

Para executar uma mutation devem ser verdadeiros **todos**:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=true
+
Mutation Policy ALLOW
+
valid Runner preflight
+
valid journal state
+
valid run/attempt/lease
+
Environment allowed
```

`RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS` deve ser removido/deprecated como autoridade de segurança.

---

# 22. FIX-3 / Etapa B — Runner MutationSafetyCoordinator

Novo arquivo:

```text
qagent-runner/src/mutationSafety.js
```

Classe:

```text
MutationSafetyCoordinator
```

Responsabilidades:

```text
classify method
preflight policy
hold mutationExecutionId in memory
build request fingerprint
manage deterministic idempotency key
record DISPATCHING before fetch
record RESPONSE_RECEIVED
record UNKNOWN_SIDE_EFFECT
complete after assertions
expose retry decision
```

Integrar em:

```text
src/consumer.js
src/httpExecutionCoordinator.js
src/httpExecutor.js
src/httpPolicy.js
src/httpRequestBuilder.js
src/runnerControlClient.js
```

---

# 23. FIX-3 / Etapa C — HTTP Executor mutation permit

Evoluir:

```text
HttpEgressPolicy.assertMethod(method)
```

para conceitualmente:

```text
assertMethod(method, mutationPermit)
```

Safe methods:

```text
GET/HEAD/OPTIONS → normal
```

Mutation:

```text
POST/PUT/PATCH/DELETE
→ mutation permit obrigatório
→ journal PREPARED obrigatório
→ global kill switch enabled
```

Sem permit:

```text
RUNNER_MUTATION_PERMIT_REQUIRED
```

---

# 24. FIX-3 / Etapa D — Dispatch Intent boundary

A ordem exata antes do `fetch` deve ser:

```text
build request
↓
compute requestFingerprint
↓
Gateway journal transition PREPARED → DISPATCHING
↓
Gateway confirms durable write
↓
fetch()
```

**Nunca:**

```text
fetch()
↓
marcar journal depois
```

Porque um crash entre os dois perderia a evidência de que o side effect pode ter saído.

`DISPATCHING` significa conservadoramente:

```text
network dispatch may have occurred
```

---

# 25. FIX-3 / Etapa E — Retry Safety state machine

Esta é a regra mais importante da implementação.

## Falha antes de DISPATCHING

Exemplos:

```text
policy service temporariamente indisponível
auth falhou antes do request
test data falhou
request builder falhou
```

Resultado:

```text
FAILED_BEFORE_DISPATCH
```

Retry do Run pode ser permitido conforme retry policy existente.

## Falha depois de DISPATCHING, sem resposta

Exemplos:

```text
timeout
connection reset
Worker crash
network failure
```

Se:

```text
retryMode = NO_AUTOMATIC_RETRY
```

então:

```text
UNKNOWN_SIDE_EFFECT
→ terminal
→ NÃO retry automático
```

Código sugerido:

```text
MUTATION_SIDE_EFFECT_UNKNOWN
```

## Idempotency header explicitamente configurado

Se policy define:

```text
retryMode = IDEMPOTENCY_HEADER
idempotencyHeaderName = Idempotency-Key
```

Runner gera chave determinística a partir de:

```text
mutationExecutionId
```

A mesma chave é reutilizada em retry.

Persistir apenas:

```text
idempotency_key_hash
```

Nunca depender de o QAgent “adivinhar” que um endpoint suporta idempotência.

### Primeira versão

Mesmo com idempotency header, manter Mutation Isolation v1: um side-effect scenario por run.

---

# 26. FIX-3 / Etapa F — Response semantics

## HTTP response conhecida

Ao receber qualquer response HTTP:

```text
2xx / 3xx / 4xx / 5xx
```

transicionar:

```text
DISPATCHING → RESPONSE_RECEIVED
```

Não retry automaticamente só porque veio 5xx.

A aplicação pode ter aplicado o side effect antes de responder 500.

Assertions decidem PASSED/FAILED normalmente.

## Crash depois de RESPONSE_RECEIVED e antes de Assertions

Sem response body durável por segurança.

Se não for possível concluir assertions após redelivery:

```text
MUTATION_RESPONSE_NOT_REPLAYABLE
```

Não repetir mutation sem idempotency contract.

Esta condição deve ser terminal/reviewable, não retry cego.

---

# 27. FIX-3 / Etapa G — Results Plane correlation

O Results Plane já aceita métodos mutation.

Adicionar apenas correlação segura.

Migration sugerida:

```text
qagent-test-results/migrations/0002_foundation_07_7_10_b_fix_3_mutation_refs.sql
```

Adicionar nullable em `scenario_results`:

```text
mutation_execution_id
mutation_retry_mode
side_effect_state
```

Ou, se ALTER não for desejável, criar tabela de refs:

```text
scenario_mutation_refs
```

Preferência: tabela de refs separada se quisermos manter `0001` simples e evitar rebuild.

Nunca duplicar o Journal inteiro no Results Plane.

Results guarda:

```text
mex_* reference
safe terminal state
```

Gateway continua autoridade do Journal.

---

# 28. FIX-3 / Etapa H — Suite Orchestrator

`qagent-gateway/src/services/suiteRunService.js` deve dispatchar:

```text
READ_ONLY_BATCH
→ 1 run por endpoint com vários cenários

MUTATION_SINGLE
→ 1 run por scenario mutation
```

Exemplo:

```text
GET /models
8 cenários
→ run_A com 8 cenários

POST /vote
2 cenários mutation enabled
→ run_B test_001
→ run_C test_006
```

Isso mantém retry isolation.

Suite aggregate continua por execution unit/child.

---

# 29. FIX-3 / Etapa I — Console execution UX

Na Central de Automação:

```text
READY                      24
READ-ONLY                   21
MUTATION ENABLED             2
POLICY HOLD                  1
EXECUTABLE NOW              23
```

Antes de executar PROD:

```text
⚠ Esta regressão contém 2 mutations em PROD.
Confirme explicitamente para continuar.
```

Em STG:

```text
2 mutations autorizadas
1 mutation em policy hold
```

Durante Suite Run:

```text
Read-only        21/21
Mutations         2/2
Policy held       1
```

---

# 30. FIX-3 / Real STG Validation

Não marcar FIX-3 como concluída somente com unit tests.

Validar em ambiente STG com dados descartáveis/controlados.

## Matriz mínima

### Policy

```text
POST policy DENY
→ bloqueado antes de Auth/Test Data/HTTP

POST policy ALLOW STG
→ chega ao HTTP

policy tenant A
→ não afeta tenant B

policy STG
→ não afeta PROD
```

### POST

```text
POST real 2xx
→ journal COMPLETED
→ assertion PASSED
→ rset_* persistido
```

### PUT

```text
PUT real 2xx
→ COMPLETED
```

### PATCH

```text
PATCH real se existir endpoint seguro no STG
```

Se não houver endpoint PATCH real disponível, manter contract/integration test e registrar como validação pendente específica; não inventar endpoint.

### DELETE

Executar somente em recurso disposable criado para o teste.

```text
DELETE 200/204
→ COMPLETED
```

### Retry before dispatch

```text
falha antes do DISPATCHING
→ retry permitido
→ mutation executada uma única vez
```

### Network uncertainty

Simular:

```text
DISPATCHING
→ network response desconhecida
```

Sem idempotency:

```text
UNKNOWN_SIDE_EFFECT
→ queue não reenvia mutation
```

### Queue duplicate delivery

```text
mesma run/scenario
→ mesmo mex_*
→ não cria journal duplicado
```

### Idempotency header

Somente em endpoint explicitamente configurado como compatível:

```text
retry
→ mesma idempotency key
→ sem efeito duplicado
```

---

# 31. FIX-3 / Production Gate final

Só liberar mutations para Auto Suite depois que estes gates passarem:

```text
[ ] POST STG real validado
[ ] PUT STG real validado
[ ] DELETE STG real validado
[ ] PATCH real ou explicitamente pendente por falta de endpoint seguro
[ ] DENY antes de Auth comprovado
[ ] no retry after unknown side effect comprovado
[ ] queue redelivery idempotente comprovado
[ ] tenant isolation comprovado
[ ] environment isolation comprovado
[ ] journal sem secrets comprovado
[ ] Results ref mex_* comprovada
[ ] Suite mixed read-only + mutations comprovada
[ ] production confirmation fail-closed comprovada
```

Somente então:

```text
07.7.10-B FIX-3 — PRODUCTION VALIDATED ✅
```

---

# 32. 07.7.10-C — Suite Results & Regression History

Somente iniciar depois de FIX-3.

O objetivo é transformar `srun_*` em histórico durável e analytics de regressão.

---

# 33. 07.7.10-C / Results architecture

Hoje:

```text
Gateway
srun_* lifecycle

Results Plane
rset_* por child run
```

Precisamos conectar os dois sem colocar detailed results no Gateway.

## Opção recomendada

Results Plane ganha uma representação de Suite Result:

```text
suite_result_sets
```

ID:

```text
srset_*
```

Campos:

```text
suite_result_set_id
organization_id
project_id
suite_run_id
suite_id
suite_version_id
environment_id
outcome
started_at
completed_at
duration_ms

endpoint_count
execution_unit_count
scenario_count
passed_scenario_count
failed_scenario_count
error_scenario_count
assertion_count
assertion_passed_count
assertion_failed_count
mutation_count
mutation_completed_count
mutation_unknown_count
policy_held_count
created_at
```

Imutável quando Suite Run terminaliza.

Gateway envia aggregate sanitized ao Results Plane via Service Binding.

Não escrever `RESULTS_DB` diretamente.

---

# 34. 07.7.10-C / Result correlation

Cada Result Set filho deve poder correlacionar:

```text
suiteRunId
suiteRunExecutionUnitId
```

Isso permite queries eficientes:

```text
Suite Run
→ child rset_*
```

sem N+1 no Gateway.

Se necessário, adicionar migration Results Plane:

```text
0003_foundation_07_7_10_c_suite_results.sql
```

---

# 35. 07.7.10-C / Read APIs

Results internal read API:

```text
GET project suite summary
GET recent suite runs
GET suite result detail
GET suite trend
GET failing endpoints
GET mutation health
```

Gateway BFF:

```text
GET /v1/console/projects/:projectId/automation/suites/summary
GET /v1/console/projects/:projectId/automation/suite-runs
GET /v1/console/projects/:projectId/automation/suite-runs/:suiteRunId
```

Browser continua sem acesso direto ao Results Plane.

---

# 36. 07.7.10-C / Console

Central de Automação:

```text
REGRESSION HEALTH

Last Regression       PASSED
Pass Rate             96.8%
Executed Scenarios    1,240
Mutation Scenarios       84
Policy Holds              3
Avg Duration           42s

────────────────────────────────

Regression Trend
[chart]

Pass Rate Trend
[chart]

Mutation Health
[chart]

────────────────────────────────

Recent Regressions

PASSED  STG  24 scenarios  42s
FAILED  STG  24 scenarios  40s
PASSED  DEV  18 scenarios  28s
```

Drill-down:

```text
Suite Run
  ↓
Execution Units
  ↓
run_*
  ↓
rset_*
  ↓
scenarios/assertions
```

Mutation deve mostrar:

```text
POST /orders
PASSED
Mutation state: COMPLETED
Policy: mupv_*
Journal: mex_*
```

Se incerto:

```text
⚠ UNKNOWN SIDE EFFECT
Manual review required
```

---

# 37. Serviços afetados por etapa

| Serviço | FIX-2 | FIX-3 | 07.7.10-C |
|---|---|---|---|
| qagent-gateway | **principal**: policy, journal, preflight, eligibility v2 | mutation control + orchestration | suite aggregate bridge/read BFF |
| qagent-runner | preflight plumbing, ainda bloqueado | **principal**: controlled HTTP mutation | pouca/nenhuma mudança |
| qagent-test-registry | Suite semantic READY v2 | sem mudança relevante | sem mudança relevante |
| qagent-test-results | nenhuma ou refs preparatórias | mutation refs | **principal**: suite results/history |
| qagent-console | policy/governance + env eligibility | enable/confirm mutation UX | dashboards/history/drilldown |
| qagent-catalog | nenhuma | nenhuma | opcional para labels/context |
| qagent-observation | nenhuma | nenhuma | nenhuma |
| qagent-normalizer | nenhuma | nenhuma | nenhuma |

---

# 38. Arquivos/classes — checklist consolidado

## Gateway — existentes a alterar

```text
src/services/runService.js
src/services/suiteRunService.js
src/repositories/suiteRunRepository.js
src/handlers/internalRunnerControl.js
src/handlers/consoleRuns.js
src/handlers/consoleSuiteRuns.js
src/handlers/suiteRunQueue.js
src/lib/runContracts.js
src/lib/suiteRunContracts.js
src/routing/gatewayRouter.js
```

## Gateway — novos

```text
src/lib/mutationContracts.js
src/repositories/mutationExecutionPolicyRepository.js
src/repositories/mutationExecutionJournalRepository.js
src/services/mutationExecutionPolicyService.js
src/services/mutationExecutionJournalService.js
src/services/mutationExecutionPreflightService.js
src/handlers/consoleMutationPolicies.js
```

## Runner — existentes a alterar

```text
src/consumer.js
src/httpPolicy.js
src/httpExecutor.js
src/httpExecutionCoordinator.js
src/httpRequestBuilder.js
src/runnerControlClient.js
src/resultsClient.js
```

## Runner — novo

```text
src/mutationSafety.js
```

Classe:

```text
MutationSafetyCoordinator
```

## Test Registry — alterar

```text
src/domain/executionEligibility.js
src/domain/suiteContracts.js
src/repository/suiteRepository.js
src/routes/suiteRoutes.js
```

## Results Plane — FIX-3/C

Alterar/criar conforme etapa:

```text
src/... result ingestion contract
src/... read repository/service
migrations/0002+ / 0003+
```

## Console

Alterar:

```text
components/automation/RegressionReadiness.tsx
lib/suiteRuns.ts
lib/automation.ts
components/catalog/CatalogEndpointAutomationSnapshot.tsx
```

Criar:

```text
lib/mutationPolicies.ts
components/automation/MutationPolicyPanel.tsx
```

---

# 39. Segurança e governança — critérios obrigatórios

## Nunca persistir no Mutation Journal

```text
Authorization
Bearer token
Cookie
password
apiKey
clientSecret
refreshToken
Vault values
raw request body
raw response body
query values
raw sensitive path values
```

## Pode persistir

```text
IDs internos
method
canonical path template
hash/fingerprint
policy refs
idempotency key hash
status code
state transitions
safe error codes
timestamps
counts
```

## Logs

Somente:

```text
mutationExecutionId
runId
scenarioId
method
canonical path
state
policyVersionId
retryMode
errorCode
```

Nunca valores do request.

---

# 40. Retry matrix congelada

| Momento | NO_AUTOMATIC_RETRY | IDEMPOTENCY_HEADER |
|---|---|---|
| antes de PREPARED | retry normal | retry normal |
| PREPARED, antes de DISPATCHING | retry normal | retry normal |
| DISPATCHING, sem response | **UNKNOWN / sem retry** | retry permitido com mesma key, Mutation Isolation v1 |
| RESPONSE_RECEIVED | sem reenvio cego | reenvio somente se recovery explicitamente suportado |
| COMPLETED | no-op/idempotent replay | no-op/idempotent replay |

Nunca usar `5xx` sozinho como autorização para retry de mutation.

---

# 41. Deploy order — FIX-2

```text
1. Gateway migration 0016
2. Gateway policy/journal code com mutation HTTP ainda disabled
3. Test Registry Suite semantic READY v2
4. Console policy UI
5. Runner preflight plumbing ainda fail-closed
6. validar production gate FIX-2
```

Não habilitar global mutation no Runner durante FIX-2.

---

# 42. Deploy order — FIX-3

```text
1. Gateway mutation services/routes finalizados
2. Runner MutationSafetyCoordinator
3. Results mutation refs
4. Console mutation execution UX
5. RUNNER_MUTATION_EXECUTION_ENABLED=true apenas no ambiente de validação
6. habilitar policy de 1 endpoint STG
7. POST real
8. PUT real
9. DELETE real
10. expandir gradualmente
```

Nunca começar habilitando todas as mutations do projeto.

---

# 43. Rollout progressivo sugerido

```text
Stage 1
STG + 1 POST endpoint + 1 scenario

Stage 2
STG + PUT

Stage 3
STG + DELETE disposable

Stage 4
STG Suite mixed read-only + mutations

Stage 5
mais tenants/projetos controlados

Stage 6
PROD somente com policy explícita e confirmation
```

---

# 44. O que NÃO fazer

Não implementar:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=true
```

como solução final.

Não fazer:

```text
Browser → loop POST /runs para mutation
```

Não assumir:

```text
PUT é sempre seguro para retry
DELETE é sempre seguro para retry
```

Não usar:

```text
5xx → retry automático
```

Não guardar body no Journal.

Não modificar migrations 0015/0004 ou anteriores.

Não deixar Test Registry depender de Environment Policy.

Não resolver mutation policy cenário por cenário com N+1 D1 queries.

Não permitir que discovery habilite mutation automaticamente.

---

# 45. Definition of Done da sequência

A sequência inteira estará fechada quando conseguirmos demonstrar:

```text
Aplicação real observada
→ API descoberta
→ Test Design gerado
→ mutation scenario READY
→ explicit STG policy ALLOW
→ Suite semantic snapshot
→ Suite Run environment eligibility
→ Mutation Journal PREPARED
→ Auth/Test Data
→ DISPATCHING durável
→ POST/PUT/DELETE real
→ RESPONSE_RECEIVED
→ Assertions
→ COMPLETED
→ rset_* persistido
→ Suite aggregate
→ Regression History dashboard
```

E, em um cenário de incerteza:

```text
mutation pode ter sido enviada
→ UNKNOWN_SIDE_EFFECT
→ nenhum retry cego
→ dashboard sinaliza revisão
```

Esse comportamento é tão importante quanto o caminho PASSED.

---

# 46. Prompt de retomada para um novo chat

Se for necessário iniciar outro chat, usar este contexto:

> Estamos no projeto QAgent. A Foundation 07.7.10-B Read-only Suite Orchestration está production validated: Auto Suite v2 executou 4 endpoints / 21 cenários via `srun_*`, fan-out server-side, Runner, Assertions e Results, terminando 4/4 PASSED. Mutations de negócio POST/PUT/PATCH/DELETE ainda são bloqueadas no Runner por design. O próximo trabalho é seguir exatamente o documento `QAGENT-ROADMAP-07.7.10-B-FIX-2-FIX-3-07.7.10-C.md`: primeiro 07.7.10-B FIX-2 Mutation Safety Contract (Gateway Durable Mutation Journal + immutable Environment Mutation Policy + retry semantics + preflight antes de Test Data/Auth + Suite Run Eligibility v2), mantendo HTTP mutation ainda bloqueado; depois FIX-3 Controlled POST/PUT/PATCH/DELETE com Mutation Isolation v1 e validação real em STG; só depois 07.7.10-C Suite Results & Regression History. Preservar multi-tenant, fail-closed, secret-safe, migrations imutáveis e sem N+1.

---

# 47. Próxima ação imediata

Começar por:

```text
07.7.10-B FIX-2 / A
Mutation Safety Contracts

07.7.10-B FIX-2 / B
Gateway migration 0016

07.7.10-B FIX-2 / C
Environment Mutation Policy

07.7.10-B FIX-2 / D
Durable Mutation Journal
```

Somente depois conectar o Runner preflight.


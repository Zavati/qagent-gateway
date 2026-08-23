# Apply — Foundation 07.7.7 Assertion Engine v1

## Ordem obrigatória

Deploy do Gateway primeiro porque o Runner 07.7.7 chama a nova rota interna `assertions-evaluated` e depende das novas colunas D1.

## 1. Gateway

```bash
npm ci
npm run check:07.7.7
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Migration esperada:

```text
0011_foundation_07_7_7_assertion_engine.sql
```

Ela adiciona apenas summaries bounded da avaliação; não adiciona request/response bodies.

## 2. Runner

```bash
npm ci
npm run check:07.7.7
npm run deploy
```

Variáveis para o gate atual:

```text
RUNNER_HTTP_EXECUTION_ENABLED=true
RUNNER_ASSERTION_ENGINE_ENABLED=true
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

## 3. Health

Esperado no `qagent-runner`:

```json
{
  "foundation": "07.7.7",
  "hardening": "07.7.6-FIX-2",
  "httpExecutionEnabled": true,
  "assertionEngineEnabled": true,
  "assertionEngineVersion": "qagent.assertion-engine.v1",
  "assertionBatchVersion": "qagent.assertion-execution-batch.v1",
  "authRuntimeEnabled": false
}
```

## 4. Tail

```bash
npx wrangler tail qagent-runner --format pretty
```

Eventos esperados em um Run real:

```text
run_http_scenario_result
run_http_execution_summary
run_assertion_scenario_result
run_assertion_execution_summary
run_queue_claim_received
```

## 5. Smoke Buggy Cars

Usar um novo Run e nova `Idempotency-Key`.

Versão validada durante a 07.7.6:

```text
tdv_b29a7f1c-a76a-4ebe-8c2b-73aa6ec7b606
env_78ede4ad-3837-440a-b394-55305121905e
DISCOVERED_OBSERVATION
Auth NONE
GET /prod/models
```

Para o gate mínimo, executar `test_001`:

```json
{
  "contractVersion": "qagent.run-create.v1",
  "testDesignVersionId": "tdv_b29a7f1c-a76a-4ebe-8c2b-73aa6ec7b606",
  "environmentId": "env_78ede4ad-3837-440a-b394-55305121905e",
  "scenarioIds": ["test_001"],
  "confirmDiscoveredRuntime": true
}
```

Expected assertions desse cenário:

```text
STATUS 200
SCHEMA cst_2662eb00635900b24502b3ee88c41b282e45f163
CONTENT_TYPE application/json
```

Gate desejado:

```text
run.status = PASSED
executionAttempt.assertionExecutionStatus = COMPLETED
executionAttempt.assertionOutcome = PASSED
assertionPassedCount = 3
assertionFailedCount = 0
assertionNotEvaluatedCount = 0
assertionDiagnostic = null
```

Depois, `test_002` pode validar `JSON_PATH_EXISTS $.totalPages`.

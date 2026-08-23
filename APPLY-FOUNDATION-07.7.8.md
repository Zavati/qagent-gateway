# Apply — Foundation 07.7.8 Auth Runtime

## Ordem obrigatória

O Gateway precisa ser aplicado primeiro porque:

```text
1. adiciona migration 0012;
2. publica as rotas internas auth-material/auth-resolved;
3. mantém a posse do Secret Vault;
4. só depois o Runner 07.7.8 pode solicitar Auth Material JIT.
```

## 1. Gateway

```bash
npm ci
npm run check:07.7.8
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Migration esperada:

```text
0012_foundation_07_7_8_auth_runtime.sql
```

Nenhuma master key do Secret Vault deve ser adicionada ao Runner.

## 2. Runner

```bash
npm ci
npm run check:07.7.8
npm run deploy
```

Variáveis esperadas:

```text
RUNNER_HTTP_EXECUTION_ENABLED=true
RUNNER_ASSERTION_ENGINE_ENABLED=true
RUNNER_AUTH_RUNTIME_ENABLED=true

RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

O Runner continua precisando apenas do secret de autenticação **Runner Control HMAC** já existente. Ele não recebe `QAGENT_SECRETS_KEY_*`.

## 3. Health

Esperado no `qagent-runner`:

```json
{
  "foundation": "07.7.8",
  "hardening": "07.7.6-FIX-2",
  "httpExecutionEnabled": true,
  "assertionEngineEnabled": true,
  "authRuntimeEnabled": true,
  "authRuntimeVersion": "qagent.auth-runtime-batch.v1",
  "authMaterialContractVersion": "qagent.runner-auth-material.v1",
  "authSupportedTypes": [
    "basic",
    "api_key",
    "oauth2_client_credentials",
    "login_http_json"
  ]
}
```

## 4. Tail

```bash
npx wrangler tail qagent-runner --format pretty
```

Para um cenário REQUIRED com API key estática, esperar a ordem:

```text
run_auth_runtime_summary
run_http_scenario_result
run_http_execution_summary
run_assertion_scenario_result
run_assertion_execution_summary
run_queue_claim_received
```

O `run_auth_runtime_summary` esperado contém apenas dados seguros:

```text
requiredScenarioCount >= 1
resolvedProfileCount >= 1
dynamicExchangeCount = 0
cacheHitCount >= 0
profiles[].authProfileRef/type
```

Nunca deve existir token/API key/password nos logs.

## 5. Primeiro smoke autenticado recomendado

Usar um endpoint STG já persistido como `READY` com:

```text
auth.requirement = REQUIRED
authProfileRef = <Auth Profile configurado>
credentialsConfigured = true
```

No projeto SEST SENAT já existe um perfil Bearer/API-key configurado para Homologação. Antes do smoke, garantir que o Secret binding contém uma credencial de teste **atual**. Não reutilizar token antigo observado ou colado em logs/conversas.

Criar um **novo Run** e uma nova `Idempotency-Key` usando o `tdv_*` READY autenticado atual e o Environment STG.

Para runtime explicitamente configurado não é necessário `confirmDiscoveredRuntime=true`.

## 6. Gate esperado — static API key/Bearer

Tail:

```text
run_auth_runtime_summary
requiredScenarioCount = 1
resolvedProfileCount = 1
dynamicExchangeCount = 0

run_http_scenario_result
outcome = RESPONSE
statusCode = 200   # se a credencial e o endpoint estiverem OK

run_assertion_scenario_result
outcome = PASSED  # se as assertions estiverem conformes
```

GET do Run:

```text
run.status = PASSED

authRuntimeStatus = COMPLETED
authRequiredScenarioCount = 1
authResolvedProfileCount = 1
authDynamicExchangeCount = 0

httpExecutionStatus = COMPLETED
httpResponseCount = 1

assertionExecutionStatus = COMPLETED
assertionOutcome = PASSED
```

## 7. Resultado 401/403

Se o Auth Runtime resolver/injetar a credencial corretamente, mas a API responder 401/403:

```text
authRuntimeStatus = COMPLETED
httpExecutionStatus = COMPLETED
httpResponseCount = 1
response4xxCount >= 1
assertionOutcome = FAILED (quando expected status é 2xx)
run.status = FAILED
```

Isso não é erro interno do Runner. É um resultado real do teste/autorização.

## 8. Gate posterior — auth dinâmica

Depois do static API-key smoke, validar em um endpoint controlado:

```text
oauth2_client_credentials
ou
login_http_json
```

Esperado:

```text
authDynamicExchangeCount = 1
resolvedProfileCount = 1
```

O token obtido não deve aparecer em logs, Gateway D1 ou GET público do Run.

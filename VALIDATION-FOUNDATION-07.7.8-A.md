# Validation — Foundation 07.7.8-A

## Local

### Gateway

```text
normalize login form/runtime_origin              PASS
form static fields secret-safe/scalar            PASS
discovered runtime + dynamic auth target freeze  PASS
Runner Control returns frozen target             PASS
07.7.8-B FIX-1 regression chain                  PASS
full npm run test:all                            PASS
```

### Runner

```text
form-urlencoded login                            PASS
URL encoding username/password                   PASS
grant_type=password                              PASS
JSON token extraction                            PASS
Bearer injection into test request               PASS
1 exchange/profile/attempt                       PASS
safe auth log                                    PASS
invalid nested form config fail-closed            PASS
07.7.3 → 07.7.8 regression chain                 PASS
```

### Console

```text
runtime_origin option                            PASS
Form URL Encoded option                          PASS
OAuth Password preset                            PASS
static fields control                            PASS
source-level test                                PASS
```

O build completo do Console não foi executado no snapshot de referência porque o archive disponível não continha `node_modules` e `next` não estava instalado. O gate de deploy exige `npm ci && npm run build` no repo real.

## Production gate

Configurar um Login dinâmico em STG e regenerar um GET protegido com esse profile como único candidato compatível.

Esperado:

```text
authRuntimeStatus = COMPLETED
authRequiredScenarioCount >= 1
authResolvedProfileCount = 1
authDynamicExchangeCount = 1
authCacheHitCount = requiredScenarioCount - 1

httpExecutionStatus = COMPLETED
httpResponseCount = httpRequestCount
response2xxCount = httpRequestCount

assertionExecutionStatus = COMPLETED
assertionOutcome = PASSED
```

Se o login responder 4xx, o Run deve falhar na fase AUTH antes dos test requests.
Se login responder network/timeout/5xx, o attempt pode ser retryable antes de qualquer test request.

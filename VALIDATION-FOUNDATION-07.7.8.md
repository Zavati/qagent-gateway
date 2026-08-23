# Validation — Foundation 07.7.8 Auth Runtime

## Status

```text
LOCAL VALIDATED
PRODUCTION GATE PENDING
```

A 07.7.7 já está production validated. A 07.7.8 precisa de um novo Run autenticado após deploy.

## Runner

Executado:

```bash
npm run check:07.7.8
```

Regressão confirmada:

```text
07.7.3 Queue                               PASS
07.7.4 Claim / Lease / Retry               PASS
07.7.5 Runtime Integration                 PASS
07.7.6 HTTP Executor                       PASS
07.7.6 FIX-1 Network Diagnostics           PASS
07.7.6 FIX-2 Fetch Invocation              PASS
07.7.7 Assertion Engine                    PASS
07.7.8 Auth Runtime                        PASS
```

Casos específicos 07.7.8:

```text
feature gate fail-closed                    PASS
api_key header injection                    PASS
custom auth header hidden from metadata     PASS
api_key query injection                     PASS
query auth key/value not in metadata        PASS
basic auth injection                        PASS
per-profile in-memory cache                 PASS
auth resolved once for repeated scenarios  PASS
oauth2 client_credentials exchange          PASS
OAuth token JIT injection                   PASS
login_http_json header-token extraction     PASS
dynamic auth redirect forbidden             PASS
dynamic auth 5xx transient                  PASS
control-plane missing Secret permanent AUTH PASS
secret/token absent from safe logs          PASS
secret/token absent from HTTP result        PASS
consumer runtime->auth->http ordering        PASS
REQUIRED + auth disabled -> no HTTP         PASS
```

## Gateway

Executado:

```bash
npm run check:07.7.8
npm run test:all
```

Validado:

```text
strict auth-material request contract       PASS
strict auth-resolved summary contract       PASS
AUTH rejection phase                        PASS
HMAC handler boundary                       PASS
active lease + runtimePlanHash gate         PASS
lease token hash verification               PASS
Auth Profile must be in snapshot            PASS
Auth Profile must be referenced by plan     PASS
profile type drift fail-closed              PASS
missing decrypted credentials fail-closed   PASS
frozen config wins over mutable config      PASS
dynamic auth target uses frozen snapshot    PASS
bounded auth summary persistence            PASS
public Run safe auth envelope               PASS
internal routes                             PASS
07.7.x regression                           PASS
full test:all                               PASS
```

## Migration audit

Todas as migrations Gateway `0001 -> 0012` foram aplicadas em SQLite limpo.

```text
integrity_check = ok
foreign_key_check = 0 rows
```

Colunas 07.7.8 confirmadas:

```text
auth_runtime_status
auth_required_scenario_count
auth_resolved_profile_count
auth_dynamic_exchange_count
auth_cache_hit_count
auth_duration_ms
auth_resolved_at
```

Nenhum campo de credencial/token foi adicionado.

## Security assertions

```text
Secret Vault master key remains Gateway-only             PASS
Queue has no secret                                       PASS
Execution Plan / Runtime Snapshot have no plaintext       PASS
Runner Auth Material is JIT + attempt/lease bound         PASS
Auth values exist only in transient memory                PASS
Auth header/query values absent from logs/control summary PASS
Dynamic auth target is frozen before execution            PASS
DSL collision with Auth Runtime fails closed               PASS
```

## Production gate

Primeiro gate recomendado: Auth Profile `api_key`/Bearer em STG.

Esperado:

```text
run_auth_runtime_summary
  requiredScenarioCount >= 1
  resolvedProfileCount >= 1
  dynamicExchangeCount = 0

HTTP RESPONSE
Assertion Engine evaluates
Run PASSED or a legitimate FAILED from the tested API
```

GET público:

```text
authRuntimeStatus = COMPLETED
authRequiredScenarioCount >= 1
authResolvedProfileCount >= 1
no token/credential fields
```

Um 401/403 depois da injection é um resultado funcional válido e deve chegar como HTTP 4xx + assertion FAILED, não como `NETWORK_ERROR`.

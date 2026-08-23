# Validation — Foundation 07.7.7 Assertion Engine v1

## Runner

Executado:

```bash
npm run check:07.7.7
```

Cobertura confirmada:

```text
07.7.3 Queue regression                         PASS
07.7.4 Claim / Lease / Retry                   PASS
07.7.5 Runtime Integration                     PASS
07.7.6 HTTP Executor                           PASS
07.7.6 FIX-1 Network Diagnostics               PASS
07.7.6 FIX-2 Fetch Invocation                  PASS
07.7.7 Assertion Engine                        PASS
```

Casos específicos 07.7.7:

```text
JSON Path property/index/wildcard               PASS
JSON Path unsupported -> NOT_EVALUATED          PASS
Structural schema valid                         PASS
Structural schema type mismatch                 PASS
STATUS                                           PASS
CONTENT_TYPE                                     PASS
HEADER_EXISTS                                    PASS
JSON_PATH_EXISTS                                 PASS
JSON_PATH_EQUALS                                 PASS
SCHEMA                                            PASS
HTTP 500 -> STATUS FAILED                       PASS
NETWORK_ERROR -> assertions NOT_EVALUATED       PASS
truncated body -> body assertions NOT_EVALUATED PASS
status/content type ainda avaliáveis truncado   PASS
raw expected/actual value não vaza em logs      PASS
consumer HTTP -> assertions -> received         PASS
```

## Gateway

Executado:

```bash
npm run check:07.7.7
npm run test:all
```

Validado:

```text
qagent.runner-assertions-evaluated.v1 contract  PASS
count consistency                               PASS
PASSED/FAILED/ERROR consistency                 PASS
raw value fields rejected                       PASS
internal route                                  PASS
active lease/runtime/http gate                  PASS
bounded persistence                             PASS
Run PASSED / FAILED / ERROR transition          PASS
terminal status committed with final RECEIVED   PASS
no pre-receive terminal crash window            PASS
public Run envelope                             PASS
07.7.x regressions                              PASS
full test:all                                   PASS
```

## Migration

Todas as migrations Gateway 0001 -> 0011 foram aplicadas em SQLite limpo durante auditoria local.

```text
integrity_check = ok
foreign_key_check = 0 rows
```

## Gate de produção

Pendente até um novo Run real do Buggy Cars executar 07.7.7 após deploy.

Gate principal:

```text
HTTP RESPONSE 200
assertionOutcome PASSED
run.status PASSED
```

Um HTTP 500 esperado como 200 deve resultar em:

```text
httpExecutionStatus COMPLETED
httpResponseCount 1
assertionOutcome FAILED
run.status FAILED
assertionDiagnostic.errorCode ASSERTION_STATUS_MISMATCH
```

Uma falha de transporte deve resultar em:

```text
assertionOutcome ERROR
run.status ERROR
ASSERTION_HTTP_RESPONSE_UNAVAILABLE
```

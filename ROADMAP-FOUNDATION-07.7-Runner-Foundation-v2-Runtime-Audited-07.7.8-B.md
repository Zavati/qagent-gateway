# QAgent Foundation 07.7 — Runner Foundation — estado até 07.7.8

## Concluído / validado

```text
07.7.1 Runtime Audit                                      DONE
07.7.2 Run Contract + Immutable Execution Plan           DONE
07.7.2-A Runtime / Test Design Bridge                    DONE
07.7.3 Queue + qagent-runner                             DONE
07.7.4 Claim / Lease / Retry                             PROD VALIDATED
07.7.5 Runtime Integration + Readiness                   PROD VALIDATED
07.7.6 HTTP Executor v1                                  PROD VALIDATED
07.7.6-A Zero-Config Runtime Bootstrap                   PROD VALIDATED
07.7.6 FIX-1 HTTP Network Diagnostics                    PROD VALIDATED
07.7.6 FIX-2 Workers Fetch Invocation Hardening          PROD VALIDATED
07.7.7 Assertion Engine v1                               PROD VALIDATED
07.7.8 Auth Runtime                                      LOCAL PASS / PROD GATE PENDING
```

## Produto funcional até 07.7.7

Buggy Cars provou em produção:

```text
Plugin / Observation
-> Catalog
-> Evidence + Schema
-> AI Test Design
-> READY
-> Zero-Config DISCOVERED_OBSERVATION
-> Run / Queue / Lease
-> HTTP real
-> 2 responses 200
-> Assertion Engine
-> 4/4 assertions PASSED
-> run.status = PASSED
```

## 07.7.8 — Auth Runtime

Objetivo:

```text
REQUIRED scenario
+ frozen Auth Profile metadata
+ JIT Secret Vault resolution
-> ephemeral injection/token
-> HTTP Executor
-> Assertion Engine
```

Suporta:

```text
basic
api_key header/query
oauth2_client_credentials
login_http_json
```

Fronteiras:

```text
Gateway owns Secret Vault keys
Runner does not receive Vault master key
Queue/snapshot/plan remain secret-free
Auth Material is lease/attempt/runtimePlanHash bound
Secret/token never persisted/logged
```

Control Plane recebe apenas:

```text
auth runtime status
required scenario count
resolved profile count
dynamic exchange count
cache hits
duration/resolved timestamp
```

## Production gate 07.7.8

Primeiro smoke:

```text
STG
READY scenario
auth.requirement = REQUIRED
api_key/Bearer Auth Profile
fresh test credential bound to Environment
```

Esperado:

```text
authRuntimeStatus = COMPLETED
resolvedProfileCount >= 1
HTTP RESPONSE
assertions evaluated
run PASSED or legitimate FAILED from tested API
```

Depois validar separadamente dynamic auth (`oauth2_client_credentials` / `login_http_json`).

## Próximo

### 07.7.9 — Results + Console

Criar o Execution Results Plane dedicado:

```text
qagent-test-results
own D1
scenario results
assertion results
safe timings / request-response metadata
execution evidence
R2 references for larger artifacts
```

Gateway continua Run Control Plane e guarda apenas summaries/references.

Console passa a mostrar:

```text
Run history
PASSED / FAILED / ERROR
scenario breakdown
assertion failures
HTTP/network diagnostics
Auth Runtime safe diagnostics
timings
```

### 07.7.10 — Production Hardening

Depois do Results Plane/Console:

```text
rate/concurrency policy
execution quotas
cancellation hardening
DLQ/operator tooling
retention
production execution confirmation policy
side-effect execution journal/idempotency strategy
operational metrics/alerts
```

---

## 07.7.8-B — Zero-Config Auth Resolution + Visibility

Status: **LOCAL VALIDATED / PRODUCTION GATE PENDING**.

Entregas:

- Catalog Context Builder v1.4;
- auto-match Bearer/profile sem API Service explícito;
- Environment isolation para runtime descoberto;
- fail-closed para múltiplos profiles;
- diagnostics de resolução sem material sensível;
- Console mostra profile selecionado e origem da decisão;
- sem migration;
- Runner 07.7.8 permanece compatível.

Gate: endpoint GET protegido observado com Bearer, `0 APIs`, `1 Auth` configurado em STG deve gerar Test Spec com `authProfileRef` e `AUTO_MATCHED`.

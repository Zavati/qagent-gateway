# QAgent — Foundation 07.7
## Runner Foundation — Execution Plane
### v2 — Runtime Foundation Audited

**Status:** Em andamento  
**Prioridade:** Alta — valor direto de produto  
**Foundation anterior concluída:** 07.6.5 — Test Registry Foundation + Persistence & Retrieval  
**07.6.6:** importante, porém DEFERRED  
**07.7.1 Runtime Audit:** CONCLUÍDA

---

# 1. Visão do produto

```text
QAgent
descobre
→ projeta
→ persiste
→ executa
→ mede
```

Objetivo da 07.7:

> transformar uma versão imutável de `qagent.test-spec.v1` em uma execução HTTP real, segura, reproduzível e rastreável contra um Environment configurado.

---

# 2. Descoberta principal da 07.7.1

O Runtime Plane necessário para o Runner **já existe** no Gateway.

Não criar uma segunda implementação.

Fonte de verdade atual:

```text
qagent-gateway
+
QAGENT_DB
```

Modelos persistidos:

```text
environments
api_services
environment_api_bindings
environment_variables
secrets
auth_profiles
auth_profile_environment_bindings
```

Resolvers existentes:

```text
resolveEnvironmentRuntimeConfig(...)
resolveAuthProfileRuntimePlan(...)
```

---

# 3. Arquitetura alvo atualizada

```text
Console
   ↓
Gateway / Run Control Plane
   ↓
Pinned Test Design Version
   ↓
Existing Runtime Plane
   ├── Environment
   ├── API Service
   ├── Variables
   ├── Auth Profiles
   └── Secret Vault
   ↓
Execution Materializer
   ↓
Immutable Execution Plan
   ↓
Run Queue
   ↓
qagent-runner
   ↓
Safe HTTP Executor
   ↓
Assertion Engine
   ↓
Results
   ↓
Console
```

---

# 4. Runtime identity

Browser seleciona:

```text
testDesignVersionId
environmentId
scenarioIds
```

Gateway resolve:

```text
organizationId
projectId
Environment
API Service Base URL
Variables
Auth binding
Schema snapshots
```

Browser nunca fornece base URL ou hostname do Run.

---

# 5. Test Definition target

Contrato permanece:

```json
{
  "apiServiceKey": "core-api",
  "method": "GET",
  "path": "/core-api/execution"
}
```

Environment resolve:

```text
core-api -> https://api-stg.example.com
```

Execução:

```text
configuredBaseUrl + controlled relative path
```

---

# 6. Runtime Snapshot

Novo contrato a criar:

```text
qagent.runtime-snapshot.v1
```

Deve congelar na criação do Run:

```text
environment identity
API Service target(s)
API binding identities
non-secret variables
Auth profile/binding references
Auth public config
schema snapshots
```

Não contém plaintext Secret.

---

# 7. Auth Runtime

Já existe infraestrutura para:

```text
none
basic
api_key
oauth2_client_credentials
login_http_json
```

Já existe:

```text
AES-256-GCM Secret Vault
Auth Profile per Environment binding
internal secret resolution
internal Auth Runtime Plan
```

Falta:

```text
apply Basic
apply API Key
OAuth token acquisition
HTTP login token acquisition
redaction
runtime token lifecycle
```

---

# 8. Runtime Mapping

O Test Design já utiliza o Control Plane existente para descobrir:

```text
apiServiceKey
authProfileRef
```

Estados atuais:

```text
MATCHED
UNMATCHED
PARTIAL
AMBIGUOUS
```

Regra do MVP:

```text
somente MATCHED pode produzir READY por Environment
```

Limitação registrada:

```text
origin-only matching pode ficar AMBIGUOUS quando múltiplos API Services compartilham o mesmo host
```

Planejar explicit mapping futuro.

---

# 9. First Runtime Gate

Antes do primeiro Run:

```text
Environment STG
↓
core-api Base URL configurada
↓
Runtime Config mostra apiServices.core-api
↓
Regenerate Test Design
↓
spec.target.apiServiceKey = core-api
↓
READY >= 1
```

Não contornar `NEEDS_ENVIRONMENT`.

---

# 10. Run lifecycle

Estados recomendados:

```text
CREATED
QUEUED
RUNNING
PASSED
FAILED
ERROR
CANCELLED
```

Run fixa:

```text
testDesignVersionId
environmentId
executionPlanId
```

Nunca executa `latest`.

---

# 11. Eligibility

```text
READY             -> executable
NEEDS_ENVIRONMENT -> reject
NEEDS_AUTH        -> reject
NEEDS_DATA        -> reject
REVIEW_REQUIRED   -> reject
unknown           -> reject
```

Fail closed.

---

# 12. Queue contract

Mensagem mínima:

```json
{
  "contractVersion": "qagent.run-requested.v1",
  "runId": "run_..."
}
```

Sem:

```text
secret
token
password
baseUrl arbitrária
full specification
response body
```

---

# 13. Schema snapshot

Antes de enfileirar:

```text
SCHEMA schemaRef
↓
Catalog exact ref resolution
↓
immutable structural schema
↓
Execution Plan
```

Nunca usar `latest` durante o Run.

---

# 14. SSRF / egress

Blocking gate para HTTP real.

A configuração atual já rejeita:

```text
non-http(s)
credentials in URL
query/hash in Base URL
```

Mas o Runner ainda precisa:

```text
destination policy
metadata endpoint blocking
redirect revalidation
port policy
request/response limits
arbitrary-host prevention
```

---

# 15. Subfases atualizadas

## 07.7.1 — Runner Architecture + Runtime Foundation Audit ✅

Concluído:

- runtime persistence audit;
- Environment audit;
- API Service audit;
- Auth/Secret audit;
- Runtime Resolver audit;
- Test Design bridge audit;
- risks;
- trust boundaries;
- no duplicate runtime plane.

---

## 07.7.2 — Run Contract + Execution Plan Foundation ✅

Implementar no Gateway:

```text
qagent.run-create.v1
qagent.run.v1
qagent.runtime-snapshot.v1
qagent.execution-plan.v1
```

Entregas:

- Run D1 schema;
- idempotency;
- pinned tdv;
- Environment validation;
- selected scenario validation;
- READY-only;
- runtime materialization using existing Runtime Plane;
- schema materialization;
- immutable execution plan;
- safe GET Run;
- no HTTP yet.

Gate:

```text
POST Run
→ CREATED
→ immutable plan exists
→ no HTTP performed
```

---

## 07.7.3 — Queue + qagent-runner Foundation — IMPLEMENTADA LOCALMENTE

Criar:

```text
qagent-runner
qagent-run-requests
Gateway Runner Control API
run_queue_dispatches
```

A DLQ/retry policy formal fica deferida para 07.7.4, junto com claim/lease/recovery.

Mensagem mínima por referências imutáveis:

```json
{
  "contractVersion": "qagent.run-requested.v1",
  "runId": "run_...",
  "executionPlanId": "xplan_...",
  "runtimeSnapshotId": "rts_..."
}
```

A Queue não carrega plan, runtime JSON ou secrets.

Gate:

```text
CREATED
-> PENDING dispatch
-> queue publish
-> QUEUED
-> qagent-runner fetches authoritative bundle
-> validates planHash + snapshotHash + READY-only
-> RECEIVED
-> ACK
```

Sem HTTP para a API alvo.

---

## 07.7.4 — Claim / Lease / Retry

- atomic claim;
- attempt;
- lease;
- heartbeat;
- duplicate safe;
- retry;
- cancellation check;
- abandoned recovery.

Gate:

```text
duplicate queue delivery never causes duplicate execution
```

---

## 07.7.5 — Runtime Integration + Readiness Resolution

Não cria novo Runtime Plane.

Cria camada interna:

```text
Execution Runtime Materializer
```

Reutiliza:

```text
resolveEnvironmentRuntimeConfig
resolveAuthProfileRuntimePlan
```

Valida:

```text
apiServiceKey exists in selected Environment
auth Profile usable
variables allowed
runtime snapshot consistent
```

Gate:

```text
READY scenario resolves deterministic STG target
```

---

## 07.7.6 — HTTP Executor v1

- safe URL builder;
- GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS;
- path params;
- query;
- headers;
- body;
- timeout;
- response limits;
- redirects policy;
- SSRF/egress guard;
- sanitized capture.

Gate:

```text
one real controlled HTTP request
```

---

## 07.7.7 — Assertion Engine v1

Implementar 100% do DSL atual:

```text
STATUS
SCHEMA
JSON_PATH_EXISTS
JSON_PATH_EQUALS
HEADER_EXISTS
CONTENT_TYPE
```

Gate:

```text
HTTP response -> deterministic PASSED/FAILED
```

---

## 07.7.8 — Auth Runtime

Aplicar:

```text
NONE
Basic
API Key
OAuth2 Client Credentials
login_http_json
```

Secrets JIT.

Nenhum runtime token persistido.

---

## 07.7.9 — Results + Console

- Run results;
- scenario status;
- assertion results;
- Run UX;
- Environment selector;
- Execute CTA;
- polling initially;
- exact Version shown.

---

## 07.7.10 — Production Hardening

- concurrency;
- rate limits;
- retries/DLQ;
- cancellation;
- max durations;
- egress abuse protection;
- log redaction;
- tenant isolation;
- recovery drills.

---

# 16. Primeiro vertical slice

```text
Catalog endpoint real
↓
Test Design Version 2+
↓
core-api mapped
↓
1 READY scenario
↓
Environment STG
↓
Create Run
↓
Queue
↓
Runner
↓
GET real
↓
STATUS 200
↓
JSON_PATH / SCHEMA
↓
PASSED / FAILED
↓
Console
```

---

# 17. Definition of Done 07.7

- [ ] no duplicate Runtime Plane;
- [ ] Run uses pinned tdv;
- [ ] explicit Environment;
- [ ] only READY;
- [ ] runtime snapshot immutable;
- [ ] schema snapshot immutable;
- [ ] Queue contains no secret;
- [ ] retries idempotent;
- [ ] lease safe;
- [ ] target from configured API Binding only;
- [ ] SSRF policy;
- [ ] auth JIT;
- [ ] no runtime token persisted;
- [ ] HTTP DSL v1;
- [ ] assertion DSL v1;
- [ ] sanitized results;
- [ ] Console Run UX;
- [ ] same Test Design can run against multiple Environments;
- [ ] production Run validated.

---

# 18. Próximo passo

Validar em produção:

```text
07.7.3 — Queue + qagent-runner Foundation
```

Depois do gate `QUEUED -> RECEIVED`, iniciar:

```text
07.7.4 — Claim / Lease / Retry
```

Mas antes do deploy dessa subfase, validar no projeto real:

```text
Homologação
→ core-api Base URL real
→ Runtime Config shows core-api
→ regenerate endpoint
→ at least one READY scenario
```

Esse teste comprova que o bridge:

```text
Observation
→ Catalog
→ Runtime Config
→ Test Design
```

está operacional antes de adicionar o Execution Plane.

---

# Architectural Requirement — Zero-Config Runtime Bootstrap

The Runner/Runtime architecture must be **zero-config first**.

Resolution precedence:

```text
1. explicit user configuration (always wins)
2. runtime inferred safely from Observation/Catalog
3. NEEDS_ENVIRONMENT only when neither can resolve a target
```

Discovered runtime must carry provenance/confidence and, until policy permits otherwise, require user confirmation before execution. Auth type/requirement may be detected from traffic, but observed tokens, cookies, API keys, passwords and other credentials must never be persisted or reused.

`qagent.runtime-snapshot.v1` freezes this provenance as:

```text
source = EXPLICIT_CONFIG | DISCOVERED_OBSERVATION
confidence = CONFIRMED | HIGH | MEDIUM | LOW
requiresExecutionConfirmation = boolean
```

Foundation 07.7.2 materializes `EXPLICIT_CONFIG`. The discovered fallback is a mandatory Runtime Integration gate before broad Runner execution.

---

# Addendum — 07.7.2-A Execution Readiness Bridge Hardening

Production validation after 07.7.2 revealed that `READY` existed but logical API Service resolution was overly coupled to Catalog Environment IDs.

## Architectural correction

```text
Test Design time:
Observed endpoint origin
→ unique logical API Service
→ apiServiceKey

Run creation time:
apiServiceKey + selected environmentId
→ exact Environment API Binding
→ baseUrl
```

The Test Design remains Environment-independent as originally intended.

`environmentCoverageStatus` is diagnostic and must not erase a unique service identity.

Ambiguous service identities remain blocked.

## Auth

Auth Profile availability at Test Design time is environment-independent and means usable in at least one configured Environment of the resolved service. Exact selected-Environment validation remains a Run responsibility.

Sanitized auth-observation provenance (`authObserved`, `authScheme`) is still a pre-HTTP hardening item; observed credential values remain forbidden.

## Gates

```text
real simple GET
+ unique service origin
+ usable Auth Profile
+ grounded 2xx/schema
+ no data/review blocker
→ READY
```

Then:

```text
READY persisted tdv_*
→ POST Run
→ CREATED
→ no HTTP yet
```

## Next

After 07.7.2-A production validation:

```text
07.7.2-B — Zero-Config Runtime Bootstrap v1
```

Implement safe discovered-runtime fallback without merging Catalog discovered Services with configured Control Plane API Services.

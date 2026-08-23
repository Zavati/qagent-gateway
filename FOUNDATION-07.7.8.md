# QAgent Foundation 07.7.8 — Auth Runtime

## Objetivo

Permitir que o Runner execute cenários `auth.requirement=REQUIRED` sem mover a posse de secrets para o Execution Plane.

A regra central é:

```text
Test Design / Queue / Execution Plan / Runtime Snapshot
-> apenas referência + configuração não sensível

Secret Vault no Gateway
-> decrypt JIT sob tenant + environment + lease ativa

Runner
-> recebe Auth Material efêmero
-> cria header/query/token somente em memória
-> executa request
-> descarta material ao encerrar o attempt
```

O `qagent-runner` **não recebe a master key do Secret Vault**.

## Trust boundary

O Auth Runtime usa uma nova fronteira interna dentro do Run Control Plane:

```text
Runner
  |
  | HMAC + active lease + attemptId + runtimePlanHash
  v
Gateway Runner Control
  |
  | resolve Secret Vault JIT
  v
Auth Material efêmero
  |
  v
Runner memory only
```

A resolução só ocorre quando:

```text
Run/attempt ainda está ativo
attempt está CLAIMED
lease está ACTIVE e não expirada
leaseToken corresponde ao hash persistido
Runtime está READY
runtimePlanHash é o mesmo do attempt
Auth Profile existe no Runtime Snapshot imutável
Auth Profile é realmente referenciado por um cenário REQUIRED do Execution Plan
profile type atual não divergiu do snapshot
credencial do Environment está disponível no Secret Vault
```

## Contratos novos

```text
qagent.runner-auth-material-request.v1
qagent.runner-auth-material.v1
qagent.auth-runtime-batch.v1
qagent.runner-auth-resolved.v1
```

Rotas internas:

```text
POST /internal/v1/runner/runs/:runId/auth-material
POST /internal/v1/runner/runs/:runId/auth-resolved
```

Ambas usam o mesmo HMAC de Runner Control. `auth-material` exige lease ativa e devolve plaintext apenas como resposta interna efêmera para o Runner.

## Reprodutibilidade

A configuração não sensível continua congelada no Runtime Snapshot:

```text
type
placement
header/query name
prefix
OAuth token path
login token source
Auth endpoint apiServiceKey/path
```

O secret **não** é congelado. A credencial ligada ao Auth Profile + Environment é resolvida JIT no instante da execução.

Isso permite rotação de secret sem reescrever Test Design/Execution Plan, enquanto mantém o comportamento não sensível do Run reproduzível.

Para Auth Profiles dinâmicos (`oauth2_client_credentials` e `login_http_json`), o API Service usado no login/token exchange também é incluído no Runtime Snapshot na criação do Run. O Runner não resolve Base URL mutável no momento da execução.

## Auth types suportados

### `api_key`

Suporta:

```text
placement = header
placement = query
```

Exemplo conceitual:

```text
config:
  placement: header
  name: Authorization
  prefix: "Bearer "

Secret Vault:
  apiKey: <token>
```

ou, para compatibilidade com perfis existentes:

```text
prefix: ""
apiKey: "Bearer <token>"
```

O valor nunca entra em log/Control Plane.

### `basic`

O Runner monta em memória:

```text
Authorization: Basic base64(username:password)
```

Username/password não são persistidos ou logados.

### `oauth2_client_credentials`

O Runner realiza um POST JIT no Auth endpoint congelado.

Suporta:

```text
clientAuthentication = body | basic
scope
audience
tokenJsonPath
tokenTypeJsonPath
targetHeader
```

O access token existe apenas em memória e é usado para montar o request do cenário.

### `login_http_json`

O Runner envia username/password em JSON para o Auth endpoint congelado e extrai token de:

```text
JSON body
ou
response header
```

Suporta `staticBody` não sensível, campos configuráveis de usuário/senha, `tokenJsonPath`, `tokenHeader`, `scheme` e `targetHeader`.

## Ordem do Runner

Para um Run que contém cenários REQUIRED:

```text
Queue
-> Claim
-> Lease
-> Heartbeat
-> Runtime Materialization
-> Runtime READY
-> Auth Runtime enabled?
-> heartbeat por Auth Profile único
-> resolve Auth Material JIT no Gateway
-> static injection ou dynamic auth exchange
-> cache em memória por Auth Profile / attempt
-> persist safe Auth Runtime summary
-> HTTP Executor
-> Assertion Engine
-> final RECEIVED / release lease
-> ACK
```

O Auth Runtime ocorre **antes do primeiro test request**. Assim, falha transitória durante token/login exchange pode ser repetida sem já ter executado os cenários da aplicação.

## Cache por attempt

Se 10 cenários usam o mesmo Auth Profile:

```text
requiredScenarioCount = 10
resolvedProfileCount = 1
cacheHitCount = 9
```

O Secret Vault é resolvido uma vez e, para auth dinâmica, o login/token exchange é realizado uma vez naquele attempt.

Nenhum cache é persistido entre attempts/runs.

## Segurança de injection

O Test DSL não pode controlar Auth Runtime.

Se o Auth Runtime injeta:

```text
Authorization
X-API-Key
custom header
query param
```

e o Test DSL tenta usar o mesmo header/query key, o Runner rejeita a colisão fail-closed.

Request metadata expõe somente:

```text
authApplied: true|false
authPlacement: header|query
```

O nome do header de auth injetado é removido de `headerNames`. Query auth key/value não entra em `queryKeys`.

## Dynamic auth e egress

Login/OAuth usam o mesmo `HttpEgressPolicy` da 07.7.6:

```text
HTTPS por padrão
private/reserved destinations bloqueados
origin precisa corresponder ao target congelado
credentials na URL proibidas
redirect automático de Auth proibido
response limitada a 64 KB
HTTP timeout bounded
```

O POST do Auth endpoint é um credential exchange interno e pode ocorrer mesmo com:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
```

Essa flag continua bloqueando POST/PUT/PATCH/DELETE dos **test scenarios** até existir execution journal durável.

## Falhas

### Falha de configuração / Secret Vault

Exemplos:

```text
AUTH_PROFILE_SECRET_MISSING
AUTH_PROFILE_ENVIRONMENT_NOT_CONFIGURED
RUNNER_CONTROL_AUTH_PROFILE_DRIFT
RUNNER_CONTROL_AUTH_CREDENTIALS_UNAVAILABLE
```

São tratados como falha permanente daquele Run/attempt e reportados com phase `AUTH`.

### Dynamic auth network / 5xx

```text
RUNNER_AUTH_HTTP_TIMEOUT
RUNNER_AUTH_HTTP_NETWORK_DNS|CONNECT|TLS|RESET|FETCH|UNKNOWN
RUNNER_AUTH_UPSTREAM_5XX
```

São transitórios. Queue retry pode ocorrer antes de qualquer test request.

### Dynamic auth 4xx

```text
RUNNER_AUTH_UPSTREAM_REJECTED
```

É permanente para o attempt.

### API protegida responde 401/403 após static auth

Isso é uma **Response HTTP do sistema testado**, não falha interna do Auth Runtime.

Exemplo:

```text
Auth Runtime COMPLETED
HTTP RESPONSE 401
STATUS expected 200 -> FAILED
Run FAILED
```

Isso é importante para QA: token expirado, credencial inválida ou autorização incorreta tornam-se evidência real do teste.

## Control Plane

Migration:

```text
0012_foundation_07_7_8_auth_runtime.sql
```

Persistência bounded em `run_execution_attempts`:

```text
auth_runtime_status
auth_required_scenario_count
auth_resolved_profile_count
auth_dynamic_exchange_count
auth_cache_hit_count
auth_duration_ms
auth_resolved_at
```

Não persiste:

```text
credentials
username/password
API key
JWT/Bearer token
OAuth access token
login token
Authorization value
Cookie
raw auth request/response
```

Detalhes de execução continuam reservados ao futuro Execution Results Plane.

## Feature gate

```text
RUNNER_AUTH_RUNTIME_ENABLED=true
```

Se um cenário REQUIRED chega com a feature desabilitada:

```text
RUNNER_AUTH_RUNTIME_DISABLED
phase = AUTH
Run -> ERROR
```

## Gate inicial de produção

O primeiro smoke recomendado é um Auth Profile estático (`api_key`) já configurado em STG, porque valida a fronteira completa de Secret Vault/JIT/injection sem misturar um segundo HTTP de login.

Depois do gate estático, validar separadamente:

```text
basic
oauth2_client_credentials
login_http_json
```


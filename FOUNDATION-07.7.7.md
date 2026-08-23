# QAgent Foundation 07.7.7 — Assertion Engine v1

## Objetivo

Transformar a execução HTTP da Foundation 07.7.6 em execução de teste determinística.

A 07.7.6 responde:

```text
A chamada HTTP foi realizada e qual Response foi capturada?
```

A 07.7.7 responde:

```text
A Response atende às assertions imutáveis do Test Design?
```

Não há chamada de IA durante a avaliação. O Runner usa apenas:

```text
Runtime Scenario imutável
+ HttpExecutionResult
+ Schema Snapshot imutável do Execution Plan
-> AssertionEngine
```

## Escopo

O `qagent.api-test-dsl.v1` passa a executar todos os tipos de assertion atualmente contratados:

```text
STATUS
SCHEMA
JSON_PATH_EXISTS
JSON_PATH_EQUALS
HEADER_EXISTS
CONTENT_TYPE
```

### STATUS

Compara o status HTTP recebido com `expectedStatusCodes`.

Exemplo:

```text
expected: [200]
actual: 500
-> FAILED / ASSERTION_STATUS_MISMATCH
```

Um HTTP 500 continua sendo uma Response HTTP válida do ponto de vista de transporte; é o Assertion Engine que transforma a divergência funcional em FAIL.

### CONTENT_TYPE

Normaliza o MIME ignorando parâmetros como `charset` e compara com a lista esperada.

```text
application/json; charset=utf-8
-> application/json
```

### HEADER_EXISTS

Valida a presença de um header sem persistir valores sensíveis. O HTTP Response Capture fornece transitoriamente apenas nomes de headers permitidos para avaliação.

Nomes sensíveis como `set-cookie`, `authorization`, `cookie`, `x-api-key` e headers de autenticação não são expostos para persistência/log detalhado.

### JSON_PATH_EXISTS

Implementa JSON Path restrito e determinístico, incluindo:

```text
$
$.property
$.items[0]
$.items[*].id
$['property']
```

Sintaxe fora do subset suportado resulta em `NOT_EVALUATED`, não em interpretação inventada.

### JSON_PATH_EQUALS

Avalia o mesmo subset de JSON Path e exige que exista ao menos um match e que todos os matches sejam deep-equal ao valor esperado.

Valores `expected` e `actual` não entram no Control Plane nem nos logs seguros.

### SCHEMA

Valida a Response contra o Structural Schema congelado no Execution Plan.

O validador respeita a estrutura realmente produzida pelo Catalog:

```text
type
properties
items
format
x-qagent-partial
```

Não inventa semântica `required` que o schema estrutural do Catalog não contratou. Presença explícita de campo é responsabilidade de assertions como `JSON_PATH_EXISTS`.

## Resultados

### Por assertion

```text
PASSED
FAILED
NOT_EVALUATED
```

### Por cenário

```text
FAILED        se ao menos uma assertion falhar
NOT_EVALUATED se nenhuma falhar, mas ao menos uma não puder ser avaliada
PASSED        quando todas as assertions forem avaliadas e passarem
```

### Por Run / batch

```text
PASSED -> todos os cenários PASSED
FAILED -> existe assertion/cenário FAILED e nenhum cenário NOT_EVALUATED
ERROR  -> existe cenário/assertion NOT_EVALUATED
```

A precedência de `ERROR` é deliberada: problemas de transporte, truncamento ou falta de evidência necessária não devem ser apresentados como um falso defeito funcional.

## Semântica transporte x teste

```text
NETWORK_ERROR / TIMEOUT
-> sem Response
-> assertions NOT_EVALUATED
-> Run ERROR

HTTP 500 recebido
-> transporte RESPONSE
-> STATUS expected 200 falha
-> Run FAILED

HTTP 200 + schema/content type/status conformes
-> assertions PASSED
-> Run PASSED
```

## Orquestração

O fluxo do Runner passa a ser:

```text
Queue
-> Claim / Lease
-> Heartbeat
-> Runtime Materialization
-> Runtime READY
-> HTTP Executor
-> HTTP summary
-> Heartbeat
-> Assertion Engine
-> Assertions evaluated summary
-> Runner received / release
-> ACK
```

## Contratos

Novos contratos:

```text
qagent.assertion-engine.v1
qagent.assertion-execution-batch.v1
qagent.runner-assertions-evaluated.v1
```

Rota interna Gateway:

```text
POST /internal/v1/runner/runs/:runId/assertions-evaluated
```

O transporte é protegido pelas mesmas regras internas de Run Control / HMAC e lease ativa.

## Run lifecycle

A partir da 07.7.7, o `run.status` finalmente pode terminar semanticamente em:

```text
PASSED
FAILED
ERROR
```

O status do execution attempt continua representando o lifecycle técnico do consumer/attempt e chega a `RECEIVED` após confirmação final. O resultado funcional do teste pertence a `run.status` + `assertionOutcome`.

A persistência de `assertionOutcome` não terminaliza o Run antecipadamente. O `PASSED`/`FAILED`/`ERROR` final é commitado junto com `attempt=RECEIVED`, liberação da lease e fechamento do dispatch. Isso evita uma janela de crash em que uma redelivery pudesse enxergar um Run terminal antes da lease/queue terem sido finalizadas.

## Control Plane x Results Plane

Gateway D1 recebe apenas resumo bounded:

```text
assertionOutcome
scenario totals
assertion totals
duration
evaluatedAt
um primaryDiagnostic seguro
```

Não persiste:

```text
response body
request body
valores JSON esperados/recebidos
assertion evidence detalhada
headers completos
cookies
tokens/secrets
```

Resultados completos por cenário/assertion continuam destinados ao futuro `qagent-test-results` / Execution Results Plane.

## Auth

A 07.7.7 não resolve credenciais.

Endpoints `auth.requirement=REQUIRED` continuam fail-closed no HTTP Executor até a Foundation 07.7.8 — Auth Runtime, que fará resolução JIT do Secret Vault sem persistir plaintext.

O caminho público/`auth=NONE` do Buggy Cars é o gate oficial desta Foundation.

## Side effects

`POST`, `PUT`, `PATCH` e `DELETE` permanecem desabilitados por padrão até existir execution journal durável no Results Plane.

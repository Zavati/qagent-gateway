# QAgent Foundation 07.7.8-C — Test Data Runtime

## Missão

Diminuir `NEEDS_DATA` sem transformar o Test Design em depósito de massa e sem quebrar o boundary de secrets.

```text
AI / Catalog Context
  -> Test Data Planner determinístico
  -> Test Design imutável (descriptors/references only)
  -> Run + Runtime Snapshot
  -> Runner Test Data Runtime
  -> request materializada em memória
  -> Auth Runtime
  -> HTTP Executor
```

## Contrato v1

### GENERATED

Valor produzido somente no Runner, em memória, a partir de descriptor persistível e seguro.

Seed canônica:

```text
runId | scenarioId | target | selector
```

Retry do mesmo Run/cenário/campo produz o mesmo valor. Um novo Run pode produzir outra massa.

Generators v1:

```text
AUTO
TEXT / TEXT_SENTENCE
FIRST_NAME / LAST_NAME / FULL_NAME
EMAIL / UUID / PHONE
DATE / DATE_TIME
INTEGER / NUMBER / BOOLEAN
STRING_LIST / INTEGER_LIST / NUMBER_LIST / BOOLEAN_LIST
JSON_SCHEMA
BR_CPF / BR_CNPJ / BR_CEP
```

`AUTO` nunca é autoridade no Runner: o Planner o resolve para um generator concreto quando possui tipo/schema; o Runner ainda possui fallback determinístico type-aware para defesa em profundidade.

### FIXED

Dado real configurado pelo QA para identificadores/códigos que não devem ser inventados.

Escopos e precedência:

```text
PROJECT < ENVIRONMENT < ENDPOINT
```

- `PROJECT`: fallback global do projeto.
- `ENVIRONMENT`: override por ambiente.
- `ENDPOINT`: override mais específico e environment-bound em v1.

O binding declarativo entra no Test Design por `bindingKey`. O valor FIXED não entra no Test Design. No início do Run, o Gateway resolve a precedência para o Environment selecionado e congela somente os FIXED realmente referenciados no Runtime Snapshot.

### SECRET

Campos sensíveis como `password`, `newPassword`, `token`, `accessToken`, `apiKey`, `clientSecret`, `Authorization`, `Cookie` etc. só podem usar `SECRET`.

```text
Test Design        -> bindingKey only
Runtime Snapshot   -> opaque Secret Vault reference only
Queue              -> no secret value
Runner             -> value JIT, in memory only
Logs/results       -> no secret value
```

O Gateway rejeita tentativa de persistir selector sensível como `FIXED` ou `GENERATED`. O Test Design Contract repete a regra e o Runner faz a terceira validação fail-closed.

Selectors legítimos como `$.tokens` não são bloqueados por substring genérica.

## Test Data Planner v1.1

Responsabilidades:

- converter campos modelados e geráveis em `GENERATED`;
- classificar IDs/códigos referenciais como `FIXED`;
- classificar selectors sensíveis como `SECRET`;
- inferir placeholders a partir do path canônico, mesmo que a IA omita `request.pathParams`;
- considerar BODY, PATH_PARAM e QUERY;
- respeitar configuração explícita antes de inferência;
- considerar cobertura por Environment;
- não limpar `needsData` pertencente a outro semantic blocker;
- remover literais planejados do request persistido.

A IA pode sugerir semântica, mas não decide valor runtime nem pode sobrescrever a política de segurança.

## Generator config secret-safe

`generatorConfig` não é JSON livre.

Para generators simples, a configuração persistida é `{}`.

Para `JSON_SCHEMA` / `AUTO + JSON`, somente uma projeção estrutural whitelisted do schema pode persistir. Campos livres, `default`, `example`, `examples`, `const` e payloads arbitrários são descartados antes de D1/Test Design/AI Context.

Schemas JSON gerados no Runner:

- produzem apenas propriedades `required`;
- recusam propriedade required sensível e exigem `SECRET`;
- não fabricam propriedades opcionais silenciosamente.

## Runtime Snapshot e Execution Plan

O Execution Plan continua imutável e carrega somente descriptors/references de Test Data.

O Runtime Snapshot pode carregar:

- FIXED referenciado: valor não sensível congelado para reprodução do Run;
- SECRET referenciado: `secretId` opaco/config metadata, nunca plaintext;
- GENERATED: nenhum valor gerado.

A Queue continua carregando referências do Run/plan/snapshot, nunca massa ou secret material.

## Runner

Ordem efetiva:

```text
claim/lease
-> materialize immutable runtime
-> Test Data Runtime
-> Auth Runtime
-> HTTP Executor
-> Assertion Engine
```

O Runner:

- exige `RUNNER_TEST_DATA_RUNTIME_ENABLED=true` quando há bindings;
- resolve SECRET somente via Runner Control HMAC + lease ativa + attempt + runtimePlanHash exato;
- mantém cache de SECRET apenas durante o attempt;
- aplica massa ao request somente em memória;
- não loga valores generated/fixed/secret;
- reporta somente contagens/duração/generator kinds seguros.

## Readiness

`READY` só pode ser alcançado quando todo Test Data necessário ao blocker que o Planner possui está resolvido.

Exemplos:

```text
comment:string modelado
-> GENERATED TEXT_SENTENCE
-> pode remover NEEDS_DATA de massa

/customer/{customerId}
-> FIXED necessário
-> NEEDS_DATA até existir cobertura explícita adequada

password
-> SECRET
-> NEEDS_DATA até Secret Vault estar configurado
```

O Planner não transforma em READY um cenário ainda bloqueado por exact-value grounding, query não modelada, assertion review ou outro semantic issue fora de Test Data.

## Side-effect policy

Esta Foundation NÃO altera a política de métodos com side effect.

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
```

continua sendo o padrão exigido. POST/PUT/PATCH/DELETE não devem ser habilitados globalmente antes de um durable execution journal específico para side effects/recovery.

## Persistência

Migration:

```text
0013_foundation_07_7_8_c_test_data_runtime.sql
```

Nova tabela:

```text
test_data_bindings
```

com CHECKs de scope shape e índices únicos ativos por PROJECT / ENVIRONMENT / ENDPOINT.

`run_execution_attempts` recebe somente summary operacional de Test Data Runtime:

```text
test_data_runtime_status
test_data_binding_count
test_data_generated_count
test_data_fixed_count
test_data_secret_count
test_data_duration_ms
test_data_resolved_at
```

Nenhum valor de massa é persistido nesse journal.

## Estado de validação do pacote revisado

```text
Gateway 07.7.8-C targeted tests          PASS
Gateway regression through 07.7.8-C     PASS
Runner 07.7.8-C targeted tests           PASS
Runner regression 07.7.3 -> 07.7.8-C    PASS
Console source-level test                PASS
D1 migrations 0001 -> 0013 SQLite        PASS
Scope CHECK / unique-index smoke          PASS
Production gate                          PENDING
```

Não avançar a Foundation para concluída em produção antes dos passos de `VALIDATION-FOUNDATION-07.7.8-C.md`.

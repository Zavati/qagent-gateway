# QAgent — Foundation 07.7.2-A
## Execution Readiness Bridge Hardening

**Status:** IMPLEMENTADA / AGUARDANDO VALIDAÇÃO EM PRODUÇÃO

## 1. Problema observado

A produção mostrou que `READY` existia no contrato, mas cenários tecnicamente simples continuavam bloqueados por `NEEDS_ENVIRONMENT` mesmo quando havia:

- API Service configurado;
- Base URL correta;
- Auth Profile utilizável;
- endpoint observado com host compatível.

A causa era arquitetural: o Catalog Context Builder misturava duas decisões diferentes:

```text
A qual serviço lógico este endpoint pertence?
+
Todos os Environments observados possuem exatamente o mesmo binding configurado?
```

Como Test Design é environment-independent, a segunda pergunta não pode apagar a primeira.

## 2. Decisão

Separar definitivamente:

```text
TEST DESIGN TIME
Catalog endpoint
→ resolve logical API Service identity
→ apiServiceKey

RUN CREATION TIME
apiServiceKey + selected environmentId
→ resolve exact environment_api_binding
→ physical baseUrl
```

O `qagent.run-create.v1` continua sendo o gate estrito de Environment.

## 3. Service Identity resolution v1.1

`qagent.catalog-context-builder.v1.1` passa a resolver a identidade lógica por origem HTTP observada:

```text
Catalog binding:
https://api-sestsenat.studionmx.com

Configured API binding em qualquer Environment do Project:
https://api-sestsenat.studionmx.com

→ unique candidate
→ MATCHED
→ apiServiceKey = sestsenat-api
```

O `environmentId` observado continua sendo preservado como diagnóstico de cobertura, mas não invalida um match inequívoco de serviço.

Novos sinais de diagnóstico:

```text
runtimeMapping.status
runtimeMapping.resolutionSource
runtimeMapping.observedOriginCount
runtimeMapping.environmentCoverageStatus
```

`environmentCoverageStatus`:

```text
COMPLETE
PARTIAL
NONE
NOT_APPLICABLE
AMBIGUOUS
```

Ele NÃO é readiness por si só.

## 4. Ambiguidade continua fail-closed

Se dois API Services configurados possuem o mesmo origin observado e não há vínculo explícito capaz de distingui-los:

```text
status = AMBIGUOUS
apiServiceKey = null
→ NEEDS_ENVIRONMENT
```

Nenhum serviceKey é escolhido por nome, ordem, IA ou heurística silenciosa.

Um futuro explicit Catalog Service ↔ Control Plane API Service mapping poderá resolver esse caso.

## 5. Auth availability environment-independent

O Test Design também não deve exigir que o Auth Profile esteja completo em todos os Environments observados.

Um Auth Profile é considerado disponível em design time se for utilizável em pelo menos um Environment onde o API Service resolvido possui binding.

```text
service = sestsenat-api
STG binding exists
Auth Profile credentials configured in STG

→ availableAuthProfileRefs includes auth profile
```

Se houver exatamente um profile utilizável:

```text
defaultAuthProfileRef = authp_...
```

O Create Run continua validando estritamente o Auth Profile contra o Environment selecionado.

## 6. READY continua system-owned

Esta Foundation NÃO adiciona atalho ou `force=true`.

A decisão final continua passando pelo QAgent contract/semantic guards:

```text
REVIEW_REQUIRED  → block
NEEDS_DATA       → block
NEEDS_AUTH       → block
NEEDS_ENVIRONMENT→ block
otherwise        → READY
```

O novo teste positivo prova:

```text
GET /api/myself
+ 200 observed
+ observed response schema
+ unique API Service origin match
+ usable Auth Profile
+ no data blocker
+ no review blocker
+ authRequirement REQUIRED

→ READY
```

## 7. Auth observation gap conhecido

O Catalog Query API atual não transporta valor de `Authorization`, corretamente.

Também ainda não existe no contexto um sinal sanitizado explícito equivalente a:

```text
authObserved = true
authScheme = BEARER
```

Portanto 07.7.2-A não tenta inferir ou reutilizar token observado.

O cenário positivo usa um `authRequirement` válido produzido pelo Test Design + um Auth Profile configurado. O Semantic Guard pode reduzir grounding de auth para `INFERRED` quando não existe evidência 401/403, mas isso não torna o cenário automaticamente não executável.

Antes de liberar HTTP real em escala, deve existir uma ponte sanitizada de Auth Observation ou outro vínculo explícito de auth por serviço/endpoint. Nunca transportar token/cookie/credential observado.

## 8. Zero-Config

Esta subfase prepara o caminho, mas ainda usa API Services configurados.

A próxima evolução deve aplicar o requisito congelado:

```text
EXPLICIT CONFIG
↓ fallback
DISCOVERED_OBSERVATION
↓ fallback
NEEDS_ENVIRONMENT
```

## 9. Arquivos alterados

```text
src/intelligence/catalogContextBuilder.js
test/test-foundation-07-6-2-catalog-context-builder.js
test/test-foundation-07-7-2-a-execution-readiness-bridge.js
package.json
```

Sem migration.
Sem alteração no Console.
Sem alteração no Test Registry.
Sem HTTP execution.

## 10. Testes

```text
npm run check:07.7.2-a
npm run test:all
```

Cobertura específica:

- unique origin service identity → MATCHED;
- Catalog Environment ID diferente do configured Environment ID → ainda MATCHED;
- Environment coverage continua diagnosticada;
- Auth Profile utilizável em Environment do serviço → disponível;
- real-like authenticated GET → READY;
- duplicate service origin → AMBIGUOUS / NEEDS_ENVIRONMENT;
- 07.6.x e 07.7.2 regressions permanecem verdes.

## 11. Production gate

Usar um endpoint simples como:

```text
GET https://api-sestsenat.studionmx.com/api/myself
```

Com:

```text
sestsenat-api
→ https://api-sestsenat.studionmx.com
```

Esperado no POST Test Design:

```text
runtimeMapping.status = MATCHED
runtimeMapping.resolutionSource = ORIGIN
selectedApiServiceKey = sestsenat-api
```

O `environmentCoverageStatus` pode ser `NONE` quando IDs de Environment do Knowledge Layer e Control Plane não coincidem. Isso não deve mais impedir a identidade lógica do serviço.

Um cenário tecnicamente simples, grounded e sem data/review blockers deve poder chegar a:

```text
automation.readiness = READY
```

## 12. Exit criteria

07.7.2-A fecha quando em produção:

- [ ] endpoint real deixa de receber `NEEDS_ENVIRONMENT` apenas por diferença de Environment IDs;
- [ ] `apiServiceKey` é persistido no TestSpecification;
- [ ] cenário real sem outros blockers chega a `READY`;
- [ ] ambiguous origin continua bloqueado;
- [ ] `POST Run` aceita esse `READY` e cria Run/Execution Plan sem executar HTTP.

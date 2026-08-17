# APPLY — Foundation 07.6.3 Fix 1

## Motivo

Em produção, o endpoint de Test Design retornou `AI_TEST_DESIGN_OUTPUT_INVALID` mesmo após uma tentativa de repair.

A auditoria identificou uma inconsistência entre o schema apresentado ao modelo e o validator real: `assertions[]` e `extract[]` eram descritos genericamente como objetos, enquanto o validator exige shapes estritos por tipo.

## Correção

- Expõe no `OUTPUT_JSON_SCHEMA` todos os shapes válidos de assertions:
  - STATUS
  - SCHEMA
  - JSON_PATH_EXISTS
  - JSON_PATH_EQUALS
  - HEADER_EXISTS
  - CONTENT_TYPE
- Expõe o shape estrito de `extract`.
- Reforça os shapes no system prompt e proíbe aliases (`expectedStatus`, `statusCode`, `jsonPath`, etc.).
- Repair recebe também a regra exata violada, sem incluir raw prompt/context.
- Em falha final, registra `testDesign_ai_contract_failed` com `validationCode` e `validationPath`.
- Resposta pública de `AI_TEST_DESIGN_OUTPUT_INVALID` passa a incluir apenas diagnostics seguros (`repairAttempts`, `validationCode`, `validationPath`).

## Aplicação

Substitua o repositório local pelo snapshot preservando `.git` e arquivos locais de ambiente.

```bash
npm ci
npm run test:f07-6-1
npm run test:f07-6-2
npm run test:f07-6-3
npm run test:router
npm run test:all
```

Não há migration, novo binding ou novo secret.

## Validação real

Repita:

```http
POST /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design
Authorization: Bearer <console session>
```

Se retornar `status=ok`, validar `data.specification.scenarios` e `data.diagnostics.repairAttempts`.

Se ainda retornar `AI_TEST_DESIGN_OUTPUT_INVALID`, copie apenas o bloco `details` da resposta e os eventos `testDesign_ai_contract_repair` / `testDesign_ai_contract_failed` do Gateway. O raw output da IA não é necessário.

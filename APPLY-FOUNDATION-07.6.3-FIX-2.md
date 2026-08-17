# Apply — Foundation 07.6.3 Fix 2

## Baseline

Aplicar sobre a última versão implantada da Foundation 07.6.3 Fix 1.

## Alterações principais

```text
src/intelligence/testDesignContract.js
src/intelligence/testDesignPrompt.js
src/intelligence/testDesignService.js
test/test-foundation-07-6-3-ai-test-design-engine.js
FOUNDATION-07.6.3-FIX-2.md
```

## Banco / bindings / secrets

Nenhuma migration.
Nenhum binding novo.
Nenhum secret novo.

## Testes

```bash
npm ci
npm run test:f07-6-1
npm run test:f07-6-2
npm run test:f07-6-3
npm run test:router
npm run test:all
```

## Deploy

Deploy normal do `qagent-gateway`.

## Validação real

Repetir:

```http
POST /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design
Authorization: Bearer <console session>
```

### Sucesso esperado

```json
{
  "status": "ok",
  "data": {
    "specification": {
      "specificationVersion": "qagent.test-spec.v1",
      "scenarios": []
    }
  }
}
```

Como o endpoint validado ainda não possui API Service configurado, é esperado que os cenários sejam calculados como:

```text
NEEDS_ENVIRONMENT
```

### Caso ainda falhe

Enviar apenas:

```json
{
  "validationCode": "...",
  "validationPath": "...",
  "expectedValues": [],
  "receivedType": "...",
  "receivedValue": "..."
}
```

quando esses campos existirem.

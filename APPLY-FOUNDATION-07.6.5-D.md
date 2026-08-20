# Apply — Foundation 07.6.5-D

## Serviço alterado

Somente `qagent-gateway`. O `qagent-test-registry` da 07.6.5-B/C não precisa de novo deploy para esta subfase.

## Antes do deploy

```bash
npm ci
npm run check:07.6.5-d
npm run test:all
```

## Deploy

```bash
npm run deploy
```

O binding existente deve continuar:

```json
{
  "binding": "TEST_REGISTRY_SERVICE",
  "service": "qagent-test-registry"
}
```

## Validação em produção

Use o endpoint já persistido na 07.6.5-C:

```http
GET /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design
Authorization: Bearer <console-session>
```

Esperado para endpoint persistido:

```json
{
  "status": "ok",
  "data": {
    "exists": true,
    "testDesign": {
      "id": "td_...",
      "versionId": "tdv_...",
      "version": 1,
      "createdAt": "...",
      "contextFingerprint": "...",
      "specification": {
        "contractVersion": "qagent.test-design.v1",
        "specificationVersion": "qagent.test-spec.v1"
      }
    }
  }
}
```

Também validar um endpoint sem geração: `exists=false` e `testDesign=null`.

Não criar rota pública para `test-registry/*`; retrieval continua Gateway -> Service Binding -> Registry.

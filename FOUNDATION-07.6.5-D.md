# QAgent — Foundation 07.6.5-D
## Retrieval API

Status: implementado localmente, aguardando validação em produção.

## Objetivo

Expor ao Console, via Gateway, a latest immutable Test Design Version já persistida no `qagent-test-registry`.

## Contrato Console

`GET /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design`

Sem geração:

```json
{
  "status": "ok",
  "data": { "exists": false, "testDesign": null }
}
```

Com geração:

```json
{
  "status": "ok",
  "data": {
    "exists": true,
    "testDesign": {
      "id": "td_...",
      "versionId": "tdv_...",
      "version": 2,
      "createdAt": "...",
      "contextFingerprint": "...",
      "specification": {}
    }
  }
}
```

## Segurança

- Console Bearer Session continua obrigatório.
- `requireConsoleTenant()` resolve Organization no Gateway.
- `getOrganizationProject()` autoriza Project antes do Registry.
- Gateway envia Organization/Project por headers internos via `TEST_REGISTRY_SERVICE`.
- O Gateway revalida o scope devolvido pelo Registry antes de expor o artefato.
- `generationRequestId`, metadata interna e diagnostics do Registry não são expostos no GET do Console.
- Nenhum fallback para localStorage/sessionStorage/IndexedDB.

## Registry

A rota interna `GET /v1/test-registry/projects/:projectId/endpoints/:endpointId/test-design/latest` já havia sido preparada na 07.6.5-B junto com o repositório imutável; portanto a D não exige migration nem mudança no Registry.

## Erro de retrieval

Falha do Service Binding/Registry é convertida para:

- HTTP 503
- `TEST_DESIGN_RETRIEVAL_FAILED`
- `details.retryable = true`

Sem retornar payload interno do Registry.

## Gate

1. endpoint sem geração -> `exists=false`;
2. endpoint com geração -> latest Version;
3. Project não autorizado -> negado antes de acessar Registry;
4. resposta cross-scope/corrompida do Registry -> rejeitada;
5. POST existente continua funcionando;
6. regressão histórica verde.

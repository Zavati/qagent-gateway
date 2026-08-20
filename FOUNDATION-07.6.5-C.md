# QAgent Foundation 07.6.5-C — Gateway Persistence Integration

## Scope

This increment connects the already validated Test Design generation flow to the independent `qagent-test-registry` service.

The persistence boundary is intentionally after:

1. Catalog Context Builder
2. AI Test Design Engine
3. Contract validation/repair
4. Semantic Grounding Guard
5. final `TestSpecificationV1` validation

Only then does the Gateway append an immutable Registry version.

## New Gateway components

- `src/services/testRegistryClient.js`
  - calls `qagent-test-registry` through `TEST_REGISTRY_SERVICE`;
  - sends authoritative `organizationId` and `projectId` headers;
  - never sends raw prompt, raw model output or arbitrary diagnostics;
  - reuses the same `generationRequestId` on a bounded transport retry;
  - validates the Registry response before reporting persistence success.

- `src/intelligence/testDesignPersistence.js`
  - orchestrates generate -> persist;
  - creates `tdg_*` generation request IDs;
  - maps Registry failures to `503 TEST_DESIGN_PERSISTENCE_FAILED`;
  - emits safe persistence logs;
  - returns the persisted envelope to the Console route.

## Existing POST response

`POST /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design`

now returns:

```json
{
  "status": "ok",
  "data": {
    "testDesign": {
      "id": "td_...",
      "versionId": "tdv_...",
      "version": 1,
      "persisted": true
    },
    "specification": {},
    "contextFingerprint": "...",
    "diagnostics": {}
  }
}
```

## Failure contract

If AI/guards succeed but Registry persistence does not:

```http
HTTP 503
```

```json
{
  "status": "error",
  "code": "TEST_DESIGN_PERSISTENCE_FAILED",
  "message": "O Test Design foi gerado, mas não pôde ser persistido no Test Registry.",
  "details": {
    "retryable": true
  }
}
```

The Gateway does not return a false success and does not leak Registry/D1 internals.

## Cloudflare binding

```json
{
  "binding": "TEST_REGISTRY_SERVICE",
  "service": "qagent-test-registry"
}
```

No public Registry wildcard route is added by this increment.

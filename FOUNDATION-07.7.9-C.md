# QAgent — Foundation 07.7.9-C
## Results Retrieval Gateway Bridge

**Status:** IMPLEMENTED / LOCAL VALIDATED / PRODUCTION GATE PENDING  
**Service:** `qagent-gateway`  
**Role:** Console BFF / Run Control Plane

## Objective

Expose authorized product reads for execution history without moving detailed result persistence into `QAGENT_DB` and without exposing `qagent-test-results` directly to the Browser.

## Browser-facing routes

```text
GET /v1/console/projects/:projectId/automation/summary
GET /v1/console/projects/:projectId/automation/results
GET /v1/console/projects/:projectId/automation/results/:resultSetId
GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId/automation/latest
```

Every route:

1. requires Console tenant authentication;
2. authorizes Organization/Project via Gateway state;
3. calls `RESULTS_SERVICE` by Cloudflare Service Binding;
4. forwards only Organization/Project scope headers;
5. accepts only `qagent.execution-results-read.v1` responses.

## Boundary

Gateway remains a BFF/control plane. It does not copy scenario/assertion detail into `QAGENT_DB`.

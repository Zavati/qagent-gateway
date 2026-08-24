# Validation — Foundation 07.7.9-C — qagent-gateway

## Local

```bash
npm ci
npm run check:07.7.9-c
```

This includes regression through 07.7.8-C, Results binding/config verification, BFF contract tests and router tests.

## Production

With an authenticated Console session and known Project:

```text
GET /v1/console/projects/:projectId/automation/summary
GET /v1/console/projects/:projectId/automation/results
GET /v1/console/projects/:projectId/automation/results/:resultSetId
GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId/automation/latest
```

Expected: `200` for authorized scope. Cross-tenant/project access must fail closed. `qagent-test-results` must remain inaccessible as a browser data API.

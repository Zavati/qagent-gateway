# Foundation 07.5.12-A — Gateway Catalog Proxy

## Goal
Expose the frozen Catalog Query API to authenticated Console users without exposing the Catalog HMAC secret to the browser.

## Boundary
`qagent-console -> Bearer session -> qagent-gateway -> signed HMAC -> qagent-catalog`

The Gateway remains the Control Plane authority for Organization/Project membership. The Catalog remains the Knowledge Layer.

## Console routes
- `GET /v1/console/projects/:projectId/catalog/summary`
- `GET /v1/console/projects/:projectId/catalog/services`
- `GET /v1/console/projects/:projectId/catalog/endpoints`
- `GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId`
- `GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId/evidence`
- `GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId/schemas`
- `GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId/lifecycle-history`

Query strings are forwarded unchanged and signed against the upstream Catalog URL.

## Security invariants
1. Browser never receives or knows `CATALOG_QUERY_HMAC_SECRET`.
2. Gateway derives `organizationId` from `requireConsoleTenant()`.
3. Gateway validates `projectId` through `getOrganizationProject(organizationId, projectId)` before proxying.
4. Gateway signs the exact frozen `qagent.catalog-query.v1` payload.
5. Catalog 401/403 HMAC failures become Gateway `502 CATALOG_UPSTREAM_AUTH_FAILED`, not browser 401.
6. Upstream stack/detail are logged internally but never returned by the Gateway HTTP error envelope.
7. Proxy is read-only in this foundation.

## Configuration
Wrangler vars:
- `CATALOG_QUERY_BASE_URL=https://api.apiqagent.com`
- `CATALOG_QUERY_TIMEOUT_MS=10000`

Worker secret (same value as qagent-catalog):
- `CATALOG_QUERY_HMAC_SECRET`

No D1 migration is required.

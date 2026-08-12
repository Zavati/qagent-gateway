# Foundation 07.4.3-B — Observation Grant

## Goal

Create the short-lived authorization bridge from the Gateway Control Plane to the independent Observation Data Plane.

## Endpoint

```http
POST /v1/plugin/observation-grants
Authorization: Bearer qps_...
Content-Type: application/json

{
  "projectId": "prj_...",
  "environmentId": "env_..."
}
```

## Validation chain

1. `qps_*` must exist in Gateway KV and still be valid.
2. Organization comes only from the Plugin Session; request bodies cannot choose it.
3. Organization must be active.
4. Project must be active and belong to the Organization.
5. Environment must be active and belong to that exact Organization + Project.
6. License/entitlement linked to the original ClientKey hash must still be valid.
7. Gateway signs a short-lived `qog_v1.*` grant.

## Grant claims

- `ver = 1`
- `iss = qagent-gateway`
- `aud = qagent-observation`
- `organizationId`
- `projectId`
- `environmentId`
- `pluginSessionId`
- `iat`
- `exp`
- unique `jti`

Default TTL: 120 seconds. Accepted configuration range: 30–300 seconds.

## Secret

`OBSERVATION_GRANT_SECRET` is intentionally not stored in `wrangler.jsonc`.
It must be configured as a Cloudflare Worker secret and must contain at least 32 characters.

The same value will be configured in `qagent-observation` during 07.4.3-C so the Data Plane can verify grants locally without calling the Gateway or sharing Gateway KV.

```bash
npx wrangler secret put OBSERVATION_GRANT_SECRET
```

## Security invariants

- ClientKey is never embedded in a grant.
- Raw `qps_*` is never embedded in a grant.
- Gateway KV is not shared with Observation.
- User input cannot set `organizationId`.
- Cross-tenant Project/Environment combinations fail before signing.
- No D1 migration is required for this slice.

## Exit criterion

An authorized Plugin Session can obtain a verifiable short-lived Observation Grant for exactly one active Organization + Project + Environment tuple.

# QAgent Foundation 07.6.2 — Catalog Context Builder

**Status:** implementation snapshot for production validation  
**Input contract:** `qagent.test-design.v1` from Foundation 07.6.1  
**Catalog contract:** `catalog-query-v1` (read-only, frozen)

## 1. Goal

Build the exact bounded context that a future AI Test Design service may consume for one Catalog endpoint.

07.6.2 does **not** call OpenAI/Gemini and does **not** persist Test Definitions. It establishes the deterministic bridge:

```text
Catalog endpoint
  + versioned schemas
  + evidence
  + operational/environment signals
  + Control Plane runtime configuration metadata
        ↓
CatalogTestDesignContextV1
        ↓
contextFingerprint (SHA-256)
```

## 2. New browser-facing read-only route

```http
GET /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design-context
Authorization: Bearer <Console Session>
```

The route:

1. resolves the authenticated Console tenant;
2. validates Project ownership in Gateway;
3. queries Catalog through the existing HMAC + Cloudflare Service Binding boundary;
4. reads non-secret Control Plane metadata;
5. returns a validated context, deterministic fingerprint and safe diagnostics.

It does not expose Catalog HMAC headers/secrets.

## 3. Catalog reads

The builder performs bounded reads:

```http
GET /v1/catalog/endpoints/:endpointId
GET /v1/catalog/endpoints/:endpointId/schemas?versionsPerTrack=8
GET /v1/catalog/endpoints/:endpointId/evidence?limit=50
```

Default context limits:

```text
evidence fetched            50
evidence selected           24
schema versions fetched      8 / track
schema tracks selected      24
schema version metadata      8 / track
```

The limits are internal and not browser-controlled in this foundation.

## 4. Evidence selection

Evidence is already sanitized by the Catalog Query API. The Context Builder reduces it further.

Only these fields enter `CatalogTestDesignContextV1`:

```text
evidenceId
observedAt
environmentId
outcome
statusCode
latencyMs
sourceHost
sessionId
requestSchemaVersionId
responseSchemaVersionId
```

Selection is deterministic:

1. prefer diversity by Environment + Outcome + Status + Schema refs;
2. fill remaining capacity with recent evidence;
3. deduplicate by `evidenceId`;
4. maximum 24 selected items by default.

Batch IDs, normalized event IDs, content-type metadata and other Catalog implementation fields are not passed merely because they exist upstream.

## 5. Schema compaction

For each selected Schema Track the context contains:

```text
trackId
direction
statusCode
currentVersionId
currentSchemaHash
current content types
current structural schema (when safe)
compact version metadata
```

The structural JSON is included only if it fits the Test Design v1 JSON safety bounds. If a schema is too wide/deep, it is omitted rather than destructively truncated into a structure that could be mistaken for the real contract.

Hashes/version IDs remain available for grounding even when structural JSON is omitted.

## 6. Catalog Service != runtime API Service

The builder never maps a discovered Catalog Service to a configured Control Plane API Service by name.

Runtime mapping uses physical environment evidence:

```text
Catalog Endpoint Binding
(environmentId + observed origin)
              ↕ exact origin match
Environment API Binding
(environmentId + configured baseUrl origin)
              ↓
logical apiServiceKey
```

The `apiServiceKey` is accepted only when one configured API Service is a unique, complete match across all environments where the endpoint was observed.

Mapping diagnostics:

```text
MATCHED
UNMATCHED
PARTIAL
AMBIGUOUS
```

For `UNMATCHED`, `PARTIAL` or `AMBIGUOUS`:

```json
{
  "runtime": {
    "apiServiceKey": null
  }
}
```

That is not a generation failure. Foundation 07.6.1 will later classify generated scenarios as `NEEDS_ENVIRONMENT` instead of inventing a target.

## 7. Auth Profile metadata

No credentials are read into the context.

The builder considers only active, enabled, non-`none` Auth Profiles whose environment bindings have configured credentials for **every observed endpoint Environment**.

Context receives only:

```text
availableAuthProfileRefs[]
defaultAuthProfileRef
```

`defaultAuthProfileRef` is selected only if there is exactly one complete profile. Multiple valid profiles remain explicit and no silent choice is made.

## 8. Environment context

Catalog environment operational summaries are joined with Control Plane Environment names by stable `environmentId`.

Only bounded operational metadata enters the context:

```text
environmentId
name
observationCount
successRatePct
lastSeenAt
```

No Web Base URL, API Base URL, variables or secret values enter the AI context.

## 9. Fingerprint

After contract validation, the final context is canonically serialized with lexicographically sorted object keys and hashed using SHA-256.

```text
same context -> same fingerprint
changed context -> different fingerprint
```

The fingerprint becomes generation provenance in Foundation 07.6.3/07.6.4.

## 10. Response shape

Example:

```json
{
  "status": "ok",
  "data": {
    "context": {
      "contractVersion": "qagent.test-design.v1",
      "organizationId": "org_...",
      "projectId": "prj_...",
      "endpoint": {},
      "schemas": [],
      "evidence": [],
      "environments": [],
      "runtime": {
        "apiServiceKey": "checkout",
        "defaultAuthProfileRef": "authp_...",
        "availableAuthProfileRefs": ["authp_..."]
      }
    },
    "contextFingerprint": "<64 hex>",
    "diagnostics": {
      "builderVersion": "qagent.catalog-context-builder.v1",
      "runtimeMapping": {},
      "auth": {},
      "schemas": {},
      "evidence": {},
      "limits": {}
    }
  }
}
```

Diagnostics intentionally contain counts/status only, never secret values or physical Base URLs.

## 11. Security invariants

- Console Bearer remains the browser credential.
- Gateway remains tenant/project authority.
- Catalog continues to be accessed through existing signed internal Query API.
- No Catalog D1 access from Gateway/Console.
- No raw request/response payloads are reintroduced.
- No environment variables are sent to AI context in v1.
- No Secret Vault values are resolved.
- No browser auth/cookies are reused.
- No AI provider is called in 07.6.2.
- No runtime service is guessed from Catalog Service name.

## 12. Exit criteria

07.6.2 is complete when a real endpoint can return a validated context where:

1. endpoint identity matches Catalog;
2. current schema tracks are grounded by real version/hash refs;
3. selected Evidence IDs all exist in Catalog data;
4. Project Environment names are resolved from Control Plane;
5. runtime API Service is mapped only through deterministic physical bindings;
6. auth readiness contains references only, never credentials;
7. the context passes `validateCatalogTestDesignContextV1()`;
8. a stable 64-hex SHA-256 fingerprint is produced;
9. no AI call has occurred.

## 13. Next

Foundation 07.6.3 — AI Test Design Engine:

```text
CatalogTestDesignContextV1
  -> provider/model selection through existing AI Engine
  -> constrained prompt
  -> TestDesignModelOutputV1
  -> contract validation
  -> TestSpecificationV1
```

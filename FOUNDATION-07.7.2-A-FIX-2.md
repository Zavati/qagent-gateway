# QAgent — Foundation 07.7.2-A FIX-2
## Observed Auth Signal Bridge

**Status:** Gateway consumer + deterministic bridge implemented and tested. Upstream signal propagation required for production activation.

## Problem proved in production

A real monitored authenticated endpoint could reach:

```text
runtimeMapping = MATCHED
configuredProfileCount = 1
completeProfileCount = 1
READY = 6
```

while the persisted TestSpecification still contained:

```json
{
  "auth": {
    "requirement": "NONE",
    "authProfileRef": null
  }
}
```

The Observation security boundary correctly removes credential values, but the Knowledge/Reasoning pipeline also lost the safe fact that authentication had been observed.

## Decision

Authentication presence is system-owned evidence, not an AI guess.

Safe derived contract:

```json
{
  "authObserved": true,
  "authScheme": "BEARER"
}
```

Allowed schemes:

```text
BEARER
BASIC
API_KEY
COOKIE
UNKNOWN
```

No credential value, token hash, JWT claim, cookie value, API key value or Authorization value is allowed.

## Gateway implementation

### Catalog Context Builder v1.2

`qagent.catalog-context-builder.v1.2` consumes optional Evidence fields:

```text
authObserved
authScheme
```

and aggregates:

```json
{
  "runtime": {
    "authObservation": {
      "status": "REQUIRED | NONE | MIXED | UNKNOWN",
      "scheme": "BEARER | BASIC | API_KEY | COOKIE | UNKNOWN | null",
      "evidenceRefs": []
    }
  }
}
```

Aggregation is performed over fetched Evidence, not only AI-selected Evidence.

### Auth Profile compatibility

When auth observation is `REQUIRED`, only compatible configured Auth Profiles remain eligible.

BEARER:

```text
api_key + header Authorization
oauth2_client_credentials + targetHeader Authorization
login_http_json + targetHeader Authorization + Bearer scheme
```

BASIC:

```text
basic
```

API_KEY:

```text
api_key
```

COOKIE:

```text
no current compatible profile => NEEDS_AUTH
```

If exactly one compatible profile exists, it becomes `defaultAuthProfileRef`.

### Semantic Grounding Guard v1.3

The Guard now understands `runtime.authObservation.status=REQUIRED` as real sanitized authentication evidence.

It no longer downgrades an otherwise OBSERVED scenario merely because no 401/403 was observed.

### Observed Auth Signal Bridge v1

New system-owned post-Guard stage:

```text
AI
↓
Contract Validation
↓
Semantic Grounding Guard
↓
Observed Auth Signal Bridge
↓
TestSpecification
```

Rules:

```text
REQUIRED + normal scenario
→ force authRequirement=REQUIRED

REQUIRED + explicit UNAUTHENTICATED scenario
→ preserve UNAUTHENTICATED

REQUIRED + compatible default Auth Profile
→ authProfileRef populated

REQUIRED + no compatible profile
→ NEEDS_AUTH

MIXED
→ REVIEW_REQUIRED

NONE / UNKNOWN
→ do not invent auth
```

### Prompt v6

The prompt now tells the model that `runtime.authObservation` is authoritative safe context. The deterministic bridge remains the final authority.

## Safety guarantees

The Gateway ignores unexpected raw credential-like fields received from Catalog Evidence.

Tests inject a fake `authorization`/`rawAuthorization` value and prove it does not reach:

```text
Catalog Context
Context diagnostics
Auth Bridge diagnostics
TestSpecification
```

## No migration

This Gateway patch does not require a Gateway D1 migration.

## Production activation dependency

Current production Catalog Evidence does not yet emit `authObserved` / `authScheme`.

Therefore deploying only this Gateway patch leaves:

```text
authObservation.status = UNKNOWN
```

and does not retroactively infer authentication.

The upstream Observation → Normalizer → Catalog chain must implement the safe derived signal described in `UPSTREAM-AUTH-SIGNAL-CONTRACT-07.7.2-A-FIX-2.md`.

## Exit gate

For the real endpoint:

```text
GET /api/myself/settings
```

expected after upstream propagation:

```text
runtimeMapping.status = MATCHED
auth.observationStatus = REQUIRED
auth.observedScheme = BEARER
auth.compatibleProfileCount = 1
auth.defaultSelected = true
```

and for normal observed scenarios:

```json
{
  "auth": {
    "requirement": "REQUIRED",
    "authProfileRef": "authp_..."
  },
  "automation": {
    "readiness": "READY",
    "blockers": []
  }
}
```

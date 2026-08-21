# Apply — Foundation 07.7.2-A FIX-2
## Observed Auth Signal Bridge

## 1. Gateway patch

No D1 migration is required for this Gateway revision.

Run:

```bash
npm ci
npm run check:07.7.2-a-fix-2
npm run test:all
npm run deploy
```

## 2. Important: Gateway deploy alone is not the production gate

The current Catalog Evidence contract in production does not yet return:

```text
authObserved
authScheme
```

Until the upstream Observation pipeline emits them, Gateway diagnostics will show:

```text
observationStatus = UNKNOWN
observedScheme = null
```

and existing behavior remains conservative.

## 3. Upstream services that must be patched

Use the latest source snapshots for:

```text
qagent-plugin-v2
qagent-observation
qagent-normalizer
qagent-catalog
```

Apply the contract in:

```text
UPSTREAM-AUTH-SIGNAL-CONTRACT-07.7.2-A-FIX-2.md
```

The order should be:

```text
Catalog additive schema/read support
↓
Normalizer propagation
↓
Observation propagation/validation
↓
Plugin derivation-before-redaction
↓
Gateway already prepared
```

This order keeps downstream consumers tolerant before producers start emitting the field.

## 4. Production validation

Monitor a new authenticated GET after all upstream services are deployed.

Then regenerate:

```text
GET /api/myself/settings
```

Expected diagnostics:

```json
{
  "auth": {
    "observationStatus": "REQUIRED",
    "observedScheme": "BEARER",
    "compatibleProfileCount": 1,
    "defaultSelected": true
  }
}
```

Expected Test Specification:

```json
{
  "spec": {
    "auth": {
      "requirement": "REQUIRED",
      "authProfileRef": "authp_..."
    }
  },
  "automation": {
    "readiness": "READY",
    "blockers": []
  }
}
```

## 5. Negative gates

Bearer observed + no profile:

```text
NEEDS_AUTH
```

Bearer observed + Basic-only profile:

```text
NEEDS_AUTH
```

Mixed authenticated/unauthenticated evidence:

```text
REVIEW_REQUIRED
```

Explicit unauthenticated negative scenario:

```text
UNAUTHENTICATED preserved
```

## 6. No secret regression

Search D1/logs/messages after a test capture. No Bearer/JWT/API key value may appear outside the browser's original request.

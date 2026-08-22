# QAgent — Architectural Requirement
## Zero-Config Runtime Bootstrap

**Status:** IMPLEMENTED v1 / FROZEN FOR RUNNER ARCHITECTURE  
**Introduced:** Foundation 07.7.1 / carried into 07.7.2+

## Product rule

A QA must not need to manually configure every Environment, API Service and mapping before QAgent can create value.

Resolution precedence:

```text
1. USER / EXPLICIT CONFIGURATION
   always wins

2. DISCOVERED RUNTIME FROM OBSERVATION
   used when the target can be inferred safely and unambiguously

3. BLOCK
   only when neither explicit configuration nor safe discovery can resolve runtime
```

`NEEDS_ENVIRONMENT` must mean that QAgent cannot safely resolve a runtime, not merely that the user has not filled a form.

## Discovery inputs

QAgent may use sanitized Catalog/Observation knowledge such as:

```text
scheme
host / authority
normalized path
service identity
classification
observed Environment identity
frequency
confidence
evidence
```

Potential discovered runtime:

```text
host: apigtw.example.com
path family: /core-api/*
→ API Service candidate: core-api
→ Base URL candidate: https://apigtw.example.com
```

## Provenance

Every Runtime Snapshot must record provenance:

```text
resolution.source:
- EXPLICIT_CONFIG
- DISCOVERED_OBSERVATION

resolution.confidence:
- CONFIRMED
- HIGH
- MEDIUM
- LOW

resolution.requiresExecutionConfirmation: boolean
```

Rules:

```text
EXPLICIT_CONFIG
→ confidence = CONFIRMED
→ explicit configuration overrides discovery

DISCOVERED_OBSERVATION
→ confidence derived from discovery
→ execution confirmation required until policy explicitly allows otherwise
```

## Auth safety

Observation may infer:

```text
Bearer auth detected
API key header detected
Basic auth behavior detected
```

Observation must never promote observed credentials into Runner credentials.

Never persist/reuse from monitored traffic:

```text
Authorization values
Bearer tokens
cookies
session ids
passwords
API keys
refresh tokens
client secrets
```

Auth material continues through Auth Profile + Secret Vault and is resolved JIT.

## Execution safety

A discovered host must never become an arbitrary Browser-controlled destination.

The Gateway / Runtime Materializer is authoritative.

Before first execution of a discovered target, policy must validate:

```text
tenant/project scope
observation provenance
confidence
SSRF/egress policy
allowed scheme/port
redirect policy
user confirmation when required
```

## 07.7.2 implementation hook

`qagent.runtime-snapshot.v1` already supports:

```json
{
  "resolution": {
    "source": "EXPLICIT_CONFIG | DISCOVERED_OBSERVATION",
    "confidence": "CONFIRMED | HIGH | MEDIUM | LOW",
    "requiresExecutionConfirmation": true
  }
}
```

Foundation 07.7.6-A implements `DISCOVERED_OBSERVATION` for unique, safe public HTTPS origins. The discovered runtime is not auto-persisted as an API Service; it is frozen only into the confirmed Run Runtime Snapshot. Explicit configuration continues to win.

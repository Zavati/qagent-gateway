# QAgent — Foundation 07.7.6-A
## Zero-Config Runtime Bootstrap v1

**Status:** IMPLEMENTED / production gate pending  
**Depends on:** 07.7.6 HTTP Executor v1  
**Primary service changed:** `qagent-gateway`  
**Runner change:** none required; 07.7.6 Runner is already compatible with `DISCOVERED_OBSERVATION` Runtime Snapshots.

## Product objective

A first-time QA must be able to install the Plugin, monitor an application and obtain an executable Test Design without manually recreating API Service/Base URL configuration that QAgent already observed.

Precedence is frozen as:

```text
EXPLICIT_CONFIG
  wins when present

else

unique + safe observed HTTPS origin
  -> DISCOVERED_OBSERVATION

else

NEEDS_ENVIRONMENT
```

## Test Design bootstrap

When no configured API Service matches the endpoint and the endpoint has exactly one safe observed public HTTPS origin, the Context Builder creates a deterministic ephemeral runtime identity:

```text
discovered-<fnv1a64(origin)>
```

Example:

```text
observed origin
https://k51qryqov3.execute-api.ap-southeast-2.amazonaws.com

->
apiServiceKey = discovered-<stable-id>
runtime source = DISCOVERED_OBSERVATION
confidence = HIGH
requiresExecutionConfirmation = true
```

The key is not persisted in `api_services` and does not pretend to be user configuration. It is a stable Test Design/runtime reference derived from sanitized observation knowledge.

## Safety constraints

Discovery v1 promotes only targets that are:

```text
HTTPS
single observed origin
no URL credentials
no query/hash in base origin
not localhost
not private/link-local IPv4
not loopback/private/link-local IPv6
not .local/.internal
not cloud metadata host
```

Multiple observed origins remain fail-closed and produce no runtime key.

## Environment ownership

The user still selects/configures the QAgent Environment.

At Create Run, the Gateway re-resolves the observed endpoint and requires the discovered origin to have been observed in the selected `environmentId` when environment evidence exists.

This prevents:

```text
observe PROD target
+
select STG label
-> silently execute PROD
```

## Explicit confirmation

`qagent.run-create.v1` gains one optional system-safe field:

```json
{
  "confirmDiscoveredRuntime": true
}
```

Without it, a discovered Runtime returns:

```text
409 RUN_DISCOVERED_RUNTIME_CONFIRMATION_REQUIRED
```

with safe public details containing the discovered Base URL, confidence and Environment ID.

After confirmation, the immutable Runtime Snapshot is frozen as:

```json
{
  "resolution": {
    "source": "DISCOVERED_OBSERVATION",
    "confidence": "HIGH",
    "requiresExecutionConfirmation": false
  }
}
```

The confirmation bit participates in the Run idempotency fingerprint.

## Runtime Snapshot

The discovered service is materialized only inside the immutable Run Runtime Snapshot:

```json
{
  "apiServices": {
    "discovered-...": {
      "apiServiceId": null,
      "name": "Discovered k51qryqov3.execute-api.ap-southeast-2.amazonaws.com",
      "serviceKey": "discovered-...",
      "baseUrl": "https://k51qryqov3.execute-api.ap-southeast-2.amazonaws.com"
    }
  }
}
```

No new Control Plane API Service record is created automatically.

## Auth behavior

Auth remains endpoint/evidence driven.

```text
Observed auth NONE
-> no Auth Profile needed

Observed auth REQUIRED
-> Auth Profile + Environment credential binding still required
```

Observed credentials are never reused.

## Runner compatibility

The 07.7.6 Runner already accepts:

```text
resolution.source = DISCOVERED_OBSERVATION
```

and executes from the frozen `runtimeSnapshot.apiServices` map. No Runner code change is required for 07.7.6-A.

## Production gate

Buggy Cars Rating is the first target:

```text
GET /prod/models
origin = https://k51qryqov3.execute-api.ap-southeast-2.amazonaws.com
auth = NONE
```

Expected sequence:

```text
zero API Services configured
-> Generate Test Design
-> READY
-> apiServiceKey = discovered-...
-> POST Run without confirmation = 409
-> POST Run with confirmDiscoveredRuntime=true
-> Runtime Snapshot source DISCOVERED_OBSERVATION
-> Queue / Claim / Runtime READY
-> HTTP Executor may execute when RUNNER_HTTP_EXECUTION_ENABLED=true
```

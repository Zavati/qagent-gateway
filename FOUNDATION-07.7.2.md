# QAgent — Foundation 07.7.2
## Run Contract + Execution Plan Foundation

**Status:** IMPLEMENTED LOCALLY / AWAITING PRODUCTION VALIDATION

## Goal

Create the control-plane artifact that transforms a pinned immutable Test Design Version into a deterministic, persisted Execution Plan without performing HTTP execution yet.

## Contracts frozen

```text
qagent.run-create.v1
qagent.run.v1
qagent.runtime-snapshot.v1
qagent.execution-plan.v1
qagent.run-requested.v1
```

## Console API

Create:

```http
POST /v1/console/projects/:projectId/runs
Idempotency-Key: <8..160 safe chars>
```

Body:

```json
{
  "contractVersion": "qagent.run-create.v1",
  "testDesignVersionId": "tdv_...",
  "environmentId": "env_...",
  "scenarioIds": ["test_001"]
}
```

`scenarioIds` is optional. If omitted, all `READY` scenarios are selected. Non-READY scenarios are always rejected fail-closed.

Retrieve:

```http
GET /v1/console/projects/:projectId/runs/:runId
```

The Console response is deliberately safe and does not expose plaintext secrets, raw Secret Vault values or the full internal execution payload.

## Pinned Test Design

Run creation retrieves the exact artifact through the Registry frozen contract:

```http
GET /v1/test-registry/runner/test-design-versions/:testDesignVersionId
```

A Run never resolves `latest` at execution time.

## Runtime materialization

Current source:

```text
Environment
+ Environment API Bindings
+ Environment Variable keys (values are not copied until DSL references exist)
+ public Auth Profile metadata
```

Persisted as an immutable:

```text
qagent.runtime-snapshot.v1
```

No Secret Vault plaintext is persisted.

Zero-config provenance is already part of the contract:

```text
EXPLICIT_CONFIG
DISCOVERED_OBSERVATION
```

07.7.2 uses `EXPLICIT_CONFIG`; Observation bootstrap is a subsequent Runtime integration gate.

## Schema materialization

`SCHEMA` assertions are resolved at Run creation and embedded as exact schema snapshots in the Execution Plan.

Resolution accepts Catalog refs by:

```text
schema track id
schema version id
schema hash
```

The selected structural schema is frozen into the plan. The Runner will never ask for `latest schema` during execution.

## Persistence

Migration:

```text
0005_foundation_07_7_2_run_contract_execution_plan.sql
```

Tables:

```text
runs
runtime_snapshots
execution_plans
```

Immutability:

```text
runtime_snapshots → immutable
execution_plans   → immutable
runs              → lifecycle/status will evolve in later subphases
```

Idempotency:

```text
UNIQUE (organization_id, project_id, idempotency_key)
```

Replay with the same key + same request returns the same Run.
Same key + different request returns:

```text
409 RUN_IDEMPOTENCY_CONFLICT
```

## Eligibility

Only:

```text
READY
```

is accepted.

Blocked:

```text
NEEDS_ENVIRONMENT
NEEDS_DATA
NEEDS_AUTH
REVIEW_REQUIRED
unknown
```

## Explicitly not implemented

```text
HTTP execution
Queue
qagent-runner Worker
lease / heartbeat
attempts
results
runtime tokens
OAuth acquisition
SSRF executor
Console Run button
```

## Test status

```text
07.7.2 specific suite ✅
full Gateway regression ✅
all migrations parsed by SQLite ✅
foreign_key_check = clean ✅
```

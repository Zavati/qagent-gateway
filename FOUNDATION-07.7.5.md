# QAgent — Foundation 07.7.5
## Runtime Integration + Readiness Resolution

**Status:** implemented / awaiting production gate

## Objective

Turn the immutable `qagent.runtime-snapshot.v1` + `qagent.execution-plan.v1` into a deterministic, safe Runner runtime plan before any external HTTP execution.

Flow:

```text
Queue delivery
-> claim / lease
-> validate immutable bundle
-> Execution Runtime Materializer
-> qagent.runner-runtime-plan.v1
-> persist safe runtime READY summary
-> RECEIVED / ACK
```

No customer API request is executed in this Foundation.

## Important architectural decision

Foundation 07.7.2 already freezes Environment/API binding/public Auth metadata in `qagent.runtime-snapshot.v1`.

Therefore 07.7.5 does **not** re-resolve current Base URLs from mutable configuration. The immutable Runtime Snapshot is authoritative for non-secret runtime values. This preserves reproducibility if project configuration changes after Run creation.

JIT plaintext secret resolution remains deferred to 07.7.8.

## Runtime materializer validation

For every READY scenario:

- API Service key exists in Runtime Snapshot;
- Base URL is http/https, contains no credentials/query/hash;
- scenario target path is controlled and relative;
- method is in GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS;
- REQUIRED Auth Profile exists and was configured for selected Environment at Run creation;
- every SCHEMA assertion has an immutable schema snapshot;
- unresolved `${...}` variable interpolation fails closed because DSL v1 has no variable-reference contract yet;
- `DISCOVERED_OBSERVATION` runtime with `requiresExecutionConfirmation=true` fails closed.

## Contracts

```text
qagent.runner-runtime-plan.v1
qagent.runner-runtime-ready.v1
qagent.runner-rejected.v1
```

## Control Plane persistence

Migration `0008_foundation_07_7_5_runtime_integration.sql` adds only safe attempt summaries:

```text
runtime_readiness_status
runtime_plan_hash
runtime_target_count
runtime_resolution_source
runtime_resolution_confidence
runtime_materialized_at
```

No request/response payloads, secrets, Bearer tokens or assertion details are stored in QAGENT_DB.

## Permanent runtime rejection

A permanent runtime/materialization failure after a successful claim is persisted as:

```text
attempt -> REJECTED
claim -> IDLE
run -> ERROR
dispatch -> RECEIVED + last_error_code
```

This avoids ACKing a poisoned message while leaving an orphan ACTIVE lease.

## Results Plane boundary

Detailed execution evidence does not belong in Gateway D1.

Future dedicated service:

```text
qagent-test-results
  -> own D1 for runs/scenarios/assertions/timings/safe metadata
  -> R2 for large sanitized artifacts
  -> analytics store for aggregates/metrics when needed
```

Gateway remains the Run Control Plane and stores only lifecycle/attempt/queue/runtime summaries and references.

## Gate

```text
READY scenario
-> selected STG Runtime Snapshot
-> deterministic URL target without hard-coded host
-> required Auth Profile reference validated
-> schema snapshots verified
-> runtimeReadinessStatus = READY
-> runtimePlanHash persisted
-> HTTP execution remains disabled
```

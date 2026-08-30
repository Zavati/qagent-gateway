# QAgent Foundation 07.7.10-B FIX-3.1 — Rejection Diagnostics + Terminal Recovery

Status: **IMPLEMENTED / LOCAL REGRESSION PASSED / PRODUCTION VALIDATION PENDING**

## 1. Why this fix exists

The first FIX-3 STG run proved the mutation safety boundary, but exposed two lifecycle/diagnostic gaps before the first business POST could be dispatched:

1. mutation Runs could fail between `PREPARED` and `DISPATCHING` and surface only the generic `RUNNER_TRANSIENT_ERROR`;
2. a permanent Runner rejection could fail to persist because the Gateway `qagent.runner-rejected.v1` phase contract did not match the phases the Runner actually emits;
3. when retries were exhausted and the Queue moved the message to `qagent-run-dlq`, no Run Control consumer terminalized the child Run, leaving the parent Suite Run permanently `RUNNING`.

FIX-3.1 repairs those boundaries without relaxing mutation safety and without adding any D1 migration.

## 2. Services changed

### qagent-gateway
Gateway remains the Run Control Plane and becomes the owner of DLQ terminal recovery.

Changes:
- aligns `qagent.runner-rejected.v1` runtime normalization and JSON Schema;
- accepts all Runner phases:
  - `INTAKE`
  - `RUNTIME`
  - `TEST_DATA`
  - `AUTH`
  - `HTTP`
  - `ASSERTION`
  - `RESULTS`
  - `MUTATION_PREFLIGHT`
  - `MUTATION_CONTROL`
  - `MUTATION_HTTP`;
- a permanent rejection now terminalizes Runs in `CREATED`, `QUEUED`, **or `RUNNING`** state;
- normal permanent rejection releases the active lease and persists `runs.status=ERROR`;
- reconciles the associated Suite child immediately after a successful `/rejected` callback;
- consumes `qagent-run-dlq` as the final Run Control fallback;
- DLQ recovery validates the immutable `runId`, `executionPlanId`, and `runtimeSnapshotId` before terminalization;
- DLQ recovery reconciles mutation state before marking the Run terminal;
- child/Suite aggregate is refreshed after terminalization.

### qagent-runner
Runner keeps execution responsibility and improves diagnostic preservation.

Changes:
- preserves the original permanent failure **before** calling Gateway `/rejected`;
- if `/rejected` itself fails, logs both:
  - `originalErrorCode` / `originalPhase`;
  - `persistErrorCode`;
- mutation failures around the dispatch-control boundary emit `run_mutation_dispatch_failed`;
- retry logs now include safe mutation context (`mex_*`, journal state, phase, whether dispatch was durably recorded);
- Runner health reports Foundation `07.7.10-B-FIX-3.1`;
- Runner does **not** consume `qagent-run-dlq`; DLQ terminal recovery belongs to Gateway.

### No changes
- qagent-test-registry: no change
- qagent-test-results: no change
- qagent-console: no source change required for this recovery fix

## 3. Permanent rejection lifecycle

Normal permanent errors must not need DLQ fallback:

```text
Runner detects permanent error
        ↓
run_permanent_rejection
(original code + phase preserved)
        ↓
POST /internal/v1/runner/runs/{runId}/rejected
        ↓
Gateway validates qagent.runner-rejected.v1
        ↓
Attempt → REJECTED
Claim   → IDLE
Run     → ERROR
        ↓
Suite child reconciled
        ↓
Suite aggregate recalculated
        ↓
Queue message ACK
```

If the persistence callback fails, Runner does not hide the original error:

```text
originalErrorCode = RUNNER_...
originalPhase     = MUTATION_CONTROL
persistErrorCode  = RUNNER_REJECTED_CONTRACT_INVALID / control error
```

## 4. DLQ terminal recovery

`qagent-run-dlq` remains the dead-letter queue of `qagent-run-requests`, but its consumer is now the Gateway.

```text
qagent-run-requests
       ↓ retries exhausted
qagent-run-dlq
       ↓
Gateway DLQ consumer
       ↓
validate immutable refs
       ↓
reconcile mutation journal
       ↓
terminalize run_*
       ↓
reconcile suite child
       ↓
recalculate srun_*
       ↓
ACK DLQ message
```

The Gateway consumes the DLQ because recovery changes Run Control state and must not become an execution-plane responsibility.

## 5. Mutation Journal recovery semantics

DLQ recovery is state-aware:

### PREPARED
No durable network dispatch was recorded.

```text
PREPARED
   ↓ DLQ terminal recovery
FAILED_BEFORE_DISPATCH
```

This is safe and deterministic.

### DISPATCHING
Network dispatch may have happened.

```text
DISPATCHING
   ↓ DLQ terminal recovery
UNKNOWN_SIDE_EFFECT
```

The system never rewrites this to a safe retry state and never claims the business mutation was not sent.

Other terminal/known states remain unchanged.

## 6. Diagnostic logs

New/strengthened safe logs include:

### Mutation control failure
```text
run_mutation_dispatch_failed
runId
attemptId
scenarioId
mutationExecutionId
phase
errorCode
journalState
dispatchRecorded
```

### Permanent rejection
```text
run_permanent_rejection
originalErrorCode
originalPhase
mutationExecutionId
journalState
dispatchRecorded
```

### Rejection persistence failure
```text
run_rejection_state_persist_failed
originalErrorCode
originalPhase
persistErrorCode
mutationExecutionId
journalState
dispatchRecorded
```

### DLQ terminalization
```text
run_dlq_terminalized
runId
status
mutationFailedBeforeDispatch
mutationUnknownSideEffect
suiteRunId
suiteRunStatus
```

No request body, response body, Authorization, Cookie, token, password, Idempotency-Key or Vault material is logged.

## 7. Migrations

**No new migration.**

Gateway migrations `0001–0017` are byte-for-byte identical to the production-validated FIX-3 baseline.

Runner has no D1 migrations.

## 8. Queue ownership

```text
qagent-runner
  consumes: qagent-run-requests
  DLQ:      qagent-run-dlq

qagent-gateway
  consumes: qagent-suite-run-orchestration
  consumes: qagent-run-dlq
```

The Runner must not also consume `qagent-run-dlq`.

## 9. Safety invariants preserved

- `RUNNER_MUTATION_EXECUTION_ENABLED` remains the global business-mutation kill switch.
- Policy + `mex_*` + durable `DISPATCHING` are still mandatory before mutation `fetch()`.
- No POST is considered dispatched while Journal remains `PREPARED`.
- DLQ before dispatch → `FAILED_BEFORE_DISPATCH`.
- DLQ after dispatch uncertainty → `UNKNOWN_SIDE_EFFECT`.
- no blind mutation retry is introduced.
- immutable queue references are validated before DLQ recovery.
- no secret-safe contract is relaxed.

## 10. Local release gate

Passed:
- complete Gateway regression through FIX-3.1;
- complete Runner regression through FIX-3.1;
- real SQLite terminalization tests;
- real SQLite Suite reconciliation tests;
- mutation DLQ state reconciliation tests;
- Runner rejection diagnostic tests;
- Gateway/Runner source syntax checks;
- legacy migrations unchanged.

Production validation is still required.

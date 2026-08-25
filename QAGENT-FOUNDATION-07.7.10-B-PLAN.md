# QAgent Foundation 07.7.10-B — Suite Run Contract + Durable Orchestration

**Status:** IMPLEMENTED / LOCAL VALIDATED / PENDING PRODUCTION GATE  
**Architecture:** Multi-tenant, server-side, bounded fan-out  
**Introduced after:** 07.7.10-A FIX-1 — Suite Execution Eligibility + Hot-Path Inventory Projection

## 1. Product objective

Turn an immutable zero-config Suite snapshot (`suitev_*`) into one durable regression execution (`srun_*`) without making the browser fan out individual Runs.

The QAgent already knows which Test Design Versions and scenarios are execution-eligible. 07.7.10-B makes the action below real:

> **Executar todos os cenários executáveis**

The user selects one concrete Environment, starts one Suite Run, and the platform creates the existing endpoint Runs in controlled server-side windows. Each child Run continues through the already validated Runtime, Auth, Test Data, HTTP, Assertion and Results pipelines.

## 2. Important boundary: business mutations remain disabled

07.7.10-B does **not** enable application-side `POST`, `PUT`, `PATCH` or `DELETE`.

The QAgent may execute infrastructure/authentication POSTs, such as an OAuth token exchange, because those belong to Auth Runtime. Business mutation scenarios continue under `MUTATION_EXECUTION_DISABLED` and are excluded from the Auto Suite by `qagent.suite-execution-eligibility.v1`.

Mutation execution remains deferred until a durable side-effect/mutation journal, retry safety and explicit mutation policy exist.

## 3. End-to-end architecture

```text
Console
  |
  | POST /suite-runs
  v
Gateway / Run Control Plane
  |
  | persists srun_* + dispatch state
  v
qagent-suite-run-orchestration Queue
  |
  | bounded cursor windows
  v
Suite Orchestrator (Gateway consumer)
  |
  | exact immutable suitev_* slices
  v
Test Registry
  |
  | test_suite_version_items
  v
Suite Orchestrator
  |
  | create existing run_* children
  +--> run_* A --> qagent-run-requests --> Runner --> Results
  +--> run_* B --> qagent-run-requests --> Runner --> Results
  +--> run_* C --> qagent-run-requests --> Runner --> Results
  +--> run_* D --> qagent-run-requests --> Runner --> Results
  |
  v
srun_* aggregate lifecycle
```

No new Runner execution path is introduced.

## 4. Contracts

### 4.1 Console create

`POST /v1/console/projects/{projectId}/suite-runs`

Header:

```text
Idempotency-Key: <required>
```

Body:

```json
{
  "contractVersion": "qagent.suite-run-create.v1",
  "suiteVersionId": "suitev_*",
  "environmentId": "env_*",
  "confirmDiscoveredRuntime": true
}
```

The exact `suitev_*` and Environment are pinned for the whole Suite Run.

### 4.2 Console read

`GET /v1/console/projects/{projectId}/suite-runs/{suiteRunId}`

Returns `qagent.suite-run.v1` with:
- Suite Run lifecycle;
- orchestration cursor/status;
- child materialization/progress counters;
- bounded child preview;
- exact Suite Version and Environment references.

### 4.3 Internal Registry slice

`GET /v1/test-registry/projects/{projectId}/suite-versions/{suiteVersionId}/execution-slice?offset=N&limit=N`

Contract: `qagent.suite-execution-slice.v1`.

The orchestrator never resolves `latest`. It reads the pinned immutable Suite Version in bounded slices.

### 4.4 Queue message

Contract: `qagent.suite-run-requested.v1`.

The Queue carries references only:
- `suiteRunId`;
- `organizationId`;
- `projectId`;
- `expectedCursor`.

It does not carry Test Designs, request bodies, runtime data or secrets.

## 5. Persistence

### Test Registry migration `0004`

Adds `test_suite_version_items`:
- immutable normalized Suite execution rows;
- one row per endpoint/Test Design selection;
- exact `tdv_*`;
- scenario IDs for that child Run;
- ordered by immutable ordinal;
- project/tenant indexes.

New Suite materialization warms this projection at write time. Suite versions created before 07.7.10-B are normalized lazily once, preserving backward compatibility.

### Gateway migration `0015`

Adds:

` suite_runs `
- one durable `srun_*` root;
- pinned `suitev_*` and Environment;
- request fingerprint and idempotency key;
- aggregate lifecycle/timestamps.

` suite_run_dispatches `
- queue publication state;
- cursor;
- orchestration attempts/errors;
- completion state.

` suite_run_children `
- one deterministic child identity per Suite ordinal;
- exact endpoint and `tdv_*` references;
- resulting `run_*` reference;
- child creation state.

The Gateway does **not** duplicate scenario arrays into its Suite Run tables. The immutable selection remains owned by Test Registry.

## 6. Idempotency and retry safety

### Suite Run create

Unique scope:

```text
organizationId + projectId + Idempotency-Key
```

Same key + same request fingerprint returns the existing `srun_*`.
Same key + different input fails closed with conflict.

### Child Runs

Each child uses the deterministic Idempotency-Key:

```text
suite:{suiteRunId}:{ordinal}
```

If a Queue delivery is repeated after some children were already created, the existing Run create contract returns the same `run_*` instead of duplicating execution.

### Cursor

Each orchestration message contains `expectedCursor`.
A stale/duplicated continuation is ignored when the persisted cursor no longer matches.

### Publish recovery

If initial Suite queue publication fails:
- dispatch records the failure;
- the same POST/Idempotency-Key can safely republish;
- terminal Suite Runs are never republished.

### Permanent orchestration errors

Non-retryable orchestration failures mark:
- `suite_run_dispatches.status = FAILED`;
- `suite_runs.status = ERROR`;
- `terminal_at`.

Retryable failures retain the Suite Run and record the latest safe error code before Queue retry.

## 7. Bounded fan-out and multi-tenant performance

Default configuration:

```text
SUITE_ORCHESTRATOR_CHILD_BATCH_SIZE = 4
SUITE_ORCHESTRATOR_CHILD_CONCURRENCY = 3
```

Hard code limits:

```text
batch size <= 10
child create concurrency <= 5
Registry execution slice <= 25
```

The dedicated Queue uses small messages and cursor continuation. A Suite containing hundreds of endpoints does not create hundreds of child Runs in one request and does not require the browser to stay open.

This also provides natural multi-tenant interleaving: large Suite Runs publish short continuation work instead of monopolizing one synchronous execution loop.

The orchestrator reads normalized immutable Suite rows instead of reparsing Test Design specifications or transferring the whole Suite selection on every batch.

## 8. Tenant isolation

Every persisted Suite Run row carries organization/project scope.
Every Registry execution slice requires the same organization/project internal scope.
Queue messages repeat scope and the orchestrator verifies it against the persisted `srun_*` before doing work.
Console routes authorize tenant/project membership before create/read.

A `suiteRunId` alone is not sufficient to cross tenant boundaries through Console APIs.

## 9. Aggregate status semantics

Suite Run lifecycle:

```text
CREATED -> QUEUED -> DISPATCHING -> RUNNING -> terminal
```

Terminal precedence after all children are terminal:

```text
child CREATE_ERROR / ERROR / CANCELLED -> Suite ERROR
otherwise any child FAILED             -> Suite FAILED
otherwise all children PASSED          -> Suite PASSED
```

Suite terminal aggregation is refreshed when child Runs report terminal completion and on Suite Run reads.

## 10. Console behavior

The action is enabled only when:
- Auto Suite snapshot is `CURRENT`;
- execution-eligible scenario count > 0;
- a specific Environment is selected;
- no Suite Run is already active from the page.

The Console:
1. creates one `srun_*`;
2. polls `GET /suite-runs/{srun_*}` approximately every 2 seconds;
3. shows aggregate endpoint progress;
4. refreshes Results/metrics after terminal state;
5. stores the active `srun_*` locally so a browser refresh can resume polling while the server-side orchestration continues independently.

`Todos os ambientes` remains a dashboard filter and is not a valid execution target.

## 11. Security invariants

07.7.10-B preserves:
- no Vault material in Suite storage;
- no credentials in Suite Queue messages;
- no raw request/response body in Suite storage;
- no Test Design payload in orchestration Queue;
- auth resolution stays JIT in Runner;
- Test Data stays runtime materialization;
- exact immutable Test Design Versions are pinned by the Suite;
- business mutation methods remain policy-held.

## 12. Production gate

Expected current validation example after 07.7.10-A FIX-1:

```text
suitev_2
4 executable endpoints
21 executable scenarios
3 business mutation scenarios held
```

The production gate is:
1. choose a concrete Environment;
2. click **Executar todos os cenários executáveis**;
3. observe `srun_*` go `QUEUED -> DISPATCHING -> RUNNING`;
4. verify one normal `run_*` per Suite item;
5. verify Runner executes the child Runs through existing flow;
6. verify Result Sets are persisted;
7. verify parent becomes `PASSED`, `FAILED` or `ERROR` according to children;
8. verify browser refresh during execution resumes progress and does not stop server work;
9. repeat the create request with the same Idempotency-Key and confirm no duplicated Suite/child Runs.

## 13. Next architectural step

07.7.10-C should focus on **Suite Run history + aggregated regression Results UX** (trend/history/drill-down by Suite Run), before enabling business mutations.

A later mutation Foundation must introduce the durable mutation/side-effect journal before `POST/PUT/PATCH/DELETE` can join zero-config regression execution.

# QAgent Foundation 07.7.8-C2-D — Observed Runtime Resolution

Date: 2026-08-31
Status: IMPLEMENTED / LOCAL REGRESSION PASSED / PRODUCTION VALIDATION PENDING

## Goal

Resolve `OBSERVED` Test Data bindings at Run creation without creating a second execution path and without changing Queue, Runner lifecycle, Suite fan-out, Mutation Journal, HTTP, Assertions or Results.

The Test Design remains declarative and immutable:

```text
source = OBSERVED
```

At Run creation the Gateway resolves safe observed material for the selected Environment and freezes it in the immutable Runtime Snapshot. The Execution Plan maps only the runtime execution source to the Runner's already-existing `FIXED` path.

```text
Test Design OBSERVED policy
        ↓
createRunV1 (shared by endpoint Run and Suite child Run)
        ↓
Catalog Observed Reservoir
Environment exact + HTTP_2XX
        ↓
correlated request sample preferred
        ↓
Runtime Snapshot
safe non-secret value frozen
+ provenance metadata
        ↓
Execution Plan
OBSERVED -> FIXED execution adapter
(no literal in plan)
        ↓
existing qagent-run-requests message
(refs only)
        ↓
existing Runner FIXED materialization
        ↓
Auth / Mutation Journal / HTTP / Assertions / Results
```

## Architecture preserved

No parallel C2-D flow exists for Suite execution.

`qagent-suite-run-orchestration` continues to fan out child Runs through the same `createRunV1` used by direct endpoint execution. Therefore both product entry points receive Observed Runtime Resolution automatically at the common Run materialization boundary.

Unchanged:

- Suite orchestration and aggregation;
- `qagent-run-requests` contract;
- Queue payload (immutable refs only);
- Runner claim / lease / retry;
- Runner Test Data validators;
- Auth Runtime;
- Mutation Policy and Durable Mutation Journal;
- HTTP Executor;
- Assertion Engine;
- Results ingestion;
- DLQ ownership and terminal recovery.

## Runtime selection policy

For every selected Run Environment:

1. Resolve only `BODY` selectors already planned as `source=OBSERVED`.
2. Revalidate selector against Test Data secret policy.
3. Query only the selected `environmentId`.
4. Query only `outcomeClass=HTTP_2XX`.
5. Prefer a correlated successful request sample containing all OBSERVED bindings needed by a scenario.
6. Preserve the same frozen value for a shared binding key across scenarios in the same Run.
7. A single unresolved OBSERVED binding may use scalar fallback.
8. Multiple OBSERVED bindings without a compatible correlated sample fail closed.

Error codes:

```text
RUN_OBSERVED_TEST_DATA_BINDING_INVALID
RUN_OBSERVED_TEST_DATA_BINDING_CONFLICT
RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING
RUN_OBSERVED_TEST_DATA_UNAVAILABLE
```

## Security boundary

Allowed runtime literals are safe, non-secret observed Test Data only.

The observed literal does not enter:

- AI prompt;
- Test Design;
- Test Registry;
- Queue message;
- Execution Plan;
- public Run response;
- provenance metadata;
- logs;
- Results Plane.

The safe literal is frozen only in the internal immutable Runtime Snapshot, reusing the same boundary already used by non-secret `FIXED` Test Data.

Provenance may contain only safe metadata:

```text
source=OBSERVED
resolutionMode=CORRELATED_SAMPLE | SCALAR_FALLBACK
environmentId
sampleFingerprint | valueFingerprint
encoding
observationCount
successCount
lastSeenAt
```

Sensitive selectors and redaction/truncation markers fail closed.

## Contracts / versions

```text
Planner                  qagent.test-data-planner.v1.2.2
Planner strategy         HYBRID
Observed runtime         qagent.observed-test-data-runtime-resolution.v1
Runtime Test Data        qagent.runtime-test-data-snapshot.v1
Queue                    qagent.run-requested.v1 (UNCHANGED)
```

C2-D enables `observedRuntimeEnabled=true` in production Test Design generation. Therefore an OBSERVED binding no longer remains `runtime pending` merely because runtime support did not exist.

Other blockers remain authoritative: Auth, semantic review, mutation intent, policy, unresolved mutation, etc.

## Runner compatibility adapter

Runner code is intentionally unchanged.

The immutable Test Design remains:

```json
{"source":"OBSERVED","bindingKey":"BODY:$.leaveTypeId"}
```

After Run creation, the Execution Plan contains:

```json
{"source":"FIXED","bindingKey":"BODY:$.leaveTypeId"}
```

and the corresponding safe literal is present only in:

```text
Runtime Snapshot.testData.fixed[bindingKey]
```

This allows the existing Runner `FIXED` validator/materializer to execute C2-D without a new Runner source type, new queue contract or new messaging topology.

## Diagnostics

Test Design Planner:

```text
observedRuntimeEnabled = true
observedCount > 0
observedRuntimePendingCount = 0
```

Safe Run response:

```text
runtime.testData.observedResolutionContractVersion
runtime.testData.observedResolvedCount
runtime.testData.observedCorrelatedSampleBindingCount
runtime.testData.observedScalarFallbackBindingCount
```

`run_created` adds only:

```text
observedTestDataResolvedCount
```

No literal is logged.

## Local validation

Passed:

```text
npm run test:f07-7-8-c2-d                    PASS
npm run check:07.7.8-c2-d                    PASS
npm run test:all                             PASS
```

The C2-D gate additionally runs through the later working architecture:

```text
Suite Orchestration                          PASS
Mutation Safety                              PASS
Controlled Mutation HTTP                     PASS
Terminal / DLQ Recovery                      PASS
Router regression                            PASS
```

## No migration / no other service change

C2-D source deployment is Gateway-only.

No changes required in:

```text
qagent-runner
qagent-catalog
qagent-normalizer
qagent-test-registry
qagent-test-results
qagent-console
```

No D1 migration.

Catalog C2-B must already be deployed because Gateway runtime resolution consumes its existing HMAC-protected Observed Reservoir query API.

## Production gate

### 1. Deploy Gateway

```bash
npm ci
npm run check:07.7.8-c2-d
npm run test:all
npm run deploy
```

No migration command.

### 2. Regenerate a Test Design with safe reusable observed references

Preferred first gate: an endpoint where the observed values are genuinely reusable references, for example the OrangeHRM Leave Request with observed `leaveTypeId` and `duration.type`.

Expected generation diagnostics:

```text
plannerVersion = qagent.test-data-planner.v1.2.2
strategy = HYBRID
observedRuntimeEnabled = true
observedCount > 0
observedRuntimePendingCount = 0
```

Do not use a uniqueness-sensitive create identifier as the first network gate merely to prove C2-D. Example: an observed `employeeId` may be correct for a DUPLICATE_REFERENCE scenario but not necessarily reusable for a create happy path. That semantic refinement belongs to scenario consistency/planning, not to runtime resolution.

### 3. Configure remaining Auth blocker

After Auth becomes resolvable, regenerate or otherwise use a Test Design version whose target scenario is semantically READY.

### 4. Direct endpoint Run

Create the Run using the existing API.

Expected safe response:

```text
runtime.testData.observedResolvedCount > 0
runtime.testData.observedCorrelatedSampleBindingCount > 0
```

For one standalone observed selector, scalar fallback may be non-zero instead.

No literal should appear in the public Run response.

### 5. Runner

No new Runner deployment is required by C2-D.

Existing Runner flow should remain:

```text
Claim
→ Runtime
→ Mutation Preflight (when applicable)
→ Test Data Runtime (resolved OBSERVED arrives via existing FIXED path)
→ Auth
→ Mutation Journal / HTTP
→ Assertions
→ Results
```

Existing `run_test_data_runtime_summary` may count runtime-resolved OBSERVED values physically under `fixedCount`; the immutable Test Design and Runtime Snapshot provenance preserve that their semantic origin is OBSERVED.

### 6. Suite Run

Execute the existing Suite through the current Suite API.

Each child Run is created through `createRunV1`, so no Suite-specific C2-D path is expected.

Validate:

```text
suite fan-out unchanged
child Runs resolve observed data for the selected Environment
queue behavior unchanged
child terminal states reconcile normally
suite aggregate completes normally
```

## Deferred

Not part of C2-D:

- observed PATH_PARAM / QUERY capture and resolution;
- precondition/data orchestration that calls setup endpoints before a scenario;
- mutation generator DSL;
- final Scenario Semantic Consistency (FIX-3.4);
- changing the Runner's public Test Data source enum to OBSERVED.

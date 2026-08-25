# QAgent Foundation 07.7.10-A FIX-1 — Suite Execution Eligibility + Hot-Path Inventory Projection

**Status:** IMPLEMENTED / LOCAL VALIDATION COMPLETE / PRODUCTION GATE PENDING  
**Parent:** 07.7.10-A — Suite Definition Foundation + Zero-Config Project Test Inventory  
**Next:** 07.7.10-B — Suite Run Contract + Durable Orchestration

## 1. Why this FIX exists

Foundation 07.7.10-A originally interpreted every Test Design scenario with `automation.readiness=READY` as a candidate for the automatic regression Suite.

That is not sufficient. `READY` means the Test Design has enough semantic/runtime data to automate, but the current Runner intentionally rejects side-effect HTTP methods while there is no durable mutation journal.

Therefore:

```text
READY != EXECUTION_ELIGIBLE
```

The production Automation Center exposed this difference when a `PUT` endpoint appeared inside the READY inventory even though the Runner would reject it with `RUNNER_HTTP_SIDE_EFFECT_METHOD_DISABLED`.

This FIX also addresses scale. The original inventory implementation loaded and parsed every latest `specification_json` on each dashboard refresh. That is acceptable for a small project, but wasteful for many tenants/projects and large Test Design histories.

## 2. Frozen execution eligibility policy v1

Contract:

```text
qagent.suite-execution-eligibility.v1
```

Suite selection policy:

```text
LATEST_TEST_DESIGNS_EXECUTION_ELIGIBLE_SCENARIOS
qagent.suite-selection-policy.v1.1
```

Current method rules:

| Method | Test Design READY | Auto Suite Eligible | Reason when held |
|---|---:|---:|---|
| GET | yes | yes | — |
| HEAD | yes | yes | — |
| OPTIONS | yes | yes | — |
| POST | yes | no | MUTATION_EXECUTION_DISABLED |
| PUT | yes | no | MUTATION_EXECUTION_DISABLED |
| PATCH | yes | no | MUTATION_EXECUTION_DISABLED |
| DELETE | yes | no | MUTATION_EXECUTION_DISABLED |
| unsupported/unknown | yes | no | HTTP_METHOD_UNSUPPORTED / HTTP_METHOD_UNRESOLVED |

The Registry is deliberately stricter than a runtime flag. Auto Suite policy does not start executing mutations merely because someone toggles a Runner environment variable. Mutation eligibility will require a future policy version after the durable side-effect execution journal is implemented.

## 3. Inventory semantics

The Project Test Inventory keeps semantic readiness metrics and adds execution-policy metrics:

```text
readyScenarioCount
endpointWithReadyCount

executionEligibleScenarioCount
endpointWithExecutionEligibleCount
policyBlockedReadyScenarioCount
policyBlockedReasonCounts
```

Example:

```text
READY Scenarios:       24
Executable Now:        19
Policy Hold:            5
  MUTATION_DISABLED:    5
```

The automatic Suite snapshot freezes only `executionEligibleScenarioIds`.

## 4. Performance architecture

### 4.1 Immutable write-time projection

New D1 table:

```text
test_design_execution_inventory
```

Migration:

```text
0003_foundation_07_7_10_a_fix_1_execution_inventory_projection.sql
```

Every newly persisted immutable Test Design Version writes a compact execution projection in the same D1 batch as the version/root pointer update.

Projection contains only non-secret execution metadata:

```text
testDesignVersionId
testDesignId
organizationId
projectId
endpointId
version
method/path/apiServiceKey
scenario counters
READY IDs
execution-eligible IDs
policy-held READY IDs
policy reason counters
eligibility policy version
```

It does not duplicate request bodies, response bodies, auth values, generated/fixed runtime data, secrets, Vault material, or the full Test Specification.

### 4.2 Historical lazy backfill

Existing Test Design Versions created before migration 0003 are not rewritten.

When a project inventory is first requested after migration:

1. Registry identifies only latest Test Design Versions missing a projection.
2. It reads/parses those specifications once.
3. It writes immutable projection rows in bounded batches of 50.
4. Subsequent reads use the compact projection only.

This avoids a giant migration-time JSON backfill across historical versions and spreads legacy conversion safely over actual project access.

### 4.3 No N+1 reads

Steady-state inventory uses one D1 project query regardless of endpoint count.

There is no:

```text
for endpoint -> D1 query
for scenario -> service call
```

A regression test enforces this boundary.

The latest Auto Suite summary also uses one joined D1 query instead of root + version round trips.

### 4.4 Compact Console view

Gateway requests:

```text
?view=compact
```

for Project Inventory, materialization response and latest Suite summary.

Compact mode does not transfer full Suite selections or auxiliary scenario-id arrays to the browser. The Console only receives what it needs to render readiness. Full pinned selection remains in Test Registry for the future orchestrator.

### 4.5 Console request de-duplication

Automation page cold load keeps independent reads parallel.

After bootstrap, changes to:

```text
period
environment
outcome filter
```

refresh only Execution Results summary/list. They no longer re-fetch Test Registry inventory and latest Suite because those values do not depend on execution-history filters.

Request sequence guards prevent stale concurrent responses from overwriting newer UI state.

## 5. Suite version upgrade behavior

Existing production Suite v1 remains immutable.

Because the policy version participates in the inventory fingerprint, after FIX-1 an existing v1 snapshot becomes:

```text
OUTDATED
```

When the user clicks **Preparar regressão automática**, Registry creates:

```text
suitev_2
```

using selection policy v1.1 and only execution-eligible scenarios.

No old Suite version is mutated.

## 6. Security / governance invariants

- READY scenarios are never rewritten because of Suite policy.
- Mutation scenarios remain visible and auditable.
- Policy-held scenarios are excluded from zero-config mass execution.
- No secret/runtime value enters the projection or Suite definition.
- Tenant/project filtering remains mandatory on every Registry read.
- Browser never calls Test Registry directly.
- Runner remains final fail-closed authority even after pre-selection.

## 7. UI behavior

Regression Readiness shows:

```text
Catalog Endpoints
Test Designs
READY Endpoints
READY Scenarios
Executable Now
Policy Hold
```

Executable Inventory lists only endpoints with at least one scenario eligible now.

Execution Policy Hold explains READY scenarios intentionally withheld, including mutation counts.

The future button text is:

```text
Executar todos os cenários executáveis
```

not “todos os READY”.

## 8. Production deployment order

1. **qagent-test-registry**
   - deploy migration 0003 first;
   - deploy Worker FIX-1;
   - validate health `foundation=07.7.10-A-FIX-1`.
2. **qagent-gateway**
   - deploy compact Registry bridge validation.
3. **qagent-console**
   - `npm ci`;
   - `npm run check:07.7.10-a-fix-1`;
   - `npm run build`;
   - deploy.

Migrations 0001 and 0002 are immutable and unchanged.

## 9. Production gate

After deployment:

1. Open Automation Center.
2. Confirm READY count remains semantic count.
3. Confirm `PUT/POST/PATCH/DELETE` READY scenarios move to Policy Hold.
4. Confirm Executable Now contains only safe methods under policy v1.
5. Existing Suite v1 should display OUTDATED.
6. Click Prepare Regression.
7. Confirm a new Suite version is created (normally v2 for projects already materialized under 07.7.10-A).
8. Confirm new Suite scenario count equals `executionEligibleScenarioCount`.
9. Refresh repeatedly and verify no errors/lazy backfill repeats.

## 10. Scale boundary

This FIX intentionally optimizes the current hot path without introducing a new cache or analytics service prematurely.

If telemetry later shows projects with inventory sizes where even one compact project scan becomes material, the next optimization is a per-project aggregate/materialized inventory-state row updated transactionally on Test Design version changes. That is not required yet and should be driven by measured D1/Worker utilization.

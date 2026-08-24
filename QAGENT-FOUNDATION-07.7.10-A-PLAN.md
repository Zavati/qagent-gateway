# QAgent Foundation 07.7.10-A — Suite Definition Foundation + Zero-Config Project Test Inventory

Status: IMPLEMENTED / LOCAL VALIDATION PASSED / PRODUCTION VALIDATION PENDING

## 1. Product objective

Turn the data already discovered, curated and automated by QAgent into a project-level executable regression inventory without asking QA to manually rebuild the application map.

The product path is:

```text
Real application traffic
  -> API Catalog
  -> AI Test Design
  -> immutable Test Registry
  -> Runtime/Auth/Test Data readiness
  -> Project Test Inventory
  -> immutable Suite snapshot
  -> Suite Orchestrator (next foundation)
  -> Runner
  -> Results Plane
  -> Automation dashboards
```

The strategic UX target is eventually one action:

> Executar todos os cenários READY

Foundation 07.7.10-A creates the immutable definition and zero-config inventory required for that action. It does not fake fan-out execution in the browser. Durable Suite execution belongs to the next orchestration foundation.

## 2. Architectural boundary

Suite definition belongs to `qagent-test-registry` because a Suite answers **what must be executed**. It does not belong to Gateway, Runner or Results Plane.

```text
Test Registry
  test_designs / test_design_versions
  test_suites / test_suite_versions

Gateway
  authorization + BFF + future Suite Run control

Runner
  executes pinned artifacts

Results Plane
  stores what happened
```

No new service is introduced.

## 3. Immutable Suite model

A project has a stable zero-config automatic Suite root:

```text
suite_<sha256(organizationId, projectId, AUTO_PROJECT_READY)>
```

Each materialization freezes a new immutable version only when the executable inventory changed:

```text
suite_*
  suitev_1
  suitev_2
  ...
```

A Suite Version stores only execution references:

```text
endpointId
testDesignId
testDesignVersionId
testDesignVersion
scenarioIds[]
```

It never stores request bodies, response bodies, generated values, fixed runtime values, Authorization, cookies, passwords, tokens, API keys, client secrets or Vault material.

## 4. Zero-config Project Test Inventory

The inventory is calculated from the **latest immutable Test Design version for every active endpoint that has a Test Design**.

Only scenarios with:

```text
automation.readiness == READY
```

are executable candidates.

The inventory exposes safe project-level counters:

```text
testDesignCount
endpointWithReadyCount
scenarioCount
readyScenarioCount
reviewRequiredScenarioCount
needsDataScenarioCount
needsAuthScenarioCount
blockedScenarioCount
```

and a safe executable selection of pinned `tdv_* + scenarioIds`.

The API Catalog remains the authority for total discovered endpoint count. The Console can combine Catalog + Registry metrics to show coverage.

## 5. Fingerprint and staleness

The Registry computes a deterministic inventory fingerprint from the ordered executable selection:

```text
[
  endpointId,
  testDesignVersionId,
  READY scenarioIds
]
```

If the latest Suite Version fingerprint equals the current inventory fingerprint, materialization returns the existing `suitev_*` and does not create a duplicate version.

If a Test Design is regenerated or READY selection changes, the fingerprint changes and a new immutable `suitev_*` is created.

Old Suite Versions continue referencing the exact historical Test Design Versions.

## 6. Contracts

Registry internal routes:

```text
GET  /v1/test-registry/projects/:projectId/test-inventory
POST /v1/test-registry/projects/:projectId/suites/auto-ready/materialize
GET  /v1/test-registry/projects/:projectId/suites/auto-ready/latest
```

Gateway Console BFF routes:

```text
GET  /v1/console/projects/:projectId/automation/test-inventory
POST /v1/console/projects/:projectId/automation/suites/auto-ready/materialize
GET  /v1/console/projects/:projectId/automation/suites/auto-ready/latest
```

Contracts:

```text
qagent.project-test-inventory.v1
qagent.test-suite.v1
qagent.test-suite-version.v1
qagent.suite-selection-policy.v1
```

Browser never calls Test Registry directly.

## 7. Database migration

Existing `0001_test_registry_foundation.sql` is immutable and remains byte-identical.

New migration:

```text
0002_foundation_07_7_10_a_suite_definition.sql
```

Tables:

```text
test_suites
test_suite_versions
```

The schema already reserves `USER_DEFINED` Suite type/source for future manual Suites, but 07.7.10-A exposes only the zero-config automatic project Suite.

## 8. Console UX

Automation Center gains a **Regression Readiness** section above historical execution metrics.

It shows:

```text
Catalog Endpoints
Test Designs
READY Endpoints
READY Scenarios
Blocked Scenarios
```

It also shows the executable endpoint inventory and the latest Auto Suite snapshot, including whether the snapshot is CURRENT or OUTDATED compared with the current inventory fingerprint.

07.7.10-A exposes **Preparar regressão automática** to materialize/freeze the snapshot.

The target CTA **Executar todos os cenários READY** is visible but remains disabled until the Suite Orchestrator exists. The browser must never implement fan-out by looping over `POST /runs` itself.

## 9. Next foundation

07.7.10-B should implement the Suite Run Contract + durable orchestration boundary:

```text
POST suite run
  -> pin suiteVersionId
  -> create suiteRun_*
  -> create/dispatch child run_* records
  -> aggregate lifecycle
  -> preserve retries/idempotency
```

Only then does **Executar todos os cenários READY** become an actual execution action.

## 10. Production validation gate

1. Apply Test Registry migration `0002` remotely.
2. Deploy `qagent-test-registry`.
3. Deploy Gateway.
4. Deploy Console after `npm run build` passes.
5. Open Automation Center and verify Project Test Inventory counters.
6. Materialize automatic regression.
7. Confirm `suite_*` and `suitev_1` are persisted.
8. Materialize again without Test Design changes; confirm same `suitev_1` is returned.
9. Regenerate a Test Design so READY selection changes; materialize again and confirm `suitev_2` is created while `suitev_1` remains unchanged.
10. Verify no runtime secret/request body material exists in `test_suite_versions.selection_json`.

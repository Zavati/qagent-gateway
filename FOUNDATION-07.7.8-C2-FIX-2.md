# QAgent Foundation 07.7.8-C2 FIX-2 — Observed-First Test Data Resolution

## Objective

Make successful observed request data the zero-config default for safe Test Data fields, while preserving explicit QA configuration, secret safety, scenario intent and the existing Runner contract.

## Ownership

- Gateway: changed.
- Test Registry: unchanged. It remains the immutable Test Design store.
- Runner: unchanged. OBSERVED continues to be frozen by Gateway runtime resolution into the existing FIXED materialization path.
- Catalog: unchanged. Existing Observed Reservoir APIs remain the source of evidence.
- Console: unchanged. Existing explicit Test Data configuration remains the override mechanism.

## Resolution precedence

1. Sensitive selector -> SECRET.
2. Explicit QA binding -> configured FIXED / GENERATED / SECRET.
3. Safe selector with successful OBSERVED evidence -> OBSERVED.
4. No usable observed evidence -> existing GENERATED / FIXED fallback.

Intent-aware negative/boundary behavior remains fail-closed and is not replaced with a valid observed baseline when the scenario is intentionally testing invalid/omitted data.

## Implementation

Planner version: `qagent.test-data-planner.v1.3.0`.

Changes in `src/intelligence/testDataPlanner.js`:

- `classifySource()` now selects OBSERVED for every safe selector with positive observed evidence after security and explicit overrides are evaluated.
- Successful correlated BODY samples are treated as positive evidence even when scalar metadata is absent.
- `baselineObservedSelectors()` selects a sample that actually contains the target being planned, avoiding BODY/QUERY sample-order bias.
- diagnostics expose `defaultResolutionPolicy: OBSERVED_FIRST`.

No observed literal is persisted in Test Design. The binding remains structural/provenance-only and runtime resolution retrieves/finalizes the value for the selected Environment.

## Compatibility

Existing immutable Test Design versions are not rewritten. A Test Design that already contains `source: GENERATED` continues behaving exactly as persisted. After this deployment, regenerate the Test Design to create a new immutable version using the Observed-First policy.

Explicit QA `GENERATED` remains authoritative and therefore enables intentional random/fuzz data per selector.

## Acceptance reproduction

For `/web/index.php/api/v2/leave/employees/leave-requests`, with successful observed data available:

- `QUERY includeEmployees` -> OBSERVED
- `QUERY limit` -> OBSERVED
- `QUERY offset` -> OBSERVED

If the QA configures only `includeEmployees` as GENERATED:

- `includeEmployees` -> GENERATED
- `limit` -> OBSERVED
- `offset` -> OBSERVED

If no successful observed material exists, current generator fallback is preserved.

## Validation

Passed:

- dedicated FIX-2 observed-first test;
- C2-C Hybrid Planner regression;
- C2-C FIX-1 Intent-Aware regression;
- C2-D Observed Runtime Resolution regression;
- C2-F PATH planning / execution-plan / runtime regressions;
- Gateway quick unit suite;
- 07.8-A Test Evolution route regression;
- Gateway router regression;
- Test Registry complete suite: 45/45 PASS, unchanged.

No migration is required.

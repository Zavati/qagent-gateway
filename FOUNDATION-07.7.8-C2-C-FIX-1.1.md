# Foundation 07.7.8-C2-C FIX-1.1 — Pre-Planning Intent Detection

## Goal

Close the production gap found after C2-C FIX-1: scenario intent must be detected before planner eligibility/candidate construction, including when Semantic Guard leaves `needsData=false` and the AI returns `request.body={}`.

## Scope

Gateway only. No migration. No Runner, Registry, Catalog, Normalizer, Console or Results changes.

## Planner revision

`qagent.test-data-planner.v1.2.2`

## Behavior

- Intent is evaluated for NEGATIVE, BOUNDARY, DATA_VARIATION and REGRESSION_CANDIDATE scenarios before body planning.
- The intent selector universe is built from safe metadata only: existing request leaves, request schema required selectors, observed successful baseline selectors and observed-value selector metadata.
- A detected intent target is seeded into planner candidates even if `body={}` and `needsData=false`.
- `INVALID_VALUE` / `INVALID_REFERENCE`: do not reuse successful OBSERVED values or normal valid generators for the target. Fail closed to REVIEW_REQUIRED/NEEDS_DATA until an explicit mutation strategy exists.
- `DUPLICATE_REFERENCE` / `DUPLICATE_VALUE`: prefer a successful OBSERVED value when environment coverage is complete; this represents a value that has already existed. If unavailable, fail closed.
- `OMIT`: omission is already executable; do not auto-fill the omitted target.
- Generic required-field omission is represented as `BODY:$:OMIT_REQUIRED_FIELDS` and does not auto-fill a valid baseline.
- Explicit QA bindings remain authoritative.
- AUTHORIZATION scenarios are not interpreted as body mutations; their valid body baseline remains available while auth is removed.
- Sensitive selectors remain governed by Secret-Safe policy and cannot be overridden by duplicate intent.

## Diagnostics additions

- `intentDuplicateObservedReuseCount`
- `intentOmissionSatisfiedCount`
- existing intent diagnostics remain: `intentAwareScenarioCount`, `intentTargetCount`, `intentBlockedAutoBindingCount`, `intentBlockedObservedCount`, `intentBlockedGeneratedCount`, `intentTargets`.

## Production acceptance target

For POST `/pim/employees`:

- `create_employee_invalid_employeeId` -> `BODY:$.employeeId:INVALID_VALUE`, no valid OBSERVED/GENERATED binding, REVIEW/NEEDS_DATA.
- `create_employee_duplicate_employeeId` -> `BODY:$.employeeId:DUPLICATE_REFERENCE`, OBSERVED allowed when successful reservoir coverage exists, runtime pending until C2-D.
- `create_employee_invalid_firstName` -> `BODY:$.firstName:INVALID_VALUE`, normal FIRST_NAME generator blocked.
- `create_employee_missing_fields` -> `BODY:$:OMIT_REQUIRED_FIELDS`, body stays empty and no valid baseline is auto-filled.
- happy/schema/status positive scenarios remain unchanged.

## Validation

- focused C2-C tests: PASS
- intent-aware tests including production reproductions: PASS
- 07.7.9-C baseline regression guard: PASS
- router tests: PASS
- `npm run test:all`: PASS through Foundation 07.7.10-A FIX-1.

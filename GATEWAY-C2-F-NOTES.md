# QAgent 07.7.8-C2-F — Gateway

## Observed Path Parameter Resolution

This patch extends the current Zero-Config Test Data flow. It does not create a second planner, resolver, runtime, API, queue or Runner path.

### Production files changed

- `src/intelligence/observedTestDataPlanningContext.js`
- `src/intelligence/catalogContextBuilder.js` (`v1.10`)
- `src/intelligence/testDataPlanner.js`
- `src/services/observedTestDataRuntimeResolver.js`
- `src/services/executionPlanMaterializerService.js`

### Unchanged

- `qagent.test-data-bindings.v1`
- Test Design public shape
- Catalog Query client/routes
- Auth Runtime
- Queue/Claim/Lease
- Runner
- HTTP Executor
- Results Plane

## Data path

Observed Catalog sample:

```text
/companies/10/employees/25
/companies/{id}/employees/{id}

PATH_PARAM id @ segmentIndex=1 occurrence=0 = 10
PATH_PARAM id @ segmentIndex=3 occurrence=1 = 25
```

Planning context preserves both positional selectors.

Planner creates:

```text
PATH_PARAM:id@1:0
PATH_PARAM:id@3:1
```

Both bindings remain:

```text
target = PATH_PARAM
selector = id
source = OBSERVED
```

The position is carried only in the existing `bindingKey`.

## Correlation

PATH_PARAM is sample-only.

The runtime resolver must resolve the complete successful request sample. It never asks the scalar Reservoir for PATH_PARAM.

Therefore:

```text
sample A = company 10 / employee 25
sample B = company 20 / employee 75
```

cannot become:

```text
company 10 / employee 75
```

## Runner compatibility

Runner currently materializes PATH_PARAM by selector name and its HTTP path resolver replaces named `{selector}` placeholders.

That existing behavior cannot distinguish two placeholders with the same name.

C2-F solves this in the existing Gateway Execution Plan Materializer.

Test Design remains canonical:

```text
/companies/{id}/employees/{id}
```

For a single placeholder, the Execution Plan stays canonical:

```text
/web/index.php/api/v2/pim/employees/{id}
```

The positional identity remains only in `bindingKey=PATH_PARAM:id@6:0`.

Runtime aliases are emitted **only when the same selector appears more than once**:

```text
/companies/{__qagent_path_1_0}/employees/{__qagent_path_3_1}
```

and converts the OBSERVED bindings to existing FIXED bindings:

```text
bindingKey = PATH_PARAM:id@1:0
selector   = __qagent_path_1_0

bindingKey = PATH_PARAM:id@3:1
selector   = __qagent_path_3_1
```

Runtime Snapshot FIXED material uses the same runtime selector.

No observed literal is placed in the Execution Plan path. The Runner receives ordinary unique named PATH_PARAMs and remains unchanged.

## Explicit Test Data backward compatibility

Explicit FIXED/SECRET PATH_PARAM bindings keep historical selector-by-name behavior.

C2-F positional keys are used only for automatically selected OBSERVED PATH_PARAM bindings.

Automatic observed PATH reuse is restricted to success-oriented scenarios with an expected 2xx status. Negative/not-found scenarios keep the existing fail-closed behavior and are not silently converted to a known-valid observed ID.

This avoids changing existing configured Test Data behavior.

## Context fingerprint

`catalogContextBuilder.js` now includes:

- target
- segmentIndex
- occurrence

for sample selectors in the observed-planning fingerprint view.

This prevents positional path knowledge changes from being invisible to Test Design context staleness/fingerprinting.

## Expected OrangeHRM Test Design

For:

```text
GET /web/index.php/api/v2/pim/employees/{id}
```

after a successful observed sample exists, a positive scenario should contain:

```json
{
  "target": "PATH_PARAM",
  "selector": "id",
  "source": "OBSERVED",
  "valueType": "STRING",
  "bindingKey": "PATH_PARAM:id@6:0"
}
```

and the scenario should become READY when no unrelated blocker remains.

## Production gate

1. Apply patch to current Gateway.
2. `git diff --check`
3. `npm run check`
4. Run full Gateway regression if it is a separate command.
5. Deploy Gateway.
6. Generate a NEW Test Design for OrangeHRM employee detail.
7. Verify PATH binding is `OBSERVED`, not `FIXED/NEEDS_DATA`.
8. Create Run.
9. Verify observed resolution:
   - `resolvedCount >= 1`
   - `correlatedSampleBindingCount >= 1`
   - `scalarFallbackBindingCount = 0` for PATH
10. Verify HTTP 200 and Results persistence.

For a repeated-placeholder test, verify the Execution Plan contains distinct runtime-only aliases and the HTTP request uses the corresponding correlated values.

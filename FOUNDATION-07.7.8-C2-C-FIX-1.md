# Foundation 07.7.8-C2-C FIX-1 — Intent-Aware Observed Selection

## Goal
Prevent the HYBRID Test Data Planner from reusing successful observed values, or normal valid generators, for a BODY field that the scenario explicitly intends to make invalid.

## Scope
Gateway only. No migration. No Catalog, Normalizer, Registry, Runner, Results, Console, or Plugin change.

## Behavior
- Planner version: `qagent.test-data-planner.v1.2.1`.
- Detects a narrow, deterministic mutation intent from scenario title/objective only.
- Matches the intent to BODY selectors using selector-name tokens and a small Portuguese/English semantic alias set.
- If the matched field would be auto-resolved as `OBSERVED` or `GENERATED`, that binding is blocked.
- The scenario becomes `needsData=true` and `reviewRequired=true` with `QAgent Scenario Intent:` diagnostics.
- Other fields keep the normal HYBRID baseline, including `OBSERVED`, so the negative test isolates the intended variable.
- Explicit QA bindings keep precedence and are never overridden by the heuristic.
- No mutation value is invented and no new mutation DSL is introduced in this FIX.

## Examples
- `tipo de licença que não existe` → `$.leaveTypeId` cannot reuse a 2xx observed value.
- `datas de início e fim inválidas` → `$.fromDate` / `$.toDate` cannot use normal DATE generators.
- `sem autenticação` → body fields remain eligible for OBSERVED/GENERATED because auth, not body, is the intended mutation.
- `campos obrigatórios ausentes` without an identifiable selector does not guess a target.

## Diagnostics
Added:
- `intentAwareScenarioCount`
- `intentTargetCount`
- `intentBlockedAutoBindingCount`
- `intentBlockedObservedCount`
- `intentBlockedGeneratedCount`
- `intentTargets[]`

No observed literal is added to diagnostics, Test Design, or AI context.

## Validation
Run:

```bash
npm ci
npm run check:07.7.8-c2-c-fix-1
npm run test:all
```

Production acceptance for OrangeHRM:
- invalid `leaveTypeId`: no `OBSERVED` binding for `$.leaveTypeId`, with `QAgent Scenario Intent` blocker;
- invalid dates: no normal GENERATED bindings for `$.fromDate`/`$.toDate`;
- unauthorized: valid body baseline may still use OBSERVED;
- happy path remains unchanged from C2-C.

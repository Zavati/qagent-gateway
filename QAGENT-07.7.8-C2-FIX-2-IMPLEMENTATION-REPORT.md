# QAgent Foundation 07.7.8-C2 FIX-2 — Observed-First Test Data Resolution

## Status

**IMPLEMENTED / TESTED**

Date: 2026-09-03

## Objective

Invert the zero-config Test Data default so QAgent anchors safe request fields to successful observed application traffic whenever usable evidence exists.

Previous practical behavior could fall back to `GENERATED` for safe fields even when QAgent had observed values accepted by the target application. This produced artificial request failures such as invalid random query values.

New default:

```text
SECRET / sensitive
  -> SECRET

Explicit QA binding
  -> exact configured source (FIXED / GENERATED / SECRET)

No explicit override + usable successful observed evidence
  -> OBSERVED

No usable observed evidence
  -> existing fallback (GENERATED / FIXED / NEEDS_DATA according to existing policy)
```

Negative/boundary/mutation intent remains protected and is not silently replaced with a successful observed value.

---

## Audit result — ownership

### qagent-test-registry

Audited current Registry supplied for this phase.

**No code change required.**

Registry owns immutable Test Design persistence/versioning and returns the stored specification. It does not decide the runtime source precedence between `OBSERVED`, `GENERATED`, `FIXED`, and `SECRET`.

Validation:

```text
npm test
45 / 45 PASS
```

Historical Test Design versions remain immutable.

### qagent-runner

**No code change required.**

The current Runner contract continues to understand only runtime-materialized sources such as `GENERATED`, `FIXED`, and `SECRET`. Existing C2-D Gateway behavior resolves `OBSERVED` before dispatch and freezes it into the execution snapshot / FIXED materialization.

Therefore Runner remains decoupled from observed-data selection policy.

### qagent-gateway

**Owner of this FIX.**

The Gateway already contains:

- Observed Reservoir / planning context;
- Hybrid Test Data Planner;
- Intent-Aware Selection;
- Observed Runtime Resolver;
- execution-plan freezing for the unchanged Runner.

The FIX is intentionally concentrated here.

---

## Implementation

### Modified files

```text
src/intelligence/testDataPlanner.js
package.json
test/test-foundation-07-7-8-c2-c-hybrid-test-data-planner.js
test/test-foundation-07-7-8-c2-c-fix-1-intent-aware-observed-selection.js
test/test-foundation-07-7-8-c2-fix-2-observed-first.js   [new]
FOUNDATION-07.7.8-C2-FIX-2.md                            [new]
```

### Planner version

```text
qagent.test-data-planner.v1.2.4
        ->
qagent.test-data-planner.v1.3.0
```

### New diagnostic

```json
{
  "strategy": "HYBRID",
  "defaultResolutionPolicy": "OBSERVED_FIRST"
}
```

`HYBRID` is preserved for compatibility. `defaultResolutionPolicy` records the new default explicitly.

### Source precedence

Security and explicit QA configuration are evaluated before the observed default.

Conceptually:

```text
1. Sensitive selector
   -> SECRET

2. Explicit QA binding
   -> configured source

3. Positive successful observed evidence
   -> OBSERVED

4. No observed evidence
   -> previous fallback
```

### BODY behavior

Previously, observed values were preferential mainly for referential/enum-like fields while safe free-text fields could remain `GENERATED`.

FIX-2 makes successful observed evidence the default for any safe BODY field, including free-text fields.

Correlated successful BODY request samples are now also treated as positive observed evidence even when scalar value metadata is absent.

No observed literal is persisted inside the immutable Test Design binding.

### QUERY behavior

Query planning remains intent-aware and now reliably finds target-specific observed samples.

A subtle C2 issue was corrected: when an Environment had multiple successful samples (for example one BODY sample and one QUERY sample), baseline selection could choose the first sample before verifying that it contained the target being planned. This could hide valid observed query evidence and cause a generated fallback.

FIX-2 selects a successful sample that actually contains the requested target.

### PATH behavior

Existing C2-F correlated positional observed-path behavior is preserved.

### Negative / boundary behavior

The existing intent engine remains authoritative.

Examples:

```text
missing query param intent
-> QAgent does not reintroduce the param from OBSERVED

explicit invalid literal
-> QAgent preserves the intended invalid test value

invalid mutation requiring a strategy
-> automatic OBSERVED / GENERATED binding remains blocked fail-closed
```

### Explicit QA override

The user can still select `GENERATED` manually for a field. That explicit binding wins over observed evidence only for that selector.

Example:

```text
includeEmployees -> GENERATED (QA override)
limit            -> OBSERVED
or offset         -> OBSERVED
```

---

## Runtime compatibility

The immutable Test Design may contain:

```json
{
  "target": "QUERY",
  "selector": "limit",
  "source": "OBSERVED"
}
```

At execution time, existing C2-D behavior resolves the observed value from the runtime context and freezes the concrete value for the Runner without changing the Runner contract.

Important consequence: execution evidence may expose the frozen runtime source (`FIXED`) because the Runner receives the materialized plan, while the Test Design source remains `OBSERVED` and runtime provenance remains available in the snapshot.

---

## Immutability / rollout behavior

**Existing Test Design versions are not changed.**

If an existing immutable version already contains:

```text
QUERY includeEmployees -> GENERATED
QUERY limit            -> GENERATED
QUERY offset           -> GENERATED
```

it will continue to generate values forever when that version is executed.

After deploying FIX-2, regenerate the Test Design to create a new immutable version. The new planner version will select `OBSERVED` where evidence is available.

This is intentional and preserves Registry history.

---

## Validation

### Dedicated FIX-2

```text
npm run test:f07-7-8-c2-fix-2
PASS
```

Covered:

- OrangeHRM-style `includeEmployees`, `limit`, `offset` -> OBSERVED;
- safe free-text BODY field -> OBSERVED;
- observed literal is not persisted in Test Design;
- explicit QA `GENERATED` override wins for only that selector;
- no observed evidence preserves GENERATED fallback;
- correlated BODY sample can supply observed baseline without scalar metadata.

### C2 regressions

```text
07.7.8-C2-C Hybrid Test Data Planner                  PASS
07.7.8-C2-C FIX-1 Intent-Aware Observed Selection    PASS
07.7.8-C2-D Observed Runtime Resolution              PASS
07.7.8-C2-F Observed PATH Planning                   4/4 PASS
07.7.8-C2-F Execution Plan PATH                      2/2 PASS
07.7.8-C2-F Observed PATH Runtime                    2/2 PASS
```

### Gateway regression

```text
npm test                                             PASS
07.8-A Test Evolution routes                        PASS
Gateway router                                      PASS
node --check modified planner                       PASS
node --check new FIX-2 test                         PASS
```

### Registry regression

```text
npm test
45 / 45 PASS
```

---

## Services changed

| Service | Change |
|---|---|
| qagent-gateway | **YES** |
| qagent-test-registry | No — audited only |
| qagent-runner | No |
| qagent-catalog | No |
| qagent-console | No |
| qagent-test-results | No |
| qagent-test-evolution | No |

No D1 migration is required.

---

## Deploy

Only Gateway:

```bash
cd qagent-gateway
npx wrangler deploy
```

No migration.

---

## Acceptance test — OrangeHRM

Endpoint:

```text
GET /web/index.php/api/v2/leave/employees/leave-requests
```

### 1. Regenerate Test Design after Gateway deploy

This must create a new immutable Test Design version.

Expected in the new Test Design when successful observed evidence exists:

```text
QUERY includeEmployees -> OBSERVED
QUERY limit            -> OBSERVED
QUERY offset           -> OBSERVED
```

The old Test Design version remains `GENERATED` and unchanged.

### 2. Execute the new version

Expected runtime behavior:

```text
Test Design OBSERVED
      -> Gateway Observed Runtime Resolver
      -> frozen concrete runtime material
      -> unchanged Runner
```

The actual outgoing query should use values from successful observed evidence instead of arbitrary values such as decimal pagination values or `qagent-*` strings.

A valid observed baseline should remove artificial 422s caused purely by generated semantic-invalid request data. A 422 can still be legitimate when the target application rejects the observed value because of current state/domain rules; FIX-2 does not convert every 422 into a pass.

### 3. Explicit override check

Configure only `includeEmployees` as `GENERATED` in Test Data Runtime and regenerate again.

Expected:

```text
includeEmployees -> GENERATED
limit            -> OBSERVED
offset           -> OBSERVED
```

This proves QA control remains above the zero-config observed-first default.

---

## Final architecture decision

This FIX deliberately does **not** teach Registry or Runner about observed-data selection.

```text
Catalog / Observation evidence
        -> Gateway planning
        -> OBSERVED in immutable Test Design
        -> Gateway runtime resolution / freeze
        -> existing Runner contract
```

This keeps the behavior centralized, versioned, deterministic and low-risk.

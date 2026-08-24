# QAgent Foundation 07.7 — Runner Foundation v2 — Runtime Audited through 07.7.8-C

## Estado

```text
07.7.6 HTTP Executor v1                         PRODUCTION VALIDATED
07.7.6-A Zero-Config Runtime Bootstrap          PRODUCTION VALIDATED
07.7.6 FIX-1 Network Diagnostics                PRODUCTION VALIDATED
07.7.6 FIX-2 Workers Fetch Hardening            PRODUCTION VALIDATED
07.7.7 Assertion Engine v1                      PRODUCTION VALIDATED
07.7.8 Auth Runtime                             PRODUCTION VALIDATED
07.7.8-A Dynamic Form / OAuth Password          PRODUCTION VALIDATED
07.7.8-B Zero-Config Auth Resolution            PRODUCTION VALIDATED
07.7.8-B FIX-1 Mixed Auth Evidence              PRODUCTION VALIDATED
07.7.8 FIX-1 Secret-Safe Test Design            PRODUCTION VALIDATED
07.7.8-C Test Data Runtime                      LOCAL VALIDATED / PRODUCTION GATE PENDING
```

## 07.7.8-C freeze

Test Data v1 sources:

```text
GENERATED -> deterministic runtime-only
FIXED     -> explicit QA data, Project < Environment < Endpoint
SECRET    -> Secret Vault + JIT only
DERIVED   -> future, not part of v1
```

Non-negotiable:

```text
no generated runtime values in Test Design
no secret values in Test Design/Queue/Snapshot/Plan/logs/Results
only READY executes
explicit config beats inference
scope/source drift fails closed
side-effect methods stay globally disabled
```

## Gate before next Foundation

Complete `VALIDATION-FOUNDATION-07.7.8-C.md` in production/STG.

Do not advance merely because local regressions pass.

## Next implementation after 07.7.8-C production gate

### 07.7.8-D — Durable Side-Effect Execution Journal

This is the recommended next Foundation before enabling POST/PUT/PATCH/DELETE globally.

Goal:

- durable intent before first side-effect request;
- exact run/attempt/scenario/request fingerprint;
- states such as PLANNED / DISPATCHING / RESPONSE_OBSERVED / UNKNOWN_OUTCOME / TERMINAL;
- retry semantics that never silently repeat an unknown side effect;
- idempotency-key strategy when API supports it;
- operator/review path for unknown outcome;
- no request secret/body leakage into the journal;
- Gateway remains Run Control Plane;
- detailed Results still belong to the future Results Plane.

Only after this Foundation should `RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=true` be considered for controlled policies.

### 07.7.9 — Execution Results Plane + Console

Create `qagent-test-results` with its own D1 and sanitized Runner -> Results boundary.

```text
scenario results
assertion results
safe HTTP/network metadata
timings
execution evidence
artifact references
```

Gateway stores only summaries/references.

### 07.7.10 — Production Hardening

```text
quotas/concurrency
cancellation hardening
DLQ/operator tooling
retention
metrics/alerts
policy rollout for side effects
```

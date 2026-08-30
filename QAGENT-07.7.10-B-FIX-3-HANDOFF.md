# QAgent 07.7.10-B FIX-3 — Handoff

## Current baseline

- 07.7.10-B Read-only Suite Orchestration: PRODUCTION VALIDATED
- 07.7.10-B FIX-2 Mutation Safety: PRODUCTION VALIDATED
- Auth Runtime form-urlencoded dynamic login: validated with authenticated GET, one exchange + token cache hits
- FIX-3: implemented locally; real STG business mutation is the remaining production gate.

## Goal

Close the basic API automation loop by allowing controlled business `POST`, `PUT`, `PATCH`, and `DELETE` while keeping Queue redelivery safe.

The critical invariant is:

```text
NO BUSINESS fetch() BEFORE DURABLE DISPATCHING
```

## Architecture

```text
Test Registry
  semantic READY Suite snapshot
        |
        v
Gateway Suite Run Eligibility
  exact Environment Policy version
        |
        v
Gateway Mutation Journal
  PREPARED (mex_*)
        |
        v
Runner
  Test Data / Auth
        |
        v
Gateway confirms DISPATCHING
        |
        v
Runner fetch() POST/PUT/PATCH/DELETE
        |
        +-- no response + no idempotency --> UNKNOWN_SIDE_EFFECT / no retry
        |
        +-- no response + explicit idempotency --> controlled retry, same identity
        |
        v
RESPONSE_RECEIVED
        |
        v
Assertions + Results correlation
        |
        v
COMPLETED
```

## Service ownership

- **Test Registry:** what should be tested. No FIX-3 code change.
- **Gateway:** mutation policy + immutable policy pin + durable journal + transition authority.
- **Runner:** materializes request and performs HTTP only with permit + global kill switch.
- **Results:** stores safe `mex_*` correlation, never the mutation payload.
- **Console:** environment mutation governance and accurate controlled-mutation UX.

## New Gateway internal contracts

All are HMAC protected and validate Run scope, attempt, active lease and Runtime Plan:

```text
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/dispatching
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/response-received
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/completed
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/unknown
POST /internal/v1/runner/runs/:runId/mutations/:scenarioId/failed-before-dispatch
```

## Important retry model

### NO_AUTOMATIC_RETRY

After `DISPATCHING`, inability to prove a response means the target may already have changed state. The Journal becomes `UNKNOWN_SIDE_EFFECT` and the Runner refuses blind retry.

### IDEMPOTENCY_HEADER

Only for APIs explicitly known to support an idempotency header. The same deterministic identity is reused across Queue redelivery. Gateway rejects a changed request fingerprint.

## Safe rollout

Deploy Results migration first, then Gateway migration, then Runner with kill switch OFF, then Console. Validate. Only after that enable the Runner mutation kill switch for one disposable STG endpoint.

## What NOT to do

- Do not globally turn mutations on before applying Gateway/Results migrations.
- Do not use the legacy side-effect flag as authorization.
- Do not configure `IDEMPOTENCY_HEADER` merely because a header name can be sent; the target API must semantically support it.
- Do not automatically retry `UNKNOWN_SIDE_EFFECT`.
- Do not store request/response bodies or secret-bearing headers in Mutation Journal.
- Do not test DELETE against shared data.
- Do not enable PROD as the first validation environment.

## Next after production validation

07.7.10-C — Suite Results & Regression History, including the richer safe execution detail already identified as a product requirement:

```text
Scenario
Request shape / safe headers / sanitized payload evidence
Expected status/assertions
Actual status/content type/duration
Auth source without token value
Mutation mex_* / side-effect state
Failure diagnosis
```

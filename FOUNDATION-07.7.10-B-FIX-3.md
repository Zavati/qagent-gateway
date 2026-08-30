# QAgent Foundation 07.7.10-B FIX-3 — Controlled POST/PUT/PATCH/DELETE

Status: **IMPLEMENTED / LOCAL REGRESSION PASSED / REAL STG VALIDATION PENDING**

## 1. Objective

Release business mutations only behind the safety boundary established in FIX-2. A mutation may reach `fetch()` only when all of the following are true:

1. the scenario is the single isolated mutation scenario of the Run;
2. Runtime is READY;
3. Environment Mutation Policy resolved to `ALLOW`;
4. an immutable policy version is pinned for Suite children;
5. Durable Mutation Journal exists as `mex_*`;
6. Runner holds a mutation permit returned by Gateway;
7. `RUNNER_MUTATION_EXECUTION_ENABLED=true`;
8. Gateway durably confirms Journal state `DISPATCHING` **before** `fetch()`;
9. SSRF/Egress/Auth/Test Data rules remain unchanged.

The legacy `RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS` variable is **not** an authority for business mutations.

## 2. Services changed

### qagent-gateway
Run Control authority for mutation state.

Adds:
- migration `0017_foundation_07_7_10_b_fix_3_controlled_mutation_http.sql`;
- `dispatch_fingerprint` and `assertion_outcome` on `mutation_execution_journal`;
- exact immutable mutation-policy-version resolution for Suite children;
- HMAC-protected internal Runner transitions:
  - `POST .../dispatching`
  - `POST .../response-received`
  - `POST .../completed`
  - `POST .../unknown`
  - `POST .../failed-before-dispatch`;
- state/replay enforcement for `NO_AUTOMATIC_RETRY` and `IDEMPOTENCY_HEADER`.

### qagent-runner
Execution authority, but never policy authority.

Adds:
- `qagent.mutation-safety.v2` coordinator;
- mutation permit required by HTTP policy;
- durable `DISPATCHING` callback before `fetch()`;
- `RESPONSE_RECEIVED` callback immediately after receiving HTTP headers/status;
- deterministic Idempotency-Key for explicitly configured idempotent endpoints;
- HMAC-SHA256 dispatch fingerprint generated from transient request material;
- `UNKNOWN_SIDE_EFFECT` behavior when dispatch may have happened but response is unknown;
- safe mutation correlation in Results envelope;
- safe logs for PREPARED/DISPATCHING/RESPONSE_RECEIVED/COMPLETED.

### qagent-test-results
Stores only safe correlation to Gateway Mutation Journal.

Adds migration `0002_foundation_07_7_10_b_fix_3_mutation_refs.sql` and table:

`scenario_mutation_refs`

Stored fields are limited to:
- `resultSetId`
- `scenarioResultId`
- `scenarioId`
- `mutationExecutionId`
- `retryMode`
- `sideEffectState`
- timestamp

No body, Authorization, Cookie, password, token, API key, client secret, refresh token, Vault value, Idempotency-Key value or dispatch raw material is stored.

### qagent-console
No new mutation backend contract. Updates the existing governance UI to accurately describe FIX-3:
- Policy + Journal + preflight remain mandatory;
- controlled mutation HTTP can be enabled by Runner kill switch;
- PROD confirmation does not bypass any safety layer;
- static Inventory cards are relabeled as read-only baseline because final mutation eligibility belongs to the Environment-specific Suite Run.

### qagent-test-registry
**No FIX-3 change / no deploy required.** Suite selection v2 from FIX-2 already freezes every semantic READY scenario. Gateway decides Environment eligibility at Suite Run time.

## 3. State machine

```text
PREPARED
   |
   | Gateway durably accepts dispatch fingerprint
   v
DISPATCHING
   |\
   | \ no response + NO_AUTOMATIC_RETRY
   |  v
   | UNKNOWN_SIDE_EFFECT  [terminal for automatic retry]
   |
   | HTTP response received (2xx/3xx/4xx/5xx)
   v
RESPONSE_RECEIVED
   |
   | assertions/result persistence
   v
COMPLETED
```

Failures before dispatch can transition:

```text
PREPARED -> FAILED_BEFORE_DISPATCH -> PREPARED
```

This is safe because the application request has not been sent.

## 4. Retry semantics

### NO_AUTOMATIC_RETRY

If a network error/timeout occurs after durable `DISPATCHING`, the Runner cannot know whether the target applied the mutation.

Result:

```text
UNKNOWN_SIDE_EFFECT
NO queue redispatch of the business mutation
```

### IDEMPOTENCY_HEADER

Only available when explicitly configured in Environment Mutation Policy.

The Runner derives one deterministic value from `mutationExecutionId` and uses the exact same value on redelivery. The value is never logged or persisted. Gateway persists only its SHA-256 hash.

A retry is accepted only when:
- Journal is already `DISPATCHING`;
- retry mode is `IDEMPOTENCY_HEADER`;
- Idempotency-Key hash matches;
- dispatch HMAC fingerprint matches.

A different request shape/body/header set in retry produces `MUTATION_DISPATCH_FINGERPRINT_CONFLICT`.

## 5. Dispatch fingerprint

The Runner builds transient material after Test Data materialization and Idempotency-Key injection but **before Auth injection**. This prevents rotating Bearer tokens from changing mutation identity.

The raw transient material exists only in Runner memory. Runner sends Gateway only:

```text
HMAC-SHA256(RUNNER_CONTROL_HMAC_SECRET, canonical request material)
```

Gateway persists the 64-character digest, never the original request/body/headers.

## 6. Known HTTP responses

Any HTTP response means network dispatch is no longer unknown, including 4xx and 5xx.

```text
HTTP 201 -> RESPONSE_RECEIVED
HTTP 400 -> RESPONSE_RECEIVED
HTTP 401 -> RESPONSE_RECEIVED
HTTP 500 -> RESPONSE_RECEIVED
```

The assertion engine determines PASSED/FAILED afterward. A 5xx is **not** automatically retried as a mutation merely because it is a server error.

## 7. Production kill switch

The package ships with:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

This is deliberate. Deploying FIX-3 does not send business mutations until the operator explicitly flips the Runner variable after validating Policy + Journal in STG.

`RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS` is retained only for rolling compatibility and has no authority in FIX-3.

## 8. Security invariants

- Gateway remains multi-tenant authority and validates organization/project/run/environment scope.
- Suite child mutations use the exact immutable `policyVersionId` chosen during Suite planning; a later Policy update cannot silently change an in-flight Suite Run.
- mutation scenarios remain isolated: one mutation scenario per child `run_*`.
- no raw secrets cross Runner -> Gateway Mutation Journal.
- no raw request/response bodies are added to Results Plane.
- Results stores `mex_*` correlation only.
- Browser never calls Runner internal mutation endpoints.
- all Runner mutation-control endpoints remain HMAC protected and lease/attempt/runtime-plan validated.

## 9. Definition of Done

Local implementation is considered complete when:
- all previous Gateway/Runner/Results/Console regressions pass;
- real SQLite tests cover new migrations;
- old migrations remain byte-for-byte immutable;
- `DISPATCHING` is proven to happen before `fetch()`;
- no-auto network uncertainty is `UNKNOWN_SIDE_EFFECT` with no queue retry;
- explicit idempotency mode reuses the same identity and permits controlled retry;
- Results stores `mex_*` correlation without secrets/body;
- Console accurately describes controlled mutation behavior;
- final ZIPs pass re-extraction tests and forbidden-file scan.

Production validation additionally requires controlled real STG POST/PUT/PATCH/DELETE tests where safe endpoints exist.

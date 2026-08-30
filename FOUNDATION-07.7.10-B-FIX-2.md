# QAgent Foundation 07.7.10-B FIX-2 — Mutation Safety Contract

Status: IMPLEMENTED / READY FOR PRODUCTION VALIDATION

## Objective

Introduce the durable safety boundary required before QAgent can send business `POST`, `PUT`, `PATCH` or `DELETE` requests. This Foundation does **not** enable business mutation HTTP. It adds policy, journal, retry semantics, preflight and environment-specific Suite Run eligibility while keeping the final HTTP gate locked until 07.7.10-B FIX-3.

## Frozen architecture

```text
Test Registry
  suitev_* = immutable semantic READY intent
       ↓
Gateway / Run Control Plane
  Environment Mutation Policy
  Suite Run Eligibility v2
  Durable Mutation Journal
       ↓
Runner
  Runtime READY
       ↓
  Mutation Preflight
       ↓
  Test Data / Auth
       ↓
  HTTP mutation gate = OFF in FIX-2
```

## Test Registry

- Suite selection policy: `qagent.suite-selection-policy.v2`.
- Auto Suite freezes **all semantic READY scenarios**, including business mutations.
- A Suite describes what should be tested; it no longer decides whether a mutation may execute in a specific Environment.
- Exact `tdv_*` and scenario IDs remain immutable/pinned.
- Existing execution-item projection is reused; no new Registry migration in FIX-2.

## Gateway

### Migration 0016

Adds:
- `mutation_execution_policies`
- `mutation_execution_policy_versions`
- `mutation_execution_journal`
- `mutation_execution_events`
- `suite_run_execution_units`
- Suite Run eligibility snapshot fields.

All migrations 0001–0015 remain byte-identical to the production-validated 07.7.10-B FIX-1 baseline.

### Environment Mutation Policy

Scope:
`organization → project → environment → endpoint → HTTP method`.

Rules:
- missing policy = `DENY`;
- only `POST`, `PUT`, `PATCH`, `DELETE` are governed as mutations;
- only owner/admin may change policy;
- immutable `mupv_*` versions;
- retry modes:
  - `NO_AUTOMATIC_RETRY`
  - `IDEMPOTENCY_HEADER`
- PROD requires policy-level confirmation and Suite Run explicit confirmation.

### Durable Mutation Journal

Metadata only. Never stores request/response body, Authorization, Cookie, password, token, API key, client secret or Vault material.

State machine:

```text
PREPARED
  ├─ FAILED_BEFORE_DISPATCH
  └─ DISPATCHING
       ├─ RESPONSE_RECEIVED → ASSERTED → COMPLETED
       └─ UNKNOWN_SIDE_EFFECT  [terminal for automatic retry]
```

A replay with the same `runId + scenarioId + requestFingerprint` is idempotent. A divergent fingerprint fails closed with `MUTATION_JOURNAL_CONFLICT`.

### Suite Run Eligibility v2

Eligibility is resolved at Suite Run time against the selected Environment.
- safe methods → `READ_ONLY_BATCH` execution unit;
- each mutation scenario → isolated `MUTATION_SINGLE` execution unit;
- allowed policy → `EXECUTE`;
- absent/denied policy → `POLICY_HOLD`;
- policy resolution is batch-based, not N+1.

## Runner

Mutation preflight order:

```text
Claim
→ Runtime materialization
→ persist Runtime READY
→ Mutation Preflight
→ Test Data Runtime
→ Auth Runtime
→ HTTP
```

A denied mutation stops before Test Data, Auth and HTTP.

Defense in depth:
- existing `RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS`
- new `RUNNER_MUTATION_EXECUTION_ENABLED`

Both must be true for business mutation HTTP. This FIX ships with:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

Therefore no business POST/PUT/PATCH/DELETE is transmitted by this Foundation.

## Console

Automation Center adds Mutation Governance for a selected Environment:
- shows mutation endpoints with semantic READY scenarios;
- explicit ALLOW / DENY;
- retry mode configuration;
- optional idempotency header name;
- PROD confirmation UI;
- owner/admin write protection;
- explicit message that FIX-2 does not send mutation HTTP.

The Auto Suite remains semantic READY intent. Final Environment eligibility is resolved server-side when creating a Suite Run.

## Results Plane

No changes in FIX-2. Detailed execution evidence remains in `qagent-test-results`; mutation-specific execution evidence will evolve when FIX-3 actually sends controlled mutation HTTP.

## Security invariants

- multi-tenant scope on every policy/journal object;
- default deny;
- no secrets or raw body in policy/journal;
- no blind retry after uncertain dispatch;
- mutation scenario isolation;
- exact Suite/Test Design versions remain pinned;
- business mutation HTTP remains locked until FIX-3.

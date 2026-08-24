# Architectural Requirement — Test Data Runtime

## Requirement

QAgent must satisfy executable test-data requirements without persisting invented runtime values in immutable Test Designs and without allowing secrets to escape Secret Vault ownership.

## Non-negotiable invariants

1. Test Design stores Test Data descriptors/references, never generated runtime values.
2. Sensitive selectors must use `SECRET`; `FIXED` and `GENERATED` are rejected for them.
3. Secret plaintext never enters Test Design, Queue, Runtime Snapshot, Execution Plan, logs or Results.
4. An opaque Vault reference may exist in the Runtime Snapshot; decryption remains Gateway-only.
5. Runner obtains SECRET material JIT only with valid HMAC, active lease, exact attempt and exact `runtimePlanHash`.
6. GENERATED values exist only in Runner memory for the attempt.
7. GENERATED is deterministic for `runId + scenarioId + target + selector`.
8. FIXED values use explicit precedence `PROJECT < ENVIRONMENT < ENDPOINT`.
9. ENDPOINT bindings are Environment-bound in v1 to prevent accidental cross-environment IDs/codes.
10. Explicit user configuration always beats discovery/inference.
11. AI suggestions are advisory; deterministic planner/runtime code is authoritative.
12. Informal placeholders such as `${PASSWORD}` / `{{secret}}` are not Test Data contracts.
13. Only READY scenarios execute; unresolved FIXED/SECRET remains `NEEDS_DATA`.
14. Test Data must not clear readiness blockers owned by other semantic rules.
15. Egress/SSRF policy remains before actual HTTP invocation.
16. Side-effect methods remain disabled globally until a durable side-effect execution journal exists.
17. Results Plane remains separate from Gateway and must inherit the same no-secret rule.

## Trust boundaries

```text
Catalog / AI Context       structural, secret-safe metadata only
Test Registry              immutable descriptors/references only
Gateway D1                 FIXED config + encrypted Vault references/metadata
Secret Vault               encrypted secret material; Gateway owns keys
Runtime Snapshot           referenced FIXED values + opaque Vault refs only
Queue                      run/plan/snapshot references only
Runner memory              generated/fixed/secret materialized request
Gateway attempt journal    counts/duration/status only
Future Results Plane       no secret values
```

## Scope precedence

For one `target + selector` and selected Environment:

```text
PROJECT fallback
  overridden by ENVIRONMENT
    overridden by ENDPOINT for that Environment
```

A higher scope with a different source type does not silently mutate an immutable Test Design at execution time. Source drift fails closed and requires regeneration/review.

## Generator-config boundary

`generatorConfig` must never become a generic persistence or prompt channel.

Only structural generator configuration needed by deterministic code may cross boundaries. Example/default/const/free-form payload fields are removed. Nested sensitive required fields cannot be generated through a parent JSON schema.

## Future extension: DERIVED

`DERIVED` is intentionally outside v1. When introduced it must reference a formal setup/scenario output contract and may not depend on implicit mutable shared memory.

A valid future shape must identify at minimum:

```text
producer scenario/setup id
extract contract id/path
value type
lifecycle/scope
failure semantics
```

and preserve immutable planning + deterministic replay semantics.

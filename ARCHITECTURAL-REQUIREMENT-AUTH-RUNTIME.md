# Architectural Requirement — Auth Runtime

## Requirement

QAgent must execute authenticated API tests without copying Secret Vault ownership into the Runner or persisting plaintext credentials in any execution artifact.

## Non-negotiable invariants

1. Test Design never contains plaintext credentials.
2. Queue carries references only.
3. Execution Plan and Runtime Snapshot contain auth metadata/config only.
4. Secret Vault master key remains in Gateway.
5. Runner obtains the minimum Auth Material JIT through an HMAC-protected Service Binding route.
6. Auth Material resolution requires an active lease, exact attempt and exact runtimePlanHash.
7. Requested Auth Profile must be frozen in the Runtime Snapshot and referenced by a REQUIRED scenario in the immutable Execution Plan.
8. Secret values/tokens live only in process memory for the attempt.
9. No auth value is written to Gateway D1, logs, assertion summaries or future public APIs.
10. Auth Profile nonsecret config/target is frozen; secret value is resolved from the current Environment binding JIT.
11. Dynamic login/token exchange runs before test requests and cannot follow redirects silently.
12. Test DSL cannot override/collide with Auth Runtime header/query placement.
13. `auth=NONE` path remains zero-config; `auth=REQUIRED` asks the customer only for the credential/profile that cannot be safely inferred from traffic.

## Trust model

```text
Secret Vault / decrypt keys      Gateway only
Auth Material endpoint           Gateway internal Runner Control
Runtime orchestration            qagent-runner
Plaintext credential lifetime    in-memory attempt only
Persistent execution summaries   bounded/nonsecret
Detailed results                 future Results Plane, still no secrets
```

## Static credentials

`basic` and `api_key` are converted directly to an in-memory injection.

No external auth request is needed.

## Dynamic credentials

`oauth2_client_credentials` and `login_http_json` resolve credentials JIT and perform a bounded auth exchange from Runner using the auth target already frozen in Runtime Snapshot.

Obtained token is ephemeral and must not be returned to Gateway.

## Rotation semantics

A secret may be rotated after Run creation and before execution.

The execution uses the credential currently bound to the frozen Auth Profile/Environment at JIT resolution time. This is deliberate: secrets are operational runtime material, not immutable Test Design content.

Nonsecret config drift is not adopted silently. The frozen snapshot remains authoritative; profile type drift fails closed.

## Failure semantics

```text
Secret/profile missing or drift
-> Run ERROR / phase AUTH

Dynamic auth network/timeout/5xx
-> retryable before test requests

Dynamic auth 4xx
-> Run ERROR / phase AUTH

Static auth applied + tested API returns 401/403
-> HTTP RESPONSE
-> assertions evaluate actual response
-> typically Run FAILED
```

## Onboarding implication

The first-user experience should remain:

```text
install plugin
-> observe APIs
-> public APIs can execute with zero config
-> QAgent detects auth requirement
-> user configures only Auth Profile/credential
-> authenticated tests execute through Auth Runtime
```

The platform must never require the QA to manually re-enter host/path/schema information already observed solely because authentication is required.

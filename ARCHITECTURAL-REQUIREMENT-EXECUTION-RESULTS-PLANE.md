# QAgent — Architectural Requirement
## Dedicated Execution Results / Evidence Plane

**Status:** REQUIRED / FROZEN FOR RUNNER ARCHITECTURE
**Introduced:** Foundation 07.7.5

## Principle

Do not turn `QAGENT_DB` into the detailed execution-history database.

Boundaries:

```text
Test Registry
-> immutable test definition/version

Gateway / Run Control Plane
-> Run identity/lifecycle
-> queue state
-> attempt/lease/retry summaries
-> runtime readiness summary
-> references to execution results

Execution Results Plane
-> scenario execution records
-> assertion execution records
-> timing/latency
-> sanitized request metadata
-> sanitized response metadata/samples
-> error/failure evidence
-> artifact references
```

## Storage model

Recommended service:

```text
qagent-test-results
```

Recommended bindings:

```text
RESULTS_DB  -> Cloudflare D1 relational execution data
RESULTS_R2  -> large sanitized artifacts only when needed
```

Later metrics/aggregates may move to an analytics store rather than repeatedly scanning relational history.

## Runner write model

Runner must not write directly to Gateway D1.

Preferred boundary:

```text
qagent-runner
-> internal Service Binding or result-ingestion Queue
-> qagent-test-results
-> RESULTS_DB / R2
```

Execution result messages contain tenant/run/attempt/scenario references plus sanitized results, never runtime secrets.

## Security

Never persist in results:

```text
Authorization values
Bearer tokens
cookies/session tokens
passwords
API keys
client secrets
refresh tokens
raw Secret Vault values
lease tokens
```

## Control-plane summary

Gateway may keep bounded fields such as:

```text
run status
attempt status
scenario total/passed/failed
resultSetId / resultsRef
startedAt / completedAt
total duration
```

Detailed assertion/event payloads belong to Results Plane.

## Timing

Do not create this service in 07.7.5 because no external HTTP/result payload exists yet.

Create the service foundation before detailed result persistence in 07.7.9, ideally as `07.7.9-A — qagent-test-results Foundation`.


## Side-effect execution journal

Foundation 07.7.6 adds the generic HTTP Executor, but production mutation methods remain disabled by default:

```text
POST / PUT / PATCH / DELETE
```

Cloudflare Queues provide at-least-once delivery, so a Worker can theoretically perform a target mutation and terminate before durable completion is recorded. A redelivery cannot safely infer whether the target side effect occurred.

Before mutation execution is enabled broadly, the Results Plane must provide a durable scenario-execution journal with at least:

```text
executionId / scenario execution identity
request fingerprint
STARTED / COMPLETED / INDETERMINATE state
startedAt / completedAt
safe target metadata
idempotency strategy where the target supports it
```

If a prior side-effect attempt is `INDETERMINATE`, QAgent must fail closed rather than silently replay the mutation.

This journal can be introduced before 07.7.9 if mutation coverage becomes a blocker; otherwise it is part of the `qagent-test-results` foundation.

## Foundation 07.7.6 FIX-1 — bounded HTTP diagnostics

The Gateway Run Control Plane may retain a bounded transport summary useful for immediate operator/QA diagnosis:

```text
HTTP response counts by status class (2xx/3xx/4xx/5xx)
one primary diagnostic per attempt
safe network category/error code/error name/cause code
one primary HTTP status code for a non-success response
```

This exception remains a **summary**, not detailed result storage. Per-scenario histories, response payloads, complete headers, assertion details and evidence still belong to the Execution Results Plane.

Raw exception messages are not stored because they may contain target URLs or sensitive context.

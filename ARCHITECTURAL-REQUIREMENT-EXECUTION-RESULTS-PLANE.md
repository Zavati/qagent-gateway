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

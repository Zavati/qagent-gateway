# QAgent — Foundation 07.7.6
## HTTP Executor v1

**Status:** implemented / awaiting controlled production HTTP gate

## Objective

Turn a deterministic `qagent.runner-runtime-plan.v1` scenario into one controlled outbound HTTP request and one normalized in-memory response envelope.

This Foundation deliberately separates **transport execution** from **assertion evaluation**:

```text
Runtime Plan
  -> HttpExecutionCoordinator
  -> HttpScenarioExecutor
  -> SafeHttpRequestBuilder
  -> HttpEgressPolicy
  -> fetch(... redirect=manual)
  -> bounded response capture
  -> qagent.http-executor.v1
  -> control-plane summary only
```

`07.7.7` consumes the transient response body and evaluates Test DSL assertions. `07.7.6` does not decide PASSED/FAILED.

## TDD / generic executor design

The executor contains no endpoint-specific rules. Tests inject `fetchImpl`, policy and scenario data.

Main seam:

```js
const executor = new HttpScenarioExecutor(env, { fetchImpl });
const result = await executor.execute(runtimeScenario);
```

The same class handles any supported API target assembled from the immutable Runtime Plan.

Collaborators:

```text
HttpExecutionCoordinator
  - sequential scenario orchestration (v1)
  - heartbeat hook before every scenario
  - produces safe aggregate counts

HttpScenarioExecutor
  - one scenario -> one HTTP transport result
  - timeout/network error classification
  - redirect loop control

SafeHttpRequestBuilder
  - path params
  - query params
  - safe headers
  - body serialization and request-size limit

HttpEgressPolicy
  - exact frozen-origin enforcement
  - reserved/private literal address blocking
  - metadata/localhost blocking
  - insecure HTTP kill switch
  - side-effect method kill switch
  - same-origin redirect policy

Response Capture
  - bounded streaming read
  - safe response-header allowlist
  - JSON/text decoding in memory
  - truncation marker
```

## Security invariants

### Origin authority

The Runner may only execute against the origin frozen in the Runtime Snapshot/API Service mapping. Test DSL cannot replace the host.

### SSRF/egress guard

Blocks:

- localhost / `.localhost`;
- `.local` / `.internal`;
- private/reserved IPv4 literals;
- loopback/link-local/private IPv6 literals;
- known metadata hosts/IPs;
- userinfo credentials in URL;
- target origin different from Runtime Snapshot origin.

Redirects use `redirect: manual`. Automatic follow, when explicitly enabled, is same-origin only and GET/HEAD only.

### Header ownership

Test DSL cannot set security/transport-owned headers such as:

```text
Authorization
Cookie
Host
Content-Length
Connection
Transfer-Encoding
Proxy-*
Sec-*
X-Forwarded-*
CF-*
```

`Authorization` remains owned by 07.7.8 Auth Runtime.

### Bounded I/O

Defaults:

```text
RUNNER_HTTP_TIMEOUT_MS=10000
RUNNER_HTTP_MAX_REQUEST_BYTES=65536
RUNNER_HTTP_MAX_RESPONSE_BYTES=262144
RUNNER_HTTP_MAX_REDIRECTS=0
```

## Side-effect method policy

The request builder supports:

```text
GET POST PUT PATCH DELETE HEAD OPTIONS
```

However outbound POST/PUT/PATCH/DELETE are disabled by default:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
```

Reason: Cloudflare Queues are at-least-once. If a Worker performs a side effect and dies before durable completion is recorded, a redelivery cannot know whether the target mutation occurred. Before production side-effect execution is enabled, QAgent needs the Results Plane execution journal / indeterminate-outcome policy.

GET/HEAD/OPTIONS are the controlled 07.7.6 production gate.

## Auth boundary

`REQUIRED` scenarios fail closed in 07.7.6 with:

```text
RUNNER_HTTP_AUTH_RUNTIME_REQUIRED
```

No secret is resolved or injected. JIT secret resolution is Foundation 07.7.8.

## Response boundary

The executor returns response body only in transient process memory for the future Assertion Engine:

```text
transient.bodyText
transient.bodyJson
transient.bodyBytes
```

These values are never sent to Gateway or logged by the Runner.

Gateway receives only:

```text
qagent.runner-http-executed.v1
requestCount
responseCount
networkErrorCount
timeoutCount
redirectCount
durationMs
runtimePlanHash
```

## Control Plane persistence

Migration:

```text
0009_foundation_07_7_6_http_executor.sql
```

Adds safe summaries only:

```text
http_execution_status
http_request_count
http_response_count
http_network_error_count
http_timeout_count
http_redirect_count
http_duration_ms
http_executed_at
```

No URL/query/body/header values or customer response bodies are stored in `QAGENT_DB`.

## Feature kill switch

HTTP execution is disabled by default:

```text
RUNNER_HTTP_EXECUTION_ENABLED=false
```

When disabled, the Runner retains 07.7.5 behavior.

## Gate

```text
READY + NONE auth + controlled HTTPS target
-> Claim / Lease / Heartbeat
-> Runtime READY
-> egress guard
-> one real GET/HEAD request
-> bounded response capture
-> httpExecutionStatus = COMPLETED
-> response body remains out of Gateway D1
-> Queue ACK
```

# Apply — Foundation 07.7.6 HTTP Executor v1

## 0. Safety gate

Deploy with HTTP execution disabled first.

```text
RUNNER_HTTP_EXECUTION_ENABLED=false
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

The first production HTTP smoke must use a READY scenario with `auth.requirement = NONE` and a controlled HTTPS GET/HEAD endpoint.

The current authenticated SEST SENAT scenario must wait for Foundation 07.7.8 Auth Runtime.

## 1. Gateway first

```bash
npm ci
npm run check:07.7.6
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Expected migration:

```text
0009_foundation_07_7_6_http_executor.sql
```

## 2. Runner

```bash
npm ci
npm run check:07.7.6
npm run deploy
```

Health should report:

```text
foundation = 07.7.6
httpExecutorVersion = qagent.http-executor.v1
assertionEngineEnabled = false
authRuntimeEnabled = false
```

## 3. Enable controlled HTTP execution

After Gateway + Runner deploy validation, change Runner var:

```text
RUNNER_HTTP_EXECUTION_ENABLED=true
```

Keep:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

Redeploy Runner.

## 4. Create a NEW Run

Use a new Idempotency-Key and a READY, no-auth GET/HEAD scenario.

Expected GET Run after processing:

```text
queue.status = RECEIVED
executionAttempt.status = RECEIVED
executionAttempt.runtimeReadinessStatus = READY
executionAttempt.httpExecutionStatus = COMPLETED
executionAttempt.httpRequestCount >= 1
executionAttempt.httpResponseCount >= 0
executionAttempt.httpNetworkErrorCount >= 0
executionAttempt.httpTimeoutCount >= 0
executionAttempt.httpExecutedAt != null
lastErrorCode = null
```

A successful controlled 2xx/4xx/5xx HTTP response still counts as a transport RESPONSE. PASS/FAIL is not decided until 07.7.7 Assertion Engine.

## 5. D1 audit

```sql
SELECT
  run_id,
  attempt_id,
  attempt_number,
  status,
  runtime_readiness_status,
  http_execution_status,
  http_request_count,
  http_response_count,
  http_network_error_count,
  http_timeout_count,
  http_redirect_count,
  http_duration_ms,
  http_executed_at,
  last_error_code
FROM run_execution_attempts
ORDER BY created_at DESC
LIMIT 20;
```

No response body or request payload should exist in this table.

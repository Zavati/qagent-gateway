# Apply — Foundation 07.7.6 FIX-1
## HTTP Network Diagnostics

## 1. Gateway first

```bash
npm ci
npm run check:07.7.6-fix-1
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Expected new migration:

```text
0010_foundation_07_7_6_fix_1_http_network_diagnostics.sql
```

Optional production verification:

```sql
PRAGMA table_info(run_execution_attempts);
```

Confirm the `http_response_*` and `http_primary_*` columns exist.

## 2. Runner second

Keep:

```text
RUNNER_HTTP_EXECUTION_ENABLED=true
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

Then:

```bash
npm ci
npm run check:07.7.6-fix-1
npm run deploy
```

## 3. Open Runner tail

```bash
npx wrangler tail qagent-runner --format pretty
```

Look for:

```text
run_http_scenario_result
run_http_execution_summary
```

## 4. Create a NEW Run

Use the same READY Buggy Cars Test Design scenario, but a new `Idempotency-Key`.

Example:

```text
Idempotency-Key: run-smoke-buggycars-http-fix1-001
```

Continue sending:

```json
{
  "contractVersion": "qagent.run-create.v1",
  "testDesignVersionId": "<tdv>",
  "environmentId": "<env>",
  "scenarioIds": ["test_001"],
  "confirmDiscoveredRuntime": true
}
```

## 5. GET the new Run

For a transport/network failure, expect:

```text
httpExecutionStatus = COMPLETED
httpRequestCount = 1
httpResponseCount = 0
httpNetworkErrorCount = 1
httpDiagnostic.kind = NETWORK_ERROR
httpDiagnostic.errorCategory != null
```

For a real HTTP 500, expect:

```text
httpExecutionStatus = COMPLETED
httpRequestCount = 1
httpResponseCount = 1
httpNetworkErrorCount = 0
httpResponseStatusCounts.response5xxCount = 1
httpDiagnostic.kind = HTTP_RESPONSE
httpDiagnostic.statusCode = 500
```

For a successful 2xx transport, expect:

```text
httpResponseCount = 1
httpResponseStatusCounts.response2xxCount = 1
httpDiagnostic = null
```

`PASSED` / `FAILED` still belongs to Foundation 07.7.7 Assertion Engine.

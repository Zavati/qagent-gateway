# QAgent — Foundation 07.7.6 FIX-1
## HTTP Network Diagnostics

**Status:** implemented / awaiting production diagnostic smoke

## Objective

Make HTTP transport failures and non-success HTTP responses observable without leaking request/response bodies, query values, auth material, cookies, secrets, or raw exception messages.

The HTTP Executor already knew whether a scenario ended as `RESPONSE`, `NETWORK_ERROR`, or `TIMEOUT`, but Foundation 07.7.6 persisted only aggregate counts. FIX-1 adds safe, bounded diagnostics that are useful to the QA and to QAgent support/operations.

```text
Runtime Scenario
  -> HttpScenarioExecutor
  -> RESPONSE / NETWORK_ERROR / TIMEOUT
  -> safe diagnostic classification
  -> per-scenario structured Worker log
  -> bounded Control Plane summary
  -> GET Run exposes status classes + primary diagnostic
```

## Important semantic distinction

An upstream HTTP `500` is **not** a network error. It is a valid HTTP response and should be visible as:

```text
httpResponseCount = 1
httpResponseStatusCounts.response5xxCount = 1
httpDiagnostic.kind = HTTP_RESPONSE
httpDiagnostic.statusCode = 500
```

A transport failure before receiving an HTTP response is visible as:

```text
httpResponseCount = 0
httpNetworkErrorCount = 1
httpDiagnostic.kind = NETWORK_ERROR
httpDiagnostic.errorCategory = DNS | CONNECT | TLS | RESET | ABORT | FETCH | UNKNOWN
```

## Runner diagnostics

New module:

```text
src/httpDiagnostics.js
```

Network errors are classified into stable categories:

```text
DNS
CONNECT
TLS
RESET
ABORT
FETCH
UNKNOWN
```

The raw `Error.message` is inspected in memory only for classification and is never included in the persisted diagnostic or structured log.

Safe fields may include:

```text
scenarioId
outcome
method
origin
path
statusCode
statusClass
contentType
capturedBytes
truncated
durationMs
errorCode
networkErrorCategory
errorName
causeCode
```

Never log/persist:

```text
Authorization values
Cookie values
request body
response body
query values
raw exception message
Secret Vault values
lease token
```

## Structured logs

Runner emits:

```text
run_http_scenario_result
run_http_execution_summary
```

Example network failure:

```json
{
  "type": "run_http_scenario_result",
  "scenarioId": "test_001",
  "outcome": "NETWORK_ERROR",
  "method": "GET",
  "origin": "https://api.example.com",
  "path": "/prod/models",
  "errorCode": "RUNNER_HTTP_NETWORK_FETCH",
  "networkErrorCategory": "FETCH",
  "errorName": "TypeError",
  "causeCode": null
}
```

Example upstream 500:

```json
{
  "type": "run_http_scenario_result",
  "scenarioId": "test_001",
  "outcome": "RESPONSE",
  "statusCode": 500,
  "statusClass": "5XX"
}
```

## Control Plane summary

Migration:

```text
0010_foundation_07_7_6_fix_1_http_network_diagnostics.sql
```

Adds bounded fields to `run_execution_attempts`:

```text
http_response_2xx_count
http_response_3xx_count
http_response_4xx_count
http_response_5xx_count
http_primary_diagnostic_kind
http_primary_scenario_id
http_primary_status_code
http_primary_error_code
http_primary_error_category
http_primary_error_name
http_primary_cause_code
```

This does not replace the dedicated Results Plane. It is only a single primary diagnostic plus bounded aggregate counts.

Detailed per-scenario result history, response metadata, assertion results, timings and artifacts still belong to `qagent-test-results`.

## Public Run response

`GET Run` now exposes:

```json
{
  "executionAttempt": {
    "httpExecutionStatus": "COMPLETED",
    "httpResponseStatusCounts": {
      "response2xxCount": 0,
      "response3xxCount": 0,
      "response4xxCount": 0,
      "response5xxCount": 0
    },
    "httpDiagnostic": {
      "kind": "NETWORK_ERROR",
      "scenarioId": "test_001",
      "statusCode": null,
      "errorCode": "RUNNER_HTTP_NETWORK_FETCH",
      "errorCategory": "FETCH",
      "errorName": "TypeError",
      "causeCode": null
    }
  }
}
```

For a clean 2xx execution, `httpDiagnostic` is `null` and the 2xx counter is incremented.

## Deployment order

Because the Runner sends new optional fields to the existing `qagent.runner-http-executed.v1` contract, deploy in this order:

```text
1. Gateway migration 0010
2. Gateway deploy
3. Runner deploy
4. new Run smoke
```

Do not deploy the new Runner before the compatible Gateway.

## Production gate

Re-run the Buggy Cars `GET /prod/models` scenario with a new Run/Idempotency-Key.

If the previous transport problem still occurs, the next GET Run must identify at least:

```text
httpDiagnostic.kind
httpDiagnostic.errorCode
httpDiagnostic.errorCategory
httpDiagnostic.errorName
httpDiagnostic.causeCode (when available)
```

If the upstream responds, status class counters must reveal 2xx/3xx/4xx/5xx. A 500 must be visible as an HTTP response, not a network failure.

# Apply — Foundation 07.7.6-A Zero-Config Runtime Bootstrap v1

## Deploy scope

Only `qagent-gateway` requires a code deploy.

No D1 migration is introduced by 07.7.6-A.
`qagent-runner` 07.7.6 is already compatible and does not need redeploy solely for this subphase.

## Validate locally

```bash
npm ci
npm run check:07.7.6-a
npm run test:all
```

## Deploy Gateway

```bash
npm run deploy
```

## Production smoke — Buggy Cars

Prerequisites:

```text
Environment configured/selected
NO API Service required
NO Auth Profile required for the public endpoint
Plugin has observed GET /prod/models
```

### 1. Generate Test Design again

Expected diagnostics:

```json
{
  "builderVersion": "qagent.catalog-context-builder.v1.3",
  "runtimeMapping": {
    "status": "DISCOVERED",
    "resolutionSource": "DISCOVERED_OBSERVATION",
    "runtimeSource": "DISCOVERED_OBSERVATION",
    "resolutionConfidence": "HIGH",
    "requiresExecutionConfirmation": true,
    "discoveredOrigin": "https://k51qryqov3.execute-api.ap-southeast-2.amazonaws.com"
  }
}
```

Expected scenario target:

```text
GET /prod/models
apiServiceKey = discovered-...
auth = NONE
readiness = READY
```

### 2. Create Run without confirmation

Use a fresh `Idempotency-Key` and omit `confirmDiscoveredRuntime`.

Expected:

```text
HTTP 409
RUN_DISCOVERED_RUNTIME_CONFIRMATION_REQUIRED
```

The response details should show the safe discovered Base URL.

### 3. Confirm and create Run

Retry with a fresh key or the same key if no Run was persisted:

```json
{
  "contractVersion": "qagent.run-create.v1",
  "testDesignVersionId": "tdv_...",
  "environmentId": "env_...",
  "scenarioIds": ["..."],
  "confirmDiscoveredRuntime": true
}
```

Expected Runtime Snapshot:

```json
{
  "resolution": {
    "source": "DISCOVERED_OBSERVATION",
    "confidence": "HIGH",
    "requiresExecutionConfirmation": false
  }
}
```

### 4. HTTP gate

Keep side-effect methods disabled:

```text
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
```

For the public GET smoke, HTTP may be enabled only after the discovered Run is confirmed:

```text
RUNNER_HTTP_EXECUTION_ENABLED=true
```

Expected execution attempt after Queue consumption:

```text
runtimeReadinessStatus = READY
runtimeResolutionSource = DISCOVERED_OBSERVATION
httpExecutionStatus = COMPLETED
httpRequestCount >= 1
httpResponseCount >= 1
```

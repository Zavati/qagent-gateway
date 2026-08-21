# Apply — Foundation 07.7.5

## Important pre-gate

The previously reused Run `run_95b718dd-...` was already `RECEIVED` before the 07.7.4 consumer path, so `executionAttempt: null` is expected for that historical Run. Create a NEW Run after deploying 07.7.5 to validate both 07.7.4 claim/lease and 07.7.5 runtime materialization.

## 1. Gateway

```bash
npm ci
npm run check:07.7.5
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Expected new migration:

```text
0008_foundation_07_7_5_runtime_integration.sql
```

## 2. Runner

Deploy after Gateway:

```bash
npm ci
npm run check:07.7.5
npm run deploy
```

No Runner database/migration is introduced.

## 3. Production smoke

Create a NEW Run using the already validated Test Design Version and `test_001`, with a new Idempotency-Key.

After Queue/Runner processing:

```text
queue.status = RECEIVED
executionAttempt != null
executionAttempt.status = RECEIVED
executionAttempt.heartbeatCount >= 1
executionAttempt.runtimeReadinessStatus = READY
executionAttempt.runtimePlanHash = 64-char sha256
executionAttempt.runtimeTargetCount = 1
executionAttempt.runtimeResolutionSource = EXPLICIT_CONFIG
executionAttempt.runtimeResolutionConfidence = CONFIRMED
executionAttempt.runtimeMaterializedAt != null
```

## 4. D1 audit

```sql
SELECT
  run_id,
  attempt_id,
  attempt_number,
  status,
  heartbeat_count,
  runtime_readiness_status,
  runtime_plan_hash,
  runtime_target_count,
  runtime_resolution_source,
  runtime_resolution_confidence,
  runtime_materialized_at,
  last_error_code
FROM run_execution_attempts
ORDER BY created_at DESC
LIMIT 20;
```

No HTTP request to the customer API is performed by 07.7.5.

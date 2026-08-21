# Apply — QAgent Foundation 07.7.2
## Run Contract + Execution Plan Foundation

## 1. Replace repository contents

Use the delivered snapshot as the Gateway HEAD. Preserve real Cloudflare IDs/secrets already configured in your repository/environment.

Never commit:

```text
.env
.dev.vars
node_modules
.wrangler
.git
secrets
```

## 2. Install and validate

```bash
npm ci
npm run check:07.7.2
npm run test:all
```

## 3. Apply D1 migration

```bash
npm run db:migrations:apply
```

Equivalent:

```bash
npx wrangler d1 migrations apply QAGENT_DB --remote
```

Migration expected:

```text
0005_foundation_07_7_2_run_contract_execution_plan.sql
```

## 4. Deploy Gateway

```bash
npm run deploy
```

GitHub Actions now applies D1 migrations after tests and before deploy.

## 5. Verify tables

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('runs','runtime_snapshots','execution_plans') ORDER BY name;"
```

Expected:

```text
execution_plans
runs
runtime_snapshots
```

## 6. Production API gate

Use a real `READY` scenario.

```http
POST /v1/console/projects/:projectId/runs
Authorization: Bearer <console session>
Idempotency-Key: run-smoke-<uuid>
Content-Type: application/json
```

```json
{
  "contractVersion": "qagent.run-create.v1",
  "testDesignVersionId": "tdv_...",
  "environmentId": "env_...",
  "scenarioIds": ["test_001"]
}
```

Expected:

```text
HTTP 201
status = ok
data.contractVersion = qagent.run.v1
data.run.status = CREATED
data.run.testDesignVersionId = requested tdv_*
data.executionPlan.contractVersion = qagent.execution-plan.v1
data.runtime.contractVersion = qagent.runtime-snapshot.v1
```

No request is executed against the customer API in 07.7.2.

## 7. Idempotency gate

Repeat the same POST with the same `Idempotency-Key` and same payload.

Expected:

```text
same runId
idempotentReplay = true
```

Change the payload and keep the same key.

Expected:

```text
HTTP 409
RUN_IDEMPOTENCY_CONFLICT
```

## 8. Non-READY gate

Try to create a Run selecting a `NEEDS_DATA` or `REVIEW_REQUIRED` scenario.

Expected:

```text
HTTP 409
RUN_SCENARIO_NOT_EXECUTABLE
```

No Run should be created.

## 9. Retrieval gate

```http
GET /v1/console/projects/:projectId/runs/:runId
```

Expected:

```text
CREATED
same pinned tdv_*
same Environment
executionPlanId present
runtimeSnapshotId present
no secret plaintext
```

## 10. D1 verification

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT run_id, status, test_design_version_id, environment_id, scenario_count, execution_plan_id, runtime_snapshot_id FROM runs ORDER BY created_at DESC LIMIT 10;"
```

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT execution_plan_id, run_id, contract_version, scenario_count, schema_snapshot_count, plan_hash FROM execution_plans ORDER BY created_at DESC LIMIT 10;"
```

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT runtime_snapshot_id, run_id, contract_version, resolution_source, resolution_confidence, requires_execution_confirmation, snapshot_hash FROM runtime_snapshots ORDER BY created_at DESC LIMIT 10;"
```

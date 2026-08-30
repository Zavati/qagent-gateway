# APPLY — QAgent 07.7.10-B FIX-3.1

## Scope

Deploy **Gateway first**, then Runner.

No Test Registry, Results Plane or Console deploy is required by FIX-3.1.

There is **no D1 migration**.

Keep business mutation HTTP disabled during the recovery validation:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

## 1. qagent-gateway — deploy first

The Gateway must be first because it:
- accepts the corrected `/rejected` phases;
- terminalizes `RUNNING` Runs on permanent rejection;
- becomes consumer of `qagent-run-dlq`;
- can recover existing DLQ messages and unstick existing Suite Runs.

Commands:

```bash
npm ci
npm run check:07.7.10-b-fix-3-1
npm run deploy
```

There is no migration command for this Foundation.

### Important queue configuration

`qagent-run-dlq` already exists as the dead-letter queue of `qagent-run-requests`. FIX-3.1 attaches the Gateway as its consumer through `wrangler.jsonc`.

After deploy, tail Gateway:

```bash
npx wrangler tail qagent-gateway --format pretty
```

If old DLQ messages are still retained, expect logs similar to:

```text
run_dlq_terminalized
status=ERROR
suiteRunStatus=ERROR
```

The previously stuck Suite Run should leave `RUNNING` once all dead-lettered children are reconciled.

## 2. qagent-runner — deploy second

Keep:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

Commands:

```bash
npm ci
npm run check:07.7.10-b-fix-3-1
npm run deploy
```

Health:

```bash
curl https://<runner-health-route>/health
```

Expected relevant fields:

```text
foundation = 07.7.10-B-FIX-3.1
rejectionDiagnosticsVersion = qagent.runner-rejection-diagnostics.v1
dlqTerminalRecoveryOwner = GATEWAY_RUN_CONTROL_PLANE
mutationHttpEnabled = false
```

## 3. Validate stuck Suite recovery

For the Suite that previously remained at `2/6`, refresh the Console after Gateway has consumed retained DLQ messages.

Expected conceptual state:

```text
ERROR
2 PASSED
4 ERROR
0 active
```

Exact counters depend on which DLQ messages remain retained at deploy time.

If the old DLQ messages are no longer retained, the fix will protect all new Runs, but the historical stuck Suite may require a one-off reconciliation using its child Run IDs.

## 4. Validate normal permanent rejection

Before enabling mutation HTTP, execute a scenario known to fail before dispatch (or keep the mutation kill switch false).

A permanent error should now follow:

```text
run_permanent_rejection
  originalErrorCode=...
  originalPhase=...

Gateway /rejected → OK

run_queue_rejected_permanent
```

It must **not** repeatedly retry merely because the phase contract was rejected.

## 5. Re-enable a single STG mutation only after recovery passes

Once Gateway/Runner recovery is validated:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=true
```

Deploy Runner only, then execute **one isolated safe STG mutation**, preferably `happy_path_001`.

Tail both services:

```bash
npx wrangler tail qagent-gateway --format pretty
npx wrangler tail qagent-runner --format pretty
```

If the same pre-dispatch issue still exists, FIX-3.1 should now reveal the real phase/code through `run_mutation_dispatch_failed` instead of only `RUNNER_TRANSIENT_ERROR`.

## Emergency stop

At any unexpected behavior:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

Deploy Runner configuration. Environment Mutation Policies may also be changed to `DENY`.

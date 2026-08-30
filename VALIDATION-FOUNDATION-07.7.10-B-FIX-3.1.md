# VALIDATION — QAgent 07.7.10-B FIX-3.1

## Gate A — Artifact/local

Expected:

```bash
# Gateway
npm run check:07.7.10-b-fix-3-1

# Runner
npm run check:07.7.10-b-fix-3-1
```

Both must pass.

## Gate B — No migration drift

FIX-3.1 creates no migration.

Gateway migrations `0001–0017` must match the FIX-3 baseline byte-for-byte.

## Gate C — Queue ownership

Runner:

```text
consumer: qagent-run-requests
dead_letter_queue: qagent-run-dlq
```

Gateway:

```text
consumer: qagent-suite-run-orchestration
consumer: qagent-run-dlq
```

There must not be two independent DLQ consumers competing to terminalize the same Run.

## Gate D — Existing DLQ recovery

Deploy Gateway first and tail it.

For retained messages, expected:

```text
run_dlq_terminalized
```

Verify Run Control D1:

```sql
SELECT run_id, status, updated_at
FROM runs
WHERE run_id IN (
  'run_c0e8c4e0-296e-4eff-a1ef-780f48370d9d',
  'run_1d5af946-7cc0-431d-ae9f-815843a7d06e',
  'run_8dcc9df8-f912-4231-a14d-7b35bfb8563e',
  'run_fe6acc8f-5bac-46c7-90bf-ae40f48ee3e3'
);
```

Expected for recovered dead-letter children:

```text
status = ERROR
```

Verify mutation journals:

```sql
SELECT
  mutation_execution_id,
  run_id,
  scenario_id,
  state,
  network_dispatch_may_have_occurred,
  last_error_code
FROM mutation_execution_journal
WHERE run_id IN (
  'run_c0e8c4e0-296e-4eff-a1ef-780f48370d9d',
  'run_1d5af946-7cc0-431d-ae9f-815843a7d06e',
  'run_8dcc9df8-f912-4231-a14d-7b35bfb8563e',
  'run_fe6acc8f-5bac-46c7-90bf-ae40f48ee3e3'
);
```

Because the observed Runs never reached `DISPATCHING`, retained `PREPARED` journals should converge to:

```text
FAILED_BEFORE_DISPATCH
network_dispatch_may_have_occurred = 0
```

## Gate E — Suite recovery

Check the previously stuck Suite:

```text
srun_6376770b-ac99-4a2e-8ad8-92c01e4be5b7
```

Expected once all retained dead-letter children are reconciled:

```text
status = ERROR
active = 0
```

The Console must stop polling it as forever `RUNNING`.

## Gate F — Rejection diagnostics

With Runner FIX-3.1 deployed, any failure near mutation dispatch must expose:

```text
run_mutation_dispatch_failed
  phase=...
  errorCode=...
  mutationExecutionId=mex_...
  journalState=...
  dispatchRecorded=false|true
```

For a permanent error:

```text
run_permanent_rejection
  originalErrorCode=...
  originalPhase=...
```

If Gateway persistence fails, the secondary log must preserve both original and persistence failures.

## Gate G — One mutation retest

Only after Gates D–F are healthy:

1. choose one safe STG mutation;
2. enable `RUNNER_MUTATION_EXECUTION_ENABLED=true`;
3. execute one isolated `happy_path_001`;
4. do not run the full Suite for the first retest.

Success path:

```text
PREPARED
→ DISPATCHING
→ business HTTP
→ RESPONSE_RECEIVED
→ assertions
→ results
→ COMPLETED
```

If it fails before `DISPATCHING`, no business POST should have been sent and the new diagnostics must identify the exact failure.

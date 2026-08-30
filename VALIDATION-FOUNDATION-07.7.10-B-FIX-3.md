# VALIDATION — QAgent 07.7.10-B FIX-3

## Local regression gates

Run:

```bash
# Gateway
npm run check:07.7.10-b-fix-3

# Runner
npm run check:07.7.10-b-fix-3

# Results
npm run check:07.7.10-b-fix-3

# Console
npm run check:07.7.10-b-fix-3
npm run build
```

## Real STG validation sequence

Keep two tails open:

```bash
npx wrangler tail qagent-gateway --format pretty
npx wrangler tail qagent-runner --format pretty
```

### Gate A — kill switch protection

Policy = ALLOW, Runner mutation switch = false.

Expected Runner sequence:

```text
run_mutation_preflight_summary decision=ALLOW mutationExecutionId=mex_*
RUNNER_HTTP_SIDE_EFFECT_METHOD_DISABLED
```

No business HTTP request must be emitted.

### Gate B — first controlled POST

Only after Gate A passes, set:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=true
```

For one safe/disposable STG POST with `NO_AUTOMATIC_RETRY`, expected sequence:

```text
run_mutation_preflight_summary
  decision=ALLOW
  journalState=PREPARED
  mutationExecutionId=mex_*

run_mutation_dispatching
  journalState=DISPATCHING

run_mutation_response_received
  statusCode=<real status>
  journalState=RESPONSE_RECEIVED

run_http_scenario_result
  method=POST
  outcome=RESPONSE

run_assertion_execution_summary
  outcome=PASSED|FAILED

run_results_ingestion_summary
  resultSetId=rset_*

run_mutation_completed
  mutationExecutionId=mex_*
```

Validate Gateway D1:

```sql
SELECT
  mutation_execution_id,
  run_id,
  scenario_id,
  method,
  canonical_path,
  retry_mode,
  state,
  http_status_code,
  assertion_outcome,
  network_dispatch_may_have_occurred,
  created_at,
  updated_at
FROM mutation_execution_journal
ORDER BY created_at DESC
LIMIT 20;
```

Expected for a known response: `COMPLETED`.

Validate Results D1:

```sql
SELECT
  result_set_id,
  scenario_id,
  mutation_execution_id,
  retry_mode,
  side_effect_state,
  created_at
FROM scenario_mutation_refs
ORDER BY created_at DESC
LIMIT 20;
```

Expected: same `mex_*` as Gateway Journal.

### Gate C — authenticated mutation

For an endpoint requiring Auth Runtime, confirm:

```text
run_auth_runtime_summary
resolvedProfileCount >= 1
```

and that `DISPATCHING` occurs only after policy/preflight and immediately before the actual business HTTP request.

### Gate D — PUT

Repeat with a safe STG PUT. Use disposable/reversible data. Expected same state machine.

### Gate E — PATCH

Run only if a real, safe PATCH endpoint exists. Do not create an artificial endpoint just to satisfy the gate.

### Gate F — DELETE

Use only disposable data created for the validation. Do not target shared/production-like records.

## Retry-safety validation

### NO_AUTOMATIC_RETRY

Simulate/observe a transport failure after durable `DISPATCHING` and before response certainty.

Expected:

```text
UNKNOWN_SIDE_EFFECT
MUTATION_SIDE_EFFECT_UNKNOWN
queue retry = 0 for the business mutation
```

Do not automatically re-run that side effect.

### IDEMPOTENCY_HEADER

Use only an API known to honor the configured header.

Expected on timeout/network uncertainty:

```text
MUTATION_IDEMPOTENT_RETRY_REQUIRED
Queue redelivery allowed
same mex_*
same Idempotency-Key hash
same dispatch fingerprint
```

The actual Idempotency-Key value must not appear in logs or databases.

## Production validation result

Mark FIX-3 `PRODUCTION VALIDATED` only after at least one real STG business mutation completes through:

```text
Policy ALLOW
-> PREPARED
-> DISPATCHING
-> HTTP real
-> RESPONSE_RECEIVED
-> Assertions
-> Results
-> COMPLETED
```

and the no-blind-retry invariant has been verified.

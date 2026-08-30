# APPLY — QAgent 07.7.10-B FIX-3

## Deployment order

### 1. qagent-test-results

Preserve the real `RESULTS_DB.database_id` already configured in your repository. The distributable may contain a placeholder.

```bash
npm ci
npm run check:07.7.10-b-fix-3
npx wrangler d1 migrations list RESULTS_DB --remote
npx wrangler d1 migrations apply RESULTS_DB --remote
npm run deploy
```

Verify:

```bash
npx wrangler d1 execute RESULTS_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name='scenario_mutation_refs';"
```

Expected: `scenario_mutation_refs`.

### 2. qagent-gateway

```bash
npm ci
npm run check:07.7.10-b-fix-3
npx wrangler d1 migrations list QAGENT_DB --remote
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Do not edit/replay migrations 0001–0016. FIX-3 is migration 0017 only.

Verify:

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="PRAGMA table_info(mutation_execution_journal);"
```

Expected new columns:
- `dispatch_fingerprint`
- `assertion_outcome`

### 3. qagent-runner — SAFE DEPLOY FIRST

Deploy with mutation HTTP still disabled:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

Then:

```bash
npm ci
npm run check:07.7.10-b-fix-3
npm run deploy
```

Health should identify Foundation `07.7.10-B-FIX-3` and show:

```text
mutationSafetyEnabled=true
mutationJournalRequired=true
mutationPermitRequired=true
mutationHttpEnabled=false
businessMutationHttpStatus=CONTROLLED_READY_KILL_SWITCH_OFF
legacySideEffectToggleAuthority=false
```

### 4. qagent-console

```bash
npm ci
npm run check:07.7.10-b-fix-3
npm run build
npm run deploy
```

`npm run build` is mandatory in repository/CI. It could not be completed in the artifact-generation environment because dependency installation timed out.

### 5. qagent-test-registry

No FIX-3 deployment required.

## Safe rollout to first real STG mutation

1. Keep Runner kill switch `false`.
2. Choose one disposable/non-critical STG mutation endpoint.
3. In Mutation Governance set only that endpoint/method to `ALLOW`.
4. Prefer `NO_AUTOMATIC_RETRY` unless the target API is explicitly documented to support an idempotency header.
5. Execute once with kill switch still false. Expected: preflight ALLOW + `mex_*`, but HTTP blocked.
6. Confirm Journal row exists and has no sensitive values.
7. Set Runner `RUNNER_MUTATION_EXECUTION_ENABLED=true` and deploy only Runner configuration.
8. Execute the same isolated mutation once.
9. Inspect Runner/Gateway tails and Results.
10. Immediately set the kill switch back to `false` if behavior diverges from expected.

## Rollback / emergency stop

The fastest emergency stop is:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

This disables all business POST/PUT/PATCH/DELETE regardless of Environment Policy.

You can additionally set the specific Environment Mutation Policy to `DENY`.

# APPLY — QAgent 07.7.10-B FIX-2

## Deployment order

### 1. qagent-test-registry

No new D1 migration in FIX-2.

```bash
npm ci
npm run check:07.7.10-b-fix-2
npm run deploy
```

After deploy, materializing the Auto Suite should create a new immutable Suite Version when the previous version used selection policy v1.1. The new version must report:

```text
selectionPolicyVersion = qagent.suite-selection-policy.v2
selectionPolicy        = LATEST_TEST_DESIGNS_READY_SCENARIOS
```

The Suite now includes all semantic READY scenarios, including mutations.

### 2. qagent-gateway

Apply only the new migration through Wrangler. Do not edit migration history manually.

```bash
npm ci
npm run check:07.7.10-b-fix-2
npx wrangler d1 migrations list QAGENT_DB --remote
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

Verify:

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mutation_execution_policies','mutation_execution_policy_versions','mutation_execution_journal','mutation_execution_events','suite_run_execution_units') ORDER BY name;"
```

### 3. qagent-runner

Keep business mutation HTTP locked:

```text
RUNNER_MUTATION_EXECUTION_ENABLED=false
```

Deploy:

```bash
npm ci
npm run check:07.7.10-b-fix-2
npm run deploy
```

Do not enable `RUNNER_MUTATION_EXECUTION_ENABLED` in FIX-2.

### 4. qagent-console

```bash
npm ci
npm run check:07.7.10-b-fix-2
npm run build
npm run deploy
```

`npm run build` is a mandatory production gate in the real repository/CI.

## No deploy required

`qagent-test-results` is unchanged by FIX-2.

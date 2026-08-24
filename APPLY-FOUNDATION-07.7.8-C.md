# Apply — Foundation 07.7.8-C Test Data Runtime

## Gate 0 — package

Before deploy:

```bash
# must not contain
node_modules/
.git/
.env
.wrangler/
```

Verify SHA-256 against the delivered `SHA256SUMS-FOUNDATION-07.7.8-C.txt`.

## 1. Gateway — tests before migration

```bash
npm ci
npm run check:07.7.8-c
```

Expected: all Foundation regressions through 07.7.8-C PASS.

## 2. D1 migration

Apply the new migration to the same Gateway D1 used by Run Control Plane:

```bash
npm run db:migrations:apply
```

For environments where the original 0013 was already applied, the new pending evolution migration is:

```text
0014_foundation_07_7_8_c_scope_hierarchy.sql
```

Do not edit/replay 0013. See `APPLY-FOUNDATION-07.7.8-C-FIX-1.md`.

After apply, confirm:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name = 'test_data_bindings';
```

And:

```sql
PRAGMA table_info(run_execution_attempts);
```

Expected columns include:

```text
test_data_runtime_status
test_data_binding_count
test_data_generated_count
test_data_fixed_count
test_data_secret_count
test_data_duration_ms
test_data_resolved_at
```

## 3. Gateway deploy

```bash
npm run deploy
```

Do not change Secret Vault master keys or Runner Control HMAC contract.

## 4. Runner

```bash
npm ci
npm run check:07.7.8-c
npm run deploy
```

Required runtime flags:

```text
RUNNER_TEST_DATA_RUNTIME_ENABLED=true
RUNNER_HTTP_EXECUTION_ENABLED=true
RUNNER_ASSERTION_ENGINE_ENABLED=true
RUNNER_AUTH_RUNTIME_ENABLED=true
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

`RUNNER_CONTROL_HMAC_SECRET` remains a Worker secret and must match Gateway Runner Control. Do not place Secret Vault master keys in Runner.

## 5. Console

The delivered Console artifact is a patch, not a standalone application.

Apply these files onto the current qagent-console repository, then run in the real repo:

```bash
npm ci
npm run test:f07-7-8-c
npm run build
npm run deploy
```

UI expected in Endpoint Detail:

```text
Variáveis de execução
scope: Project / Environment / Endpoint
source: Generated / Fixed / Secret
```

## 6. Production smoke order

Keep side-effect methods disabled.

### Smoke A — FIXED, read-only

Use a real GET endpoint with a referential path parameter, for example the already observed classroom/progress pattern if it remains valid.

1. Create `PATH_PARAM` FIXED for the real identifier.
2. Prefer `ENDPOINT + STG` for the first smoke.
3. Regenerate the Test Design.
4. Confirm the scenario becomes READY because of Test Data only.
5. Run in STG.
6. Expect HTTP response/assertions to complete without a Test Data failure.

### Smoke B — precedence

For a safe field:

1. configure PROJECT fallback;
2. configure ENVIRONMENT override;
3. optionally configure ENDPOINT override for the same Environment;
4. create a Run for that Environment;
5. confirm the frozen Runtime Snapshot selected the highest applicable scope.

Never validate precedence with a password/token-like selector.

### Smoke C — GENERATED, read-only only

Use a GET endpoint only if it has a safely modelled non-referential query/input that the current semantic contract permits. Confirm repeated attempt/retry for the same Run produces identical request materialization.

If no safe read-only endpoint exists, do NOT enable POST/PUT/PATCH/DELETE just to pass this smoke. Keep the production gate pending for the generated-network portion; local deterministic tests remain valid.

### Smoke D — SECRET boundary

Attempting to create:

```text
BODY $.password + FIXED
```

must fail with:

```text
TEST_DATA_SECRET_SOURCE_REQUIRED
```

Configuring the same selector as SECRET must store it through Secret Vault and API responses must return only `secretConfigured`, never the plaintext.

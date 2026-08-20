# Apply — Foundation 07.6.5-C

## 1. Preconditions

- `qagent-test-registry` 07.6.5-B deployed.
- migration `0001_test_registry_foundation.sql` applied remotely.
- Registry health already validated.
- Gateway snapshot immediately before 07.6.5-C is working in production.

## 2. Install and validate

```bash
npm ci
npm run check:07.6.5-c
npm run test:all
```

## 3. Deploy Gateway

```bash
npm run deploy
```

The `TEST_REGISTRY_SERVICE` binding targets Worker `qagent-test-registry`.

Do not expose:

```text
api.apiqagent.com/v1/test-registry/*
```

The existing public health route may remain independently configured on the Registry Worker.

## 4. Production gate

Generate a Test Design through the existing Console/Gateway POST.

Expected response includes:

```json
"testDesign": {
  "id": "td_...",
  "versionId": "tdv_...",
  "version": 1,
  "persisted": true
}
```

Then verify D1 from the Registry repository:

```bash
npx wrangler d1 execute TEST_REGISTRY_DB --remote --command="SELECT id, organization_id, project_id, endpoint_id, latest_version, latest_version_id, created_at, updated_at FROM test_designs ORDER BY updated_at DESC LIMIT 10;"
```

```bash
npx wrangler d1 execute TEST_REGISTRY_DB --remote --command="SELECT id, test_design_id, version, generation_request_id, context_fingerprint, contract_version, specification_version, provider, model, prompt_version, repair_prompt_version, guard_version, scenario_count, ready_count, review_required_count, created_at FROM test_design_versions ORDER BY created_at DESC LIMIT 10;"
```

Do not select `specification_json` during routine production validation unless it is specifically needed for contract inspection.

## 5. Regeneration gate

Generate the same endpoint again.

Expected:

```text
same test_design root
Version 2 created
Version 1 preserved
latest_version = 2
```

## 6. Failure gate (optional controlled environment)

If `TEST_REGISTRY_SERVICE` is unavailable, the POST must return:

```text
HTTP 503
TEST_DESIGN_PERSISTENCE_FAILED
details.retryable = true
```

and must not pretend the generation was saved.

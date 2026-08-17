# APPLY — Foundation 07.6.1 Test Design Contract v1

## Scope

Contract-only Gateway snapshot. There is no runtime route, migration, secret, binding, Catalog fetch or LLM invocation in this increment.

## Apply

Use the ZIP as the new Gateway snapshot while preserving the local `.git` directory.

Do not copy generated/local folders from an older checkout over this snapshot.

## Validate

```bash
npm ci
npm run test:f07-6-1
npm run test:all
```

Optional syntax checks:

```bash
node --check src/intelligence/testDesignContract.js
node --check test/test-foundation-07-6-1-test-design-contract.js
```

## Deploy smoke

A deploy is safe because no existing route behavior changes. After deploy, smoke the already validated Gateway endpoints used by the project, especially Console auth and Catalog proxy.

No new public endpoint is expected in 07.6.1.

## Contract files

```text
src/intelligence/testDesignContract.js
docs/FOUNDATION-07.6.1-TEST-DESIGN-CONTRACT-v1.md
docs/contracts/test-design-model-output-v1.schema.json
```

## Next

07.6.2 — Catalog Context Builder:

```text
Gateway tenant/project authority
  ↓
Catalog endpoint + schemas + bounded evidence
  ↓
Control Plane runtime service/auth metadata (non-secret)
  ↓
CatalogTestDesignContextV1
```

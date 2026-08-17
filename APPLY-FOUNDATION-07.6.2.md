# Apply — Foundation 07.6.2 Catalog Context Builder

## 1. Replace source snapshot

Apply this ZIP over the previously validated Foundation 07.6.1 Gateway snapshot while preserving `.git` and deployment secrets.

The ZIP intentionally excludes:

```text
.git/
node_modules/
.wrangler/
.dev.vars
.env*
coverage/
*.log
```

## 2. Install and test

```bash
npm ci
npm run test:f07-6-1
npm run test:f07-6-2
npm run test:catalog-proxy
npm run test:router
npm run test:all
```

## 3. Migration

No D1 migration is introduced by 07.6.2.

## 4. Configuration

No new secret/binding is introduced.

The existing Catalog integration must remain configured:

```text
CATALOG_QUERY_HMAC_SECRET
CATALOG_QUERY_SERVICE
```

## 5. Deploy

Use the existing Gateway deployment pipeline.

## 6. Real validation

Choose a real Catalog `endpointId` from the Console and call:

```http
GET https://api.apiqagent.com/v1/console/projects/<PROJECT_ID>/intelligence/endpoints/<ENDPOINT_ID>/test-design-context
Authorization: Bearer <CONSOLE_SESSION_TOKEN>
```

Expected:

```json
{
  "status": "ok",
  "data": {
    "context": {
      "contractVersion": "qagent.test-design.v1"
    },
    "contextFingerprint": "<64 hex>",
    "diagnostics": {
      "builderVersion": "qagent.catalog-context-builder.v1"
    }
  }
}
```

Validate:

- endpoint method/path match the Catalog Detail screen;
- `schemas[]` reference real Catalog Schema IDs/hashes;
- `evidence[]` reference real Evidence IDs;
- environment names match the Project configuration;
- `contextFingerprint` is 64 lowercase hex;
- repeating the call without data/config changes returns the same fingerprint;
- no secret values/base URLs/tokens appear in the response.

### Runtime mapping interpretation

```text
MATCHED
→ context.runtime.apiServiceKey contains the logical runtime service.

UNMATCHED
→ no configured API Service origin matches the observed Catalog bindings.

PARTIAL
→ a service matches only some observed environments.

AMBIGUOUS
→ more than one configured service matches equally; QAgent refuses to guess.
```

`apiServiceKey = null` is valid and must not be manually patched into the response. It will produce `NEEDS_ENVIRONMENT` readiness in later Test Specifications.

### Auth interpretation

If exactly one enabled Auth Profile has credentials configured for every observed environment:

```text
defaultAuthProfileRef = authp_...
```

If zero or multiple profiles qualify:

```text
defaultAuthProfileRef = null
```

This is intentional. No credentials are returned by this route.

## 7. No expected UI change

07.6.2 adds a backend/read-only Intelligence context route. The QAgent Intelligence Console UI comes in a later subphase.

# Deploy / Verify — Foundation 07.5.12-A

## Before deploy
1. Keep the current Gateway `QAGENT_DB` / KV IDs.
2. Configure `CATALOG_QUERY_HMAC_SECRET` on qagent-gateway with the exact same value used by qagent-catalog.
3. Do not put the secret in `wrangler.jsonc` or Git.

## Local checks
```bash
npm run check:07.5.12-a
npm test
```

## Deploy
```bash
npx wrangler deploy
```

## Production smoke
Use the existing Console Bearer session token; no HMAC headers are sent by the client.

```bash
curl 'https://api.apiqagent.com/v1/console/projects/PROJECT_ID/catalog/summary' \
  -H 'Authorization: Bearer CONSOLE_SESSION_TOKEN'
```

Expected: HTTP 200 and the same `status/data` contract returned by Catalog `/summary`.

Then validate:
- `/catalog/services?limit=20`
- `/catalog/endpoints?classification=FIRST_PARTY_API&limit=20`
- `/catalog/endpoints/:endpointId`
- `/catalog/endpoints/:endpointId/evidence?limit=20`
- `/catalog/endpoints/:endpointId/schemas`
- `/catalog/endpoints/:endpointId/lifecycle-history?limit=20`

## Negative cases
- No/invalid Console Bearer: 401 from Gateway session auth.
- Project outside tenant: 404 `PROJECT_NOT_FOUND`.
- Gateway/Catalog HMAC secret mismatch: 502 `CATALOG_UPSTREAM_AUTH_FAILED`.
- Catalog timeout: 504 `CATALOG_UPSTREAM_TIMEOUT`.


## Secret deployment guard

`wrangler.jsonc` declares:

```json
"secrets": {
  "required": ["CATALOG_QUERY_HMAC_SECRET"]
}
```

The value must already exist as an encrypted Worker secret in Cloudflare.
The value must not be placed under `vars` or committed to Git.


## Service Binding

The deploy output must list a service binding similar to:

```text
env.CATALOG_QUERY_SERVICE (qagent-catalog)  Worker
```

Gateway→Catalog requests must no longer use a same-zone public network hop.

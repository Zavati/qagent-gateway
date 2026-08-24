# Apply — Foundation 07.7.9-C — qagent-gateway

## Required Service Binding

```json
{
  "binding": "RESULTS_SERVICE",
  "service": "qagent-test-results"
}
```

Recommended bounded timeout:

```json
"RESULTS_READ_TIMEOUT_MS": "10000"
```

Do not add a top-level `secrets.required` metadata block. Cloudflare Worker Secrets remain configured with `wrangler secret put` and are not changed by this Foundation.

## Apply

Deploy `qagent-test-results` 07.7.9-C first, then Gateway:

```bash
npm ci
npm run check:07.7.9-c
npm run deploy
```

No Gateway D1 migration is required for 07.7.9-C.

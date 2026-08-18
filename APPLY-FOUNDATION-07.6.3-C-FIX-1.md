# Apply — Foundation 07.6.3-C Fix 1
## AI Repair Timeout & Latency Hardening

Apply this snapshot over the validated Foundation 07.6.3-C snapshot while preserving `.git`.

## Install / test

```bash
npm ci
npm run test:f07-6-1
npm run test:f07-6-2
npm run test:f07-6-3
npm run test:f07-6-3-c
npm run test:router
npm run test:all
```

No migration is required.
No binding is required.
No secret is required.

## Optional configuration

The repair timeout now defaults to 60 seconds, so no environment change is required for the first validation.

Optional override:

```text
TEST_DESIGN_REPAIR_TIMEOUT_MS=60000
```

Allowed range: 20000–90000 ms.

The primary generation timeout remains:

```text
TEST_DESIGN_TIMEOUT_MS=90000
```

## Production validation

Repeat the same real request:

```http
POST /v1/console/projects/<projectId>/intelligence/endpoints/<endpointId>/test-design
Authorization: Bearer <console session>
```

Expected successful path:

```text
generate
→ optional single repair
→ structural validation
→ Semantic Grounding Guard
→ TestSpecificationV1
→ HTTP 200
```

If the provider still exceeds the repair timeout, the expected response is now:

```json
{
  "status": "error",
  "code": "AI_UPSTREAM_TIMEOUT",
  "message": "O provider de IA excedeu o tempo limite durante a geração do Test Design.",
  "details": {
    "provider": "openai",
    "stage": "contract-repair",
    "timeoutMs": 60000,
    "retryable": true
  }
}
```

The Worker should also emit `testDesign_ai_timeout`.

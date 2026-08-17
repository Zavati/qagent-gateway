# APPLY — Foundation 07.6.3-C Semantic Grounding Guard

## Baseline

Apply this snapshot over the validated:

```text
qagent-gateway Foundation 07.6.3 Fix 2
```

Preserve `.git` when replacing locally.

## Changes

New:

```text
src/intelligence/semanticGroundingGuard.js
test/test-foundation-07-6-3-c-semantic-grounding-guard.js
FOUNDATION-07.6.3-C.md
APPLY-FOUNDATION-07.6.3-C.md
```

Updated:

```text
src/intelligence/testDesignService.js
src/intelligence/testDesignContract.js
src/intelligence/testDesignPrompt.js
package.json
```

## Infrastructure

No D1 migration.

No new Worker binding.

No new secret.

No new route.

The existing production route remains:

```http
POST /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design
```

## Validation

```bash
npm ci

npm run test:f07-6-1
npm run test:f07-6-2
npm run test:f07-6-3
npm run test:f07-6-3-c
npm run test:router
npm run test:all
```

Then deploy Gateway using the existing process.

## Real validation

Repeat the same production POST used to validate Foundation 07.6.3.

Expected behavioral difference:

- valid observed happy path/schema scenarios remain usable;
- invented exact values become `NEEDS_DATA`;
- unmodeled request shapes/auth assumptions become `REVIEW_REQUIRED`;
- runtime mapping may still be `UNMATCHED`, but semantic blockers take precedence where applicable;
- response contains `diagnostics.semanticGuard`.

For the first real endpoint used in 07.6.3, a healthy result should no longer present all eight scenarios merely as `NEEDS_ENVIRONMENT`. The semantic guard should distinguish grounded scenarios from data/review-dependent scenarios.

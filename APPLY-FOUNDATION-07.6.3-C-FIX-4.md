# Apply — Foundation 07.6.3-C Fix 4
## Semantic Primitive & Container Type Capability Guard

Apply this snapshot over the validated Foundation 07.6.3-C Fix 3 snapshot while preserving `.git`.

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
No new route is introduced.

## Production validation

Repeat the same request already validated in production:

```http
POST /v1/console/projects/<projectId>/intelligence/endpoints/<endpointId>/test-design
Authorization: Bearer <console session>
```

Inspect:

```text
data.diagnostics.promptVersion
→ qagent.test-design-prompt.v5

data.diagnostics.semanticGuard.guardVersion
→ qagent.semantic-grounding-guard.v1.2
```

If the model produces an objective such as:

```text
"count exists and is an integer"
```

with only:

```text
JSON_PATH_EXISTS $.count
```

expect:

```text
SEMANTIC_ASSERTION_CAPABILITY_GAP
→ REVIEW_REQUIRED
```

The same applies to explicit `number`, `string`, `array` and `object` type claims.

A matching `SCHEMA` assertion remains the supported DSL v1 mechanism for proving structural type/format.

## Expected quality improvement

Two outcomes are valid:

1. Prompt v5 generates a real `SCHEMA` assertion for type claims or consolidates them into a schema-contract scenario; or
2. the model still uses presence-only assertions and the Guard marks the scenario `REVIEW_REQUIRED`.

The QAgent must never present `JSON_PATH_EXISTS` as proof of primitive/container type.

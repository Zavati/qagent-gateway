# Apply — Foundation 07.6.3-C Fix 3
## Semantic Assertion Capability Guard

Apply this snapshot over the validated Foundation 07.6.3-C Fix 2 snapshot while preserving `.git`.

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
→ qagent.test-design-prompt.v4

data.diagnostics.semanticGuard.guardVersion
→ qagent.semantic-grounding-guard.v1.1
```

If the model still produces objectives stronger than their assertions, expect:

```text
SEMANTIC_ASSERTION_CAPABILITY_GAP
```

Typical examples:

```text
"count is correct" + JSON_PATH_EXISTS($.count)
→ REVIEW_REQUIRED

"list is not empty" + JSON_PATH_EXISTS($.contents)
→ REVIEW_REQUIRED

"id is UUID" + JSON_PATH_EXISTS($.contents[*].id)
→ REVIEW_REQUIRED
```

A type/format claim can remain executable when an applicable `SCHEMA` assertion references structural schema that actually models the claimed type/format.

## Expected quality improvement

Two outcomes are both valid:

1. Prompt v4 prevents the weak scenarios from being generated; or
2. the model still generates them and the Guard marks them `REVIEW_REQUIRED` with an explicit capability blocker.

In neither case should the QAgent present a presence-only assertion as proof of UUID/type/date/cardinality/relational correctness.

# Apply — Foundation 07.6.3-C Fix 2
## Semantic Executability Guard — Target Mutation + Fault Injection

Apply this snapshot over the validated Foundation 07.6.3-C Fix 1 timeout snapshot while preserving `.git`.

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

For a generation containing the same classes of scenarios previously observed, inspect:

```text
data.diagnostics.promptVersion
→ qagent.test-design-prompt.v3

data.diagnostics.semanticGuard.issuesByCode
```

Expected when applicable:

```text
SEMANTIC_TARGET_MUTATION_UNSUPPORTED
SEMANTIC_FAULT_INJECTION_UNSUPPORTED
```

Expected scenario behavior:

```text
invalid path / invalid method
→ ASSUMED / LOW / REVIEW_REQUIRED
→ blocker explains that method/path are fixed by qagent.api-test-dsl.v1

internal server failure / forced 500
→ ASSUMED / LOW / REVIEW_REQUIRED
→ blocker explains that fault injection/mock/setup is not supported by DSL v1
```

The final `spec.target.method` and `spec.target.path` must remain the method/path of the Catalog endpoint.

# QAgent Foundation 07.6.3-C — Semantic Grounding Guard

**Status:** implementation snapshot for real-environment validation.

## Objective

Add a deterministic semantic validation layer between validated AI model output and `TestSpecificationV1`.

The Guard answers a different question from the structural contract validator:

- Contract validator: “Is this JSON structurally allowed?”
- Semantic Grounding Guard: “Is this scenario actually supported by the Catalog knowledge available to QAgent?”

The Guard never resolves secrets, never calls the AI provider, never changes tenant/project/endpoint/runtime target, and never invents Evidence or Schema references.

## Pipeline

```text
CatalogTestDesignContextV1
        ↓
AI provider
        ↓
wire normalization
        ↓
TestDesignModelOutputV1 structural validation
        ↓
Semantic Grounding Guard v1
        ↓
TestSpecificationV1
```

## Guard rules in v1

### Observed HTTP statuses

`OBSERVED` scenarios may use status expectations already present in Evidence. When a matching status exists but the model omitted its Evidence ref, QAgent may add one deterministic real Evidence ref.

Unobserved expected statuses cannot remain silently “observed”. They are marked for review and, when necessary, grounding/confidence are downgraded.

### Exact response values

Evidence v1 contains metadata, not response bodies. Therefore a literal such as:

```json
{"type":"JSON_PATH_EQUALS","path":"$.count","expected":5}
```

is not considered observed merely because a 200 Evidence exists.

Exact values are accepted as structurally supported only when the structural schema explicitly contains a compatible `const` or `enum`. Otherwise the scenario becomes data-dependent.

### JSONPath structural support

Simple structural paths such as `$.count` or `$.contents[*].id` can be checked against response schemas.

Value-dependent filters such as:

```text
$.contents[?(@.id == 'some-id')]
```

require controlled test data and cannot remain fully observed based only on schema metadata.

### Request shape

Catalog Context v1 does not model arbitrary query params or request headers. QAgent therefore does not silently accept model-invented query params/headers.

A body on GET/HEAD without an observed request schema is review-required.

For methods with an observed request schema, body shape may be inferred, but concrete values still require test data.

### Authentication

401/403 expectations with `authRequirement=NONE` are contradictory and require review.

Auth requirements that have neither observed auth signals nor configured Auth Profile metadata are not considered proven.

### Assertion coverage

A scenario whose objective claims to enforce latency/performance is not executable under `qagent.api-test-dsl.v1`, because DSL v1 currently has no latency assertion. Such scenarios are retained as ideas but become `REVIEW_REQUIRED`.

## Readiness precedence

The final readiness remains system-owned. Semantic blockers now take precedence over environment readiness so that configuring a Base URL does not make an unsupported scenario look executable.

```text
explicit semantic review → REVIEW_REQUIRED
needs controlled data     → NEEDS_DATA
assumed scenario           → REVIEW_REQUIRED
missing auth profile       → NEEDS_AUTH
missing runtime service    → NEEDS_ENVIRONMENT
otherwise                  → READY
```

All detected blockers remain visible in `automation.blockers`, up to the contract limit.

## Observability

When the Guard changes or annotates scenarios, Gateway emits:

```text
testDesign_semantic_guard_applied
```

Only safe diagnostics are logged:

- guard version
- endpoint ID
- context fingerprint
- changed scenario count
- issue count
- issue codes

No raw AI output, prompt, request body, credentials, secrets, or Evidence payload is logged.

The API response includes safe diagnostics under:

```text
data.diagnostics.semanticGuard
```

## First real-generation regression

The Guard was tested against the first successful 07.6.3 production generation pattern:

- exact `count = 5` assertion → data-dependent, no longer OBSERVED/HIGH
- fictitious ID in JSONPath filter → NEEDS_DATA
- unmodeled query param → REVIEW_REQUIRED
- GET body without request schema → REVIEW_REQUIRED
- unobserved 401 with `authRequirement=NONE` → REVIEW_REQUIRED
- latency objective without enforceable DSL assertion → REVIEW_REQUIRED

The two grounded contract/happy-path scenarios remain unchanged apart from deterministic Evidence enrichment when needed.

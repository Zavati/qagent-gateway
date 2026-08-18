# Foundation 07.6.3-C — Fix 2
## Semantic Executability Guard — Target Mutation + Fault Injection

Status: ready for real-environment validation.

## Problem observed

The first production Test Design already had the Semantic Grounding Guard active, but three scenarios remained semantically misleading as executable tests:

1. invalid path / route → expected 404;
2. invalid HTTP method → expected 405;
3. internal server failure → expected 500.

The final DSL target is system-owned and remained fixed to the discovered endpoint. Therefore the generated specification could not actually change the path/method or provoke the internal server failure it claimed to test.

## Root cause

`qagent.api-test-dsl.v1` intentionally protects the target:

- HTTP method comes from the Catalog endpoint;
- path comes from the Catalog endpoint;
- AI cannot replace either field;
- DSL v1 has no fault injection, upstream mock or setup primitive.

The previous Semantic Guard validated unobserved status codes but did not explicitly compare the *scenario intent* with those execution capabilities.

## Changes

### 1. Target mutation detection

The Guard now detects test intent that requires changing the discovered target, including invalid/non-existent path/route and invalid/unsupported HTTP method.

Issue code:

`SEMANTIC_TARGET_MUTATION_UNSUPPORTED`

Action:

- grounding is capped at `ASSUMED`;
- confidence is capped at `LOW`;
- `automationHints.reviewRequired=true`;
- final readiness becomes `REVIEW_REQUIRED`.

The Test Specification target remains unchanged and system-owned.

### 2. Fault injection detection

The Guard now detects scenarios that expect a 5xx while their intent depends on simulating/provoking an internal server failure.

Issue code:

`SEMANTIC_FAULT_INJECTION_UNSUPPORTED`

Action:

- grounding is capped at `ASSUMED`;
- confidence is capped at `LOW`;
- `automationHints.reviewRequired=true`;
- final readiness becomes `REVIEW_REQUIRED`.

The scenario is preserved as an investigation/recommendation idea, but it is not represented as executable automation.

### 3. Prompt hardening

Prompt version is now:

`qagent.test-design-prompt.v3`

The model is explicitly told that:

- target method/path are system-owned;
- DSL v1 does not support target mutation;
- DSL v1 does not support fault injection, mocks or setup capable of forcing an internal 500;
- such scenarios must not be presented as executable tests.

The Guard remains the final deterministic authority if the model ignores the prompt.

## Real-response replay

The production response from `/core-api/api-token-list` was replayed through Fix 2.

New detections:

- `get_token_list_invalid_path` → `SEMANTIC_TARGET_MUTATION_UNSUPPORTED`;
- `get_token_list_invalid_method` → `SEMANTIC_TARGET_MUTATION_UNSUPPORTED`;
- `get_token_list_server_error` → `SEMANTIC_FAULT_INJECTION_UNSUPPORTED`.

The two strong scenarios remained unchanged:

- successful list → `OBSERVED / HIGH`;
- observed Content-Type → `OBSERVED / HIGH`.

## Security and architecture invariants preserved

- AI cannot choose organization/project/endpoint target;
- method/path remain system-owned;
- no arbitrary URL/host/baseUrl;
- no code execution or script injection;
- no relaxation of Evidence/Schema refs;
- no new route, migration, binding or secret;
- one repair pass remains the maximum;
- Semantic Guard remains deterministic and does not invoke another AI call.

# Foundation 07.6.3-C — Fix 4
## Semantic Primitive & Container Type Capability Guard

Status: ready for real-environment validation.

## Problem observed

Fix 3 correctly detected capability gaps for UUID, boolean, date/date-time, non-empty arrays and relational count assertions. A subsequent real production generation exposed two remaining cases:

- objective: `count exists and is an integer` while the DSL only used `JSON_PATH_EXISTS $.count`;
- objective: `contents exists and is an array` while the DSL only used `JSON_PATH_EXISTS $.contents`.

`JSON_PATH_EXISTS` proves presence only. It does not prove primitive/container type.

## Changes

### 1. Primitive/container type capability detection

The Semantic Grounding Guard now also recognizes explicit type claims for:

- `integer` / `inteiro`;
- `number` / `numérico`;
- `string` / `texto`;
- `array` / `lista`;
- `object` / `objeto`.

When a scenario claims one of these types and only uses a JSONPath assertion to prove existence, the Guard adds:

`SEMANTIC_ASSERTION_CAPABILITY_GAP`

and sets:

`automationHints.reviewRequired=true`

Final readiness therefore becomes `REVIEW_REQUIRED`.

### 2. SCHEMA remains the valid proof mechanism

A type claim is not blocked when an applicable `SCHEMA` assertion references the observed structural schema and the JSONPath resolves to the claimed type.

Examples:

- `$.count` + `type=integer` + matching `SCHEMA` assertion -> supported;
- `$.contents` + `type=array` + matching `SCHEMA` assertion -> supported;
- `$.contents[*].name` + `type=string` + matching `SCHEMA` assertion -> supported;
- `$.contents[*]` + `type=object` + matching `SCHEMA` assertion -> supported.

The Guard does not invent or upgrade assertions.

### 3. Prompt hardening

Prompt version is now:

`qagent.test-design-prompt.v5`

The model is explicitly told that type claims for UUID, boolean, date/date-time, integer, number, string, array and object require an applicable `SCHEMA` assertion when the scenario claims to validate that type/format.

`JSON_PATH_EXISTS` continues to mean presence only.

### 4. Guard version

Diagnostics now report:

`qagent.semantic-grounding-guard.v1.2`

## Real production response replay

The latest successful production response for `/core-api/api-token-list` was replayed through Fix 4.

New detections:

- `test_002` — `count exists and is an integer` -> `SEMANTIC_ASSERTION_CAPABILITY_GAP`;
- `test_003` — `contents exists and is an array` -> `SEMANTIC_ASSERTION_CAPABILITY_GAP`.

Existing behavior remained intact:

- happy path stayed unchanged;
- the schema-contract scenario using a real `SCHEMA` assertion stayed unchanged;
- boolean/date-time capability gaps remained blocked;
- invalid path and forced 500 remained blocked by target-mutation/fault-injection rules.

Replay diagnostics contained four assertion capability gaps in total (`test_002`, `test_003`, `test_005`, `test_008`) plus the already expected executability issues.

## Regression coverage

Fix 4 adds explicit regression scenarios for all five new type families:

- integer;
- number;
- string;
- array;
- object.

For each family the test verifies both paths:

1. `JSON_PATH_EXISTS` only -> `REVIEW_REQUIRED`;
2. `JSON_PATH_EXISTS + SCHEMA` with matching structural type -> no capability gap.

## Architecture/security invariants preserved

- no new AI call;
- no new route;
- no migration;
- no binding;
- no secret;
- no relaxation of grounding/reference validation;
- no mutation of organization/project/endpoint/method/path;
- no payload/credential exposure;
- Automation Readiness remains system-owned.

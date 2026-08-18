# Foundation 07.6.3-C — Fix 3
## Semantic Assertion Capability Guard

Status: ready for real-environment validation.

## Problem observed

After Fix 2, the AI stopped generating unsupported target mutation/fault-injection scenarios, but the next real production generation exposed a more subtle gap: scenario objectives sometimes claimed stronger validation than the current DSL assertions could actually prove.

Examples observed:

- "count is correct" while the DSL only checked `$.count` exists;
- "list is not empty" while the DSL only checked `$.contents` exists;
- "id is a valid UUID" while the DSL only checked the field exists;
- "isDeleted is boolean" while the DSL only checked the field exists;
- "createdAt is a valid date" while the DSL only checked the field exists.

`JSON_PATH_EXISTS` proves presence only. It does not prove cardinality, type, format, relational correctness or semantic validity.

## Changes

### 1. Assertion capability detection

The Guard now compares scenario intent against the assertion vocabulary of `qagent.api-test-dsl.v1`.

Issue code:

`SEMANTIC_ASSERTION_CAPABILITY_GAP`

When the objective requires a capability the current assertions cannot prove:

- the scenario is preserved;
- `automationHints.reviewRequired=true`;
- final readiness becomes `REVIEW_REQUIRED`;
- a blocker explains the exact missing assertion capability.

The Guard does not invent a stronger assertion.

### 2. Capabilities covered in Fix 3

#### Relational count correctness

Examples:

- count corresponds to array length;
- token count is correct;
- quantity equals the number of returned items.

Current DSL has no relational assertion between two JSON values.

#### Non-empty array/list

`JSON_PATH_EXISTS` is insufficient to prove a non-empty array.

The intent is considered structurally provable only when an applicable `SCHEMA` assertion covers a schema with `minItems >= 1`, or when an explicit array equality assertion itself proves a non-empty value (subject to the existing literal-grounding rules).

#### UUID/type/format claims

Claims such as UUID, boolean and date/date-time require an applicable `SCHEMA` assertion whose structural schema actually models the JSONPath with the expected type/format.

A field-existence assertion by itself is not treated as proof of type/format.

### 3. Prompt hardening

Prompt version is now:

`qagent.test-design-prompt.v4`

The model is explicitly told that:

- `JSON_PATH_EXISTS` proves presence only;
- UUID/boolean/date-time claims should use a real `SCHEMA` assertion when the structural schema supports them;
- non-empty/cardinality claims are not proven by field existence;
- count-vs-list-length relations are not expressible in DSL v1;
- multiple DATA_VARIATION scenarios that merely repeat field presence/type should be avoided when one schema-contract scenario is more faithful.

The Semantic Guard remains the deterministic authority if the model ignores the prompt.

## Real production response replay

The last successful production response for `/core-api/api-token-list` was replayed through Fix 3.

Result:

- 8 scenarios total;
- 2 strong scenarios remained unchanged;
- 6 scenarios were flagged with `SEMANTIC_ASSERTION_CAPABILITY_GAP`.

Detected gaps:

1. correct token count;
2. non-empty token list;
3. token `id` UUID format;
4. `isDeleted` boolean type;
5. `userId` UUID format;
6. `createdAt` date-time format.

The two observed/high-confidence scenarios (happy path and schema contract) were not modified.

## Guard version

Diagnostics now report:

`qagent.semantic-grounding-guard.v1.1`

This allows production logs to distinguish Fix 3 behavior from previous Guard revisions.

## Architecture/security invariants preserved

- no new AI call in the Guard;
- no relaxation of Evidence/Schema reference validation;
- no mutation of organization/project/endpoint/method/path;
- no new route;
- no migration;
- no binding;
- no secret;
- no payload/credential exposure;
- Automation Readiness remains system-owned.

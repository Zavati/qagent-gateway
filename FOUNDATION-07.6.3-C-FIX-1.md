# Foundation 07.6.3-C — Fix 1
## AI Repair Timeout & Latency Hardening

Status: ready for real-environment validation.

## Problem observed

A real Test Design request reached the OpenAI provider, produced an invalid contract response, entered the single repair pass, and then failed with:

`AI_UPSTREAM_ERROR: openai upstream failed (The operation was aborted).`

The Worker log showed approximately 52.9 seconds wall time and the stack ended in `repairJson()`.

## Root cause

The Test Design primary generation timeout is configurable up to 120s and defaults to 90s, but both Test Design repair paths were capped at 30 seconds:

- JSON format repair
- contract repair

Additionally, contract repair reused the full generation prompt containing the complete Catalog Context and passed the full provider raw response whenever available. That makes the repair request significantly larger than necessary.

## Changes

### 1. Dedicated repair timeout

New optional environment variable:

`TEST_DESIGN_REPAIR_TIMEOUT_MS`

Default: `60000`
Minimum: `20000`
Maximum: `90000`

`TEST_DESIGN_TIMEOUT_MS` continues to control the primary generation and defaults to `90000`.

### 2. Compact repair prompt

New prompt version:

`qagent.test-design-repair-prompt.v1`

Repair receives only:

- frozen Test Design output schema;
- allowed Evidence refs;
- allowed Schema refs;
- structural repair rules;
- previous model output.

It no longer resends the complete `CATALOG_CONTEXT_JSON` merely to fix structure.

### 3. Contract repair uses the parsed model output

Contract repair now sends `JSON.stringify(modelOutput)` instead of the complete raw OpenAI Responses API envelope.

This reduces input size and avoids asking the model to interpret provider wrapper metadata.

### 4. Explicit timeout semantics

An AbortController timeout in Test Design generation/repair is now surfaced as:

- HTTP `504`
- code `AI_UPSTREAM_TIMEOUT`
- public safe details: provider, stage, timeoutMs, retryable

No prompt, raw model output, Catalog context, token or credential is returned.

### 5. Observability

Timeout emits:

`testDesign_ai_timeout`

with:

- stage: `generate`, `format-repair` or `contract-repair`;
- provider/model;
- endpointId;
- contextFingerprint;
- timeoutMs.

## Security invariants preserved

- one repair attempt only;
- no grounding/reference relaxation;
- no secret materialization;
- no runtime host/baseUrl in model contract;
- Semantic Grounding Guard remains unchanged;
- Catalog remains read-only;
- Console Bearer → Gateway remains unchanged.

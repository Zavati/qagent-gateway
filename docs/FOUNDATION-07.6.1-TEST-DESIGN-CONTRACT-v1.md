# QAgent Foundation 07.6.1 — Test Design Contract v1

**Status:** FROZEN FOR 07.6 IMPLEMENTATION  
**Contract:** `qagent.test-design.v1`  
**Specification:** `qagent.test-spec.v1`  
**Executable draft DSL:** `qagent.api-test-dsl.v1`

## 1. Purpose

Foundation 07.6 turns Catalog knowledge into test design without letting the LLM become a tenant authority, runtime resolver or arbitrary-code generator.

The contract separates three objects:

```text
CatalogTestDesignContextV1
        ↓
TestDesignModelOutputV1
        ↓ deterministic QAgent normalization
TestSpecificationV1
```

`TestDesignModelOutputV1` is the **only AI-controlled object**.

## 2. Architectural boundary

```text
Catalog / Control Plane
  ↓ sanitized context
ApiTestDesignService (future 07.6.2/07.6.3)
  ↓
AI Engine (existing provider-agnostic OpenAI/Gemini/BYOAI)
  ↓ TestDesignModelOutputV1
Contract validator
  ↓
TestSpecificationV1 (draft)
```

The AI Engine remains generic. It does not create Runs, resolve secrets, call customer environments, or choose tenant scope.

## 3. System-owned data

The model is never allowed to choose:

- `organizationId`;
- `projectId`;
- `endpointId`;
- endpoint HTTP method/path;
- raw host/base URL;
- configured Control Plane API Service mapping;
- Auth Profile ID;
- provider/model metadata;
- automation readiness final state;
- Evidence/Schema references that are absent from the supplied context.

Those values are injected or validated by QAgent.

## 4. CatalogTestDesignContextV1

The context is compact and sanitized. It may contain:

- endpoint identity and operational signals;
- structural schema tracks/versions;
- bounded Evidence metadata;
- Environment metadata;
- non-secret runtime references prepared by the Control Plane.

It must not contain raw Authorization/Cookie values, customer secrets, arbitrary request/response payload archives, or environment base URLs intended to be copied into the generated DSL.

Limits enforced by the contract:

- up to 30 schema tracks;
- up to 20 versions per schema track;
- up to 50 evidence items;
- up to 30 environments.

## 5. Grounding

Every generated scenario has:

```text
OBSERVED
INFERRED
ASSUMED
```

Rules:

- `OBSERVED` requires at least one real Evidence or Schema reference from the context;
- unknown/fabricated Evidence or Schema refs fail validation;
- `ASSUMED` cannot declare `confidence=HIGH`;
- every scenario needs a textual rationale.

This makes generated tests traceable to Knowledge Layer facts rather than opaque LLM output.

## 6. Scenario categories

```text
HAPPY_PATH
NEGATIVE
BOUNDARY
SCHEMA_CONTRACT
AUTHORIZATION
STATUS_BEHAVIOR
REGRESSION_CANDIDATE
DATA_VARIATION
```

Priority:

```text
HIGH
MEDIUM
LOW
```

Confidence:

```text
HIGH
MEDIUM
LOW
```

## 7. Automation Readiness

Readiness is **system-owned** and derived after model validation:

```text
READY
NEEDS_DATA
NEEDS_AUTH
NEEDS_ENVIRONMENT
REVIEW_REQUIRED
```

Initial precedence:

1. no configured Control Plane API Service mapping → `NEEDS_ENVIRONMENT`;
2. auth required without selected Auth Profile → `NEEDS_AUTH`;
3. scenario declares missing test data → `NEEDS_DATA`;
4. assumption/review requirement → `REVIEW_REQUIRED`;
5. otherwise → `READY`.

The model can provide hints, but cannot mark itself executable.

## 8. API Test DSL v1

The generated draft is constrained JSON, never JavaScript.

```json
{
  "dslVersion": "qagent.api-test-dsl.v1",
  "type": "api",
  "target": {
    "catalogEndpointId": "ep_...",
    "apiServiceKey": null,
    "method": "POST",
    "path": "/orders"
  },
  "auth": {
    "requirement": "REQUIRED",
    "authProfileRef": null
  },
  "request": {
    "pathParams": {},
    "query": {},
    "headers": {},
    "body": {}
  },
  "assertions": [],
  "extract": []
}
```

Hard rules:

- target path must be relative and start with `/`;
- absolute URLs and protocol-relative URLs are rejected;
- configured API Service key is injected by QAgent, never by the model;
- Auth Profile reference is injected/validated by QAgent;
- sensitive request headers (`Authorization`, `Cookie`, API keys, auth tokens) and obvious secret-bearing request keys are rejected from AI-controlled request data;
- no arbitrary executable code field exists.

Initial assertion types:

```text
STATUS
SCHEMA
JSON_PATH_EXISTS
JSON_PATH_EQUALS
HEADER_EXISTS
CONTENT_TYPE
```

Schema assertions can reference only schema IDs/hashes present in the input context.

## 9. Model output contract

The AI returns only:

```text
title
objective
assumptions[]
scenarios[]
```

It cannot return `source`, `generation`, tenant IDs, endpoint target or readiness.

A JSON Schema is stored at:

```text
docs/contracts/test-design-model-output-v1.schema.json
```

Semantic validation remains authoritative because cross-reference checks cannot be expressed safely by JSON Schema alone.

## 10. TestSpecificationV1

After validation, QAgent builds the final draft:

```text
contractVersion
specificationVersion
source (system-owned tenant/project/endpoint)
title
objective
assumptions
summary (system-computed)
scenarios
  grounding
  automation readiness
  constrained API DSL
generation (provider/model/time/context fingerprint)
```

Summary counts are computed by QAgent and are not trusted from model output.

## 11. Explicitly not implemented in 07.6.1

- no browser-facing generation route;
- no Catalog fetch yet;
- no LLM call yet;
- no database migration/persistence yet;
- no Test Definition CRUD;
- no Suite CRUD;
- no execution;
- no Runner;
- no environment HTTP calls;
- no auth/secret resolution.

Those arrive in subsequent 07.6 increments.

## 12. Exit criteria

07.6.1 is complete when:

- the contract versions are stable;
- valid Catalog context is accepted;
- invalid/oversized context is rejected;
- model output is strict and cannot inject system-owned fields;
- fabricated grounding refs are rejected;
- absolute target URLs are structurally impossible in model output and rejected in final spec validation;
- sensitive headers are rejected;
- QAgent injects endpoint target from Catalog context;
- Automation Readiness is computed deterministically;
- resulting `TestSpecificationV1` validates successfully;
- existing Gateway runtime/routes remain unchanged.

# QAgent Phase 2 — Foundation 07.2
## Environment API Services + Base URLs + Environment Variables

## Goal

Make an Environment executable without hard-coded URLs in future Test Definitions.

The model is intentionally split into three layers:

```text
Project
  └── API Service (logical identity: payments, identity, catalog)
        └── Environment API Binding (physical URL per DEV/QA/STG/PROD)

Environment
  └── Environment Variables (non-secret runtime values)
```

A future Test Definition should reference a logical service key and a relative path, never a fixed environment URL:

```json
{
  "apiServiceKey": "payments",
  "path": "/v1/payments"
}
```

## Entities

### api_services
Project-level logical API/service registry.

Important fields:
- `api_service_id`
- `organization_id`
- `project_id`
- `name`
- `service_key`
- `status`

`service_key` is unique among active services in a Project and is immutable after creation because it is intended to become a stable reference in Test Definitions. An archived logical key can be deliberately recreated later without resurrecting old bindings.

### environment_api_bindings
Maps one logical API Service to the Base URL used by a specific Environment.

Example:

```text
payments + DEV -> https://payments-dev.example.com
payments + STG -> https://payments-stg.example.com
```

The binding is tenant-scoped through composite foreign keys to both `environments` and `api_services`.

### environment_variables
Non-secret runtime configuration for one Environment.

Supported types:
- `STRING`
- `NUMBER`
- `BOOLEAN`
- `JSON`

`variable_key` is immutable after creation. Active keys are unique inside the Environment.

Secrets are explicitly forbidden in this table. Values such as passwords, API keys, access tokens, client secrets and credentials must be implemented in Foundation 07.3 Secret Vault/Auth Profiles and stored encrypted.

## Runtime config

Foundation 07.2 introduces an internal resolver and a Console preview endpoint that produces the normalized environment context:

```json
{
  "environment": {
    "environmentId": "env_xxx",
    "name": "STG",
    "environmentType": "STG",
    "webBaseUrl": "https://stg.example.com"
  },
  "apiServices": {
    "payments": {
      "apiServiceId": "svc_xxx",
      "name": "Payments",
      "baseUrl": "https://payments-stg.example.com"
    }
  },
  "variables": {
    "CUSTOMER_ID": "123",
    "MAX_RETRIES": 3,
    "FEATURE_FLAG": true
  }
}
```

This is intentionally secret-free. Foundation 07.3 will layer Auth Profile/Secret references on top of this runtime context.

## URL rules

API Base URLs:
- must use `http` or `https`;
- cannot contain embedded username/password;
- cannot contain query strings or fragments;
- trailing slash is normalized away.

Private/local addresses are not rejected at configuration time because a future Private Runner may legitimately execute them. SSRF protection belongs to the execution boundary and will be enforced by qagent-runner before any network request.

## Routes

### Project API Services

```text
GET    /v1/console/projects/:projectId/api-services
POST   /v1/console/projects/:projectId/api-services
GET    /v1/console/projects/:projectId/api-services/:apiServiceId
PATCH  /v1/console/projects/:projectId/api-services/:apiServiceId
DELETE /v1/console/projects/:projectId/api-services/:apiServiceId
```

### Environment API Bindings

```text
GET    /v1/console/projects/:projectId/environments/:environmentId/api-services
GET    /v1/console/projects/:projectId/environments/:environmentId/api-services/:apiServiceId
PUT    /v1/console/projects/:projectId/environments/:environmentId/api-services/:apiServiceId
DELETE /v1/console/projects/:projectId/environments/:environmentId/api-services/:apiServiceId
```

`PUT` is an idempotent upsert for a binding.

### Environment Variables

```text
GET    /v1/console/projects/:projectId/environments/:environmentId/variables
POST   /v1/console/projects/:projectId/environments/:environmentId/variables
GET    /v1/console/projects/:projectId/environments/:environmentId/variables/:variableId
PATCH  /v1/console/projects/:projectId/environments/:environmentId/variables/:variableId
DELETE /v1/console/projects/:projectId/environments/:environmentId/variables/:variableId
```

### Resolved runtime config preview

```text
GET /v1/console/projects/:projectId/environments/:environmentId/runtime-config
```

## Multi-tenant invariants

Every repository lookup is scoped by `organization_id` and the owning resource hierarchy. Composite foreign keys prevent cross-tenant bindings at the database layer.

`clientKey` is not used as a relational foreign key.

## Out of scope

Foundation 07.2 does not implement:
- Secret Vault;
- Auth Profiles;
- token acquisition;
- API Catalog;
- Test Definitions;
- Runner execution;
- SSRF network enforcement.

Those build on this configuration foundation instead of being mixed into it.

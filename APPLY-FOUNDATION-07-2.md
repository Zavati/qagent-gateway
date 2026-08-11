# Apply — Foundation 07.2

This patch assumes Foundation 07.1 is already applied and validated.

## 1. Copy the patch files

Apply the files preserving their repository paths.

## 2. Apply the D1 migration locally

```bash
npm install
npm run db:migrate:local
```

Migration added:

```text
migrations/0003_foundation_07_2_environment_api_services_variables.sql
```

## 3. Run tests

```bash
npm run test:f07-env-config
npm run test:router
npm run test:all
```

## 4. Start Gateway

```bash
npm run dev
```

Use the current Console session Bearer token for the following examples.

## 5. Create an API Service

```bash
curl -X POST "http://localhost:8787/v1/console/projects/<PROJECT_ID>/api-services" \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Payments",
    "serviceKey": "payments",
    "description": "Payments API"
  }'
```

Save the returned `apiServiceId`.

## 6. Bind the service to STG

```bash
curl -X PUT "http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments/<ENVIRONMENT_ID>/api-services/<API_SERVICE_ID>" \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://payments-stg.example.com"
  }'
```

Repeat the same logical service binding for DEV/QA/PROD with different URLs.

## 7. Create a non-secret Environment Variable

```bash
curl -X POST "http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments/<ENVIRONMENT_ID>/variables" \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "CUSTOMER_ID",
    "value": "qa-customer-001",
    "valueType": "STRING",
    "description": "Customer used by automated tests"
  }'
```

Do not store passwords, tokens, API keys or credentials here. The API rejects obvious secret keys and explicit `secret/sensitive` inputs.

## 8. Validate the resolved Environment configuration

```bash
curl "http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments/<ENVIRONMENT_ID>/runtime-config" \
  -H "Authorization: Bearer <SESSION_TOKEN>"
```

Expected structure:

```json
{
  "status": "ok",
  "runtimeConfig": {
    "organizationId": "org_...",
    "projectId": "prj_...",
    "environment": {
      "environmentId": "env_...",
      "name": "STG",
      "environmentType": "STG",
      "webBaseUrl": "https://stg.example.com"
    },
    "apiServices": {
      "payments": {
        "apiServiceId": "svc_...",
        "name": "Payments",
        "baseUrl": "https://payments-stg.example.com"
      }
    },
    "variables": {
      "CUSTOMER_ID": "qa-customer-001"
    }
  }
}
```

When this works, Foundation 07.2 has proved the core invariant: the same future Test Definition can use the logical `payments` service and execute against any Environment without embedding a fixed URL.

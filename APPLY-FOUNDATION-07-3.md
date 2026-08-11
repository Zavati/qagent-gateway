# Apply — Foundation 07.3

This patch assumes Foundation 07.1 and 07.2 are already applied and validated.

## 1. Copy the patch files

Apply all files preserving repository paths.

## 2. Configure a Secret Vault master key

Generate a 32-byte base64url key locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

For local development add to `.dev.vars`:

```text
QAGENT_SECRETS_ACTIVE_KEY_VERSION=v1
QAGENT_SECRETS_KEY_V1=<generated-key>
```

Do not reuse or commit the real production value. Configure production through Cloudflare secrets.

## 3. Apply D1 migration

```bash
npm install
npm run db:migrate:local
```

Migration added:

```text
migrations/0004_foundation_07_3_secret_vault_auth_profiles.sql
```

## 4. Run tests

```bash
npm run test:f07-auth
npm run test:router
npm run test:all
```

## 5. Start Gateway

```bash
npm run dev
```

Use the current Console session Bearer token.

## 6. Create a login Auth Profile

This assumes the Project already has an `identity` API Service from Foundation 07.2.

```bash
curl -X POST "http://localhost:8787/v1/console/projects/<PROJECT_ID>/auth-profiles" \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Default Customer",
    "profileKey": "default-customer",
    "type": "login_http_json",
    "config": {
      "apiServiceKey": "identity",
      "path": "/v1/login",
      "usernameField": "email",
      "passwordField": "password",
      "tokenSource": "json",
      "tokenJsonPath": "accessToken",
      "targetHeader": "Authorization",
      "scheme": "Bearer"
    }
  }'
```

Save `authProfile.authProfileId`.

## 7. Configure DEV credentials

Only `owner/admin` can perform this operation.

```bash
curl -X PUT "http://localhost:8787/v1/console/projects/<PROJECT_ID>/auth-profiles/<AUTH_PROFILE_ID>/environments/<DEV_ENVIRONMENT_ID>" \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": {
      "username": "qa-dev@example.com",
      "password": "DEV_PASSWORD"
    }
  }'
```

Expected response contains metadata similar to:

```json
{
  "binding": {
    "authProfileId": "authp_...",
    "environmentId": "env_...",
    "secretId": "sec_...",
    "credentialsConfigured": true
  }
}
```

It must not return username, password, ciphertext or IV.

## 8. Configure STG with different credentials

Call the same endpoint using the STG Environment ID and its own credentials.

The same logical Auth Profile now resolves differently by Environment.

## 9. Validate safe runtime config

```bash
curl "http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments/<DEV_ENVIRONMENT_ID>/runtime-config" \
  -H "Authorization: Bearer <SESSION_TOKEN>"
```

Expected additional section:

```json
{
  "authProfiles": {
    "default-customer": {
      "type": "login_http_json",
      "credentialsConfigured": true
    }
  }
}
```

No plaintext credential may appear.

## 10. Rotate credentials

Sending new `credentials` to the same Environment binding rotates the existing Secret instead of creating a new Auth Profile:

```bash
curl -X PUT "http://localhost:8787/v1/console/projects/<PROJECT_ID>/auth-profiles/<AUTH_PROFILE_ID>/environments/<DEV_ENVIRONMENT_ID>" \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": {
      "username": "qa-dev@example.com",
      "password": "NEW_PASSWORD"
    }
  }'
```

`secretId` should remain stable and `rotatedAt` changes in Secret Vault metadata.

## Foundation 07.3 exit check

Foundation 07.3 is validated when:

- Auth Profile exists at Project level;
- DEV and STG can bind different encrypted credentials to it;
- no plaintext secret is returned by Console APIs;
- Environment runtime config exposes only safe Auth Profile metadata;
- Secret rotation works;
- previous test suites remain green.

Fresh-token network execution remains intentionally deferred to `qagent-runner` so the Gateway does not become an execution engine.

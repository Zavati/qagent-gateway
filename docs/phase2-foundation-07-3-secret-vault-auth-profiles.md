# QAgent Phase 2 — Foundation 07.3
## Secret Vault + Auth Profiles + Dynamic Authentication Contract

Foundation 07.3 adds tenant runtime credentials without storing plaintext secrets in D1, returning them to the Console, or reusing browser-captured tokens.

## Goals

- Generic encrypted Secret Vault scoped by `organization_id + project_id`.
- Auth Profiles as stable logical references for future Test Definitions.
- Different credentials for the same Auth Profile in DEV/QA/STG/PROD.
- Dynamic-auth execution plan that the future `qagent-runner` can resolve just in time.
- No authentication HTTP call from the Gateway in this foundation.

## Data model

### `secrets`

Stores encrypted tenant secrets only.

- AES-256-GCM ciphertext.
- 12-byte random IV.
- versioned master key.
- AAD binds `organization_id + secret_id + kind`.
- plaintext is never returned by Console APIs.

Supported kinds:

- `generic`
- `basic`
- `api_key`
- `oauth2_client_credentials`
- `login_http_json`

### `auth_profiles`

Project-level stable authentication behavior.

Supported types:

- `none`
- `basic`
- `api_key`
- `oauth2_client_credentials`
- `login_http_json`

`profile_key` and `type` are immutable after creation because future Test Definitions will reference that contract.

### `auth_profile_environment_bindings`

Binds one logical Auth Profile to one Environment and, when required, one Secret.

This allows:

```text
Project: Checkout
Auth Profile: default-customer

DEV -> sec_dev_customer
STG -> sec_stg_customer
PROD -> sec_prod_customer
```

The Test Definition only needs:

```json
{
  "authProfileRef": "default-customer"
}
```

## Platform master key

Tenant Secret Vault encryption uses a key namespace separate from BYOAI credentials:

```text
QAGENT_SECRETS_ACTIVE_KEY_VERSION=v1
QAGENT_SECRETS_KEY_V1=<32-byte base64url key>
```

Generate a local key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Store the production value as a Cloudflare secret. Never commit it.

## AAD protection

Secret encryption uses authenticated metadata:

```text
qagent-secret-v1|organizationId|secretId|kind
```

Moving a ciphertext to another Organization, Secret ID or Secret kind causes decryption to fail.

## Auth Profile examples

### Login HTTP JSON

```json
{
  "name": "Default Customer",
  "profileKey": "default-customer",
  "type": "login_http_json",
  "config": {
    "apiServiceKey": "identity",
    "path": "/v1/login",
    "usernameField": "email",
    "passwordField": "password",
    "staticBody": {
      "tenant": "qa"
    },
    "tokenSource": "json",
    "tokenJsonPath": "accessToken",
    "targetHeader": "Authorization",
    "scheme": "Bearer"
  }
}
```

The credentials are not in `config`.

Environment binding:

```json
{
  "credentials": {
    "username": "qa-user@example.com",
    "password": "..."
  }
}
```

A different binding for STG can use different credentials while keeping the same Auth Profile.

### OAuth2 client credentials

```json
{
  "name": "Service Account",
  "profileKey": "service-account",
  "type": "oauth2_client_credentials",
  "config": {
    "apiServiceKey": "identity",
    "path": "/oauth/token",
    "clientAuthentication": "body",
    "scope": "orders.read orders.write",
    "tokenJsonPath": "access_token"
  }
}
```

Secret payload:

```json
{
  "clientId": "...",
  "clientSecret": "..."
}
```

## Runtime behavior

The public Environment runtime configuration now exposes safe Auth Profile metadata:

```json
{
  "authProfiles": {
    "default-customer": {
      "authProfileId": "authp_...",
      "name": "Default Customer",
      "type": "login_http_json",
      "config": {
        "apiServiceKey": "identity",
        "path": "/v1/login"
      },
      "credentialsConfigured": true
    }
  }
}
```

It never exposes secret values.

`resolveAuthProfileRuntimePlan()` is an internal-only service. It can decrypt the Environment-bound Secret in memory and resolve the logical API Service binding. It is intentionally not routed through `/v1/console/*`.

The future Runner will:

1. claim a Run/Attempt;
2. resolve Environment runtime config;
3. resolve the selected Auth Profile;
4. obtain the Secret just in time;
5. perform login/token exchange itself;
6. keep the resulting token only in process memory;
7. discard the token after execution.

## Security rules

- Plugin-captured `Authorization`, cookies or bearer tokens are never converted into Auth Profiles.
- Secret plaintext is write-only from the Console perspective.
- Secret ciphertext/IV are not returned by public services.
- Secret creation/rotation/environment binding requires `owner` or `admin`.
- Auth Profile metadata is readable by normal organization members so tests can reference it.
- `staticBody` rejects obvious secret fields.
- Dynamic authentication targets use logical `apiServiceKey + path`, not arbitrary absolute URLs.
- Actual egress/SSRF validation belongs to `qagent-runner` before any network call.

## Foundation boundary

Foundation 07.3 prepares dynamic authentication but does not execute authentication HTTP traffic inside `qagent-gateway`.

That keeps the architecture boundary intact:

```text
Gateway = stores/configures/protects
Runner  = resolves/authenticates/executes
```

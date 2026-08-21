# QAgent — Safe Observed Auth Signal Contract
## Required upstream work for 07.7.2-A FIX-2

## Goal

Preserve only the safe fact that a request used an authentication mechanism while continuing to destroy the credential value before it can leave the browser/data-plane security boundary.

## Canonical derived fields

```json
{
  "authObserved": true,
  "authScheme": "BEARER"
}
```

Types:

```text
authObserved: boolean
authScheme: BEARER | BASIC | API_KEY | COOKIE | UNKNOWN | null
```

Rules:

```text
authObserved=false -> authScheme=null
authObserved=true  -> authScheme required, UNKNOWN allowed
```

## Derivation v1

Derive before destructive header redaction, then immediately discard the original value.

### Authorization header

Read only the scheme token before the first whitespace:

```text
Bearer <anything> -> BEARER
Basic <anything>  -> BASIC
other             -> UNKNOWN
```

Do not decode JWTs.
Do not validate the credential.
Do not retain token length.
Do not hash/fingerprint the credential.

### API-key style headers

Presence of these names may produce:

```text
X-API-Key
Api-Key
X-Auth-Token
→ authObserved=true
→ authScheme=API_KEY
```

The header value is destroyed as before.

### Cookie

Cookie-based authentication is not reliably distinguishable from ordinary browser cookies in v1. Do not infer COOKIE merely because a Cookie header exists unless a future trusted detector can prove auth semantics.

## Required propagation

```text
qagent-plugin-v2
  ↓ safe derived metadata only
qagent-observation
  ↓ second-pass validation/redaction
qagent-normalizer
  ↓ normalized event / catalog-update contract
qagent-catalog
  ↓ Evidence
Catalog Query API
  ↓ optional Evidence fields
qagent-gateway
```

Each strict contract/validator in the chain must explicitly allow the two optional fields.

## Observation boundary

The browser collector is the only layer that may briefly see the original header value.

Sequence:

```text
raw request headers
↓
derive {authObserved, authScheme}
↓
redact/delete Authorization/API-key value
↓
serialize safe observation
```

Never serialize both derived signal and original auth value.

## Data Plane validation

`qagent-observation` must:

- validate boolean/enum only;
- reject or normalize unsupported scheme to UNKNOWN;
- run existing second-pass redaction independently;
- never trust a plugin-provided signal as permission to preserve headers.

## Normalizer

Persist/forward the derived fields as facts associated with the normalized event.

Do not infer credentials.
Do not decode tokens.
Do not produce a secret fingerprint.

## Catalog

Evidence may add optional fields:

```text
authObserved
authScheme
```

This is an additive read-model change.

Recommended evidence semantics:

```text
true/BEARER = this exact observation carried a Bearer Authorization mechanism
false/null  = collector explicitly observed no supported auth mechanism
null/missing = historical/unknown signal
```

Do not backfill historical rows as `false`; missing historical signal is `unknown`.

## Query API

Add optional fields to Evidence response only:

```yaml
authObserved:
  type: [boolean, 'null']
authScheme:
  type: [string, 'null']
  enum: [BEARER, BASIC, API_KEY, COOKIE, UNKNOWN, null]
```

The Query API remains read-only and no credential is introduced.

## Migration strategy

If persisted tables require columns, migrations must be additive and nullable.

Existing rows:

```text
auth_observed = NULL
auth_scheme = NULL
```

Do not convert historical null to false.

## Logging

Allowed:

```text
authObserved
authScheme
endpointId
evidenceId
```

Forbidden:

```text
Authorization value
JWT
API key
Cookie value
credential hash/fingerprint
token claims
```

## Security gate

Fixtures must include realistic-looking JWT/API-key values and prove they are absent from:

```text
Plugin serialized batch
Observation D1
Normalization payload
Normalizer D1
Catalog Update message
Catalog D1
Catalog Query response
Gateway logs
```

Only boolean/enum may survive.

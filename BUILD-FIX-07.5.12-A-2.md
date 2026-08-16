# Foundation 07.5.12-A — Service Binding Fix

## Symptom

Gateway → Catalog requests returned upstream HTTP 522 and never appeared in the qagent-catalog Worker logs.

## Root cause

The Gateway used global `fetch()` against `https://api.apiqagent.com/v1/catalog/...`. Both Workers are on the same Cloudflare zone and the Catalog is reached by Worker routing. Same-zone Worker-to-Worker communication through the public hostname is not the correct transport and can fail before the target Worker is invoked.

## Fix

The Gateway now declares a Cloudflare Service Binding:

- binding: `CATALOG_QUERY_SERVICE`
- service: `qagent-catalog`

Runtime calls use `env.CATALOG_QUERY_SERVICE.fetch(request)`.

The public Catalog Query API, HMAC signing contract, tenant validation, routes, filters and response contracts are unchanged. HMAC remains enabled as defense in depth.

Package version: `1.0.3`

# Foundation 07.5.12-A — Build/Deploy Guard Fix 1

## Purpose

Declare `CATALOG_QUERY_HMAC_SECRET` as a required Cloudflare Worker secret in
`wrangler.jsonc` without storing its value in Git.

## Result

`wrangler deploy` now validates that the target Worker already has
`CATALOG_QUERY_HMAC_SECRET` configured.

The secret value remains managed by Cloudflare and is not part of:
- `vars`
- source code
- the ZIP
- Git history

## GitHub Actions

The current workflow uses GitHub secrets only for:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

A GitHub secret named `CATALOG_QUERY_HMAC_SECRET` is therefore not uploaded by
that workflow. This is intentional in the recommended setup: configure the
Worker secret once in Cloudflare and let Wrangler validate its presence.

Package version: `1.0.2`

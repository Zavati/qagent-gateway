# Validation — Foundation 07.7.8-A FIX-1.1 Gateway

Validated locally against the uploaded repository snapshot.

## Passed

```text
Foundation 07.7.8-A Dynamic Form / OAuth Password gateway tests passed ✅
Foundation 07.7.8-A FIX-1.1 Gateway HTML Attribute CSRF config tests passed ✅
```

## Scope

- `HTML_INPUT_BY_NAME` preserved.
- `HTML_ATTRIBUTE_BY_TAG` added.
- exact tag/attribute validation; no arbitrary CSS/XPath/JS.
- legacy token auth unchanged.
- no migration.

## Important integration dependency

The Gateway can now freeze/send `preflight.extract.kind=HTML_ATTRIBUTE_BY_TAG`, but the Runner must also implement that extractor before the new mode is used in a real run.

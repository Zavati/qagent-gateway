# QAgent Foundation 07.7.9-C FIX-1 — Preserve Test Data Runtime Scope Hierarchy

## Problem
The first 07.7.9-C Gateway delivery was assembled from a pre-07.7.8-C-FIX-1 Gateway baseline. It unintentionally reintroduced repository queries against `endpoint_test_data_bindings` and omitted migration `0014_foundation_07_7_8_c_scope_hierarchy.sql`.

Production had already evolved to `test_data_bindings`, so `/catalog/endpoints/:endpointId/test-data` failed with `D1_ERROR: no such table: endpoint_test_data_bindings`.

## Fix
- Restore the reviewed 07.7.8-C FIX-1 Test Data Runtime implementation as the Gateway baseline.
- Preserve historical migration `0013` unchanged.
- Preserve `0014` scope hierarchy migration.
- Keep 07.7.9-C Results Retrieval / Automation Console additions as additive changes only.
- Keep `PROJECT < ENVIRONMENT < ENDPOINT` precedence and secret-safe Test Data policy.

## Architectural rule
A later Foundation must never be packaged from an older service baseline. Applied migrations are immutable and previously validated security/runtime behavior must be regression-gated in the final deliverable.

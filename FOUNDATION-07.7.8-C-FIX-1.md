# Foundation 07.7.8-C FIX-1 — Immutable D1 Migration Evolution

## Problem

`0013_foundation_07_7_8_c_test_data_runtime.sql` had already been applied remotely with the original endpoint-only table `endpoint_test_data_bindings`.

During the 07.7.8-C architecture review, the desired persisted model evolved to the formal precedence hierarchy:

```text
PROJECT < ENVIRONMENT < ENDPOINT
```

Editing the already-applied `0013` file caused Wrangler to report `No migrations to apply!` while the deployed Gateway expected the new table `test_data_bindings`.

## Correction

Applied migrations are immutable.

- `0013` is restored byte-for-byte to the previously shipped endpoint-only migration.
- `0014_foundation_07_7_8_c_scope_hierarchy.sql` evolves the schema.
- Existing endpoint-only rows are copied as `scope_type = 'ENDPOINT'`.
- The legacy table is removed only after the copy.
- The generalized indexes for PROJECT / ENVIRONMENT / ENDPOINT are then created.

## Architectural requirement

Never modify the content or semantic effect of a migration filename that may already exist in a remote `d1_migrations` history.

Any schema correction after deployment must use a new monotonically increasing migration.

Do not repair this condition by deleting rows from `d1_migrations`, renaming historical files, or manually replaying an already-recorded migration.

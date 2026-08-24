# Apply — Foundation 07.7.8-C FIX-1

## 1. Confirm the production state before changing anything

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('endpoint_test_data_bindings','test_data_bindings');"
```

Expected before FIX-1 on a database that received the original 0013:

```text
endpoint_test_data_bindings
```

Check migration history:

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5;"
```

`0013_foundation_07_7_8_c_test_data_runtime.sql` should already be present.

## 2. Apply only the new migration normally

```bash
npx wrangler d1 migrations list QAGENT_DB --remote
npx wrangler d1 migrations apply QAGENT_DB --remote
```

Expected pending/applied migration:

```text
0014_foundation_07_7_8_c_scope_hierarchy.sql
```

## 3. Validate schema after apply

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('endpoint_test_data_bindings','test_data_bindings');"
```

Expected after FIX-1:

```text
test_data_bindings
```

Validate columns:

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="PRAGMA table_info(test_data_bindings);"
```

Expected fields include `scope_type`, `environment_id`, `endpoint_id`, `source_type`, `fixed_value_json`, and `secret_id`.

## 4. Deploy Gateway only after migration succeeds

```bash
npm run check:07.7.8-c
npm run deploy
```

Do not delete or manipulate `d1_migrations`.

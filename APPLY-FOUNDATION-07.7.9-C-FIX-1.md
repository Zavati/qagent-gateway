# APPLY — Foundation 07.7.9-C FIX-1

No new D1 migration is introduced by this fix.

Production is expected to already have `0014_foundation_07_7_8_c_scope_hierarchy.sql` applied and the `test_data_bindings` table present.

Validate before deploy:

```bash
npx wrangler d1 execute QAGENT_DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('endpoint_test_data_bindings','test_data_bindings');"
```

Expected: `test_data_bindings`.

Then deploy the corrected Gateway and validate the endpoint Test Data GET plus the 07.7.9-C Automation read routes.

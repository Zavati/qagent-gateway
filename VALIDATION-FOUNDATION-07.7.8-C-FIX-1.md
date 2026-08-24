# Validation — Foundation 07.7.8-C FIX-1

Production gate:

```text
[ ] remote 0013 exists in d1_migrations
[ ] endpoint_test_data_bindings exists before 0014
[ ] 0014 is listed as pending
[ ] 0014 applies successfully
[ ] test_data_bindings exists after 0014
[ ] endpoint_test_data_bindings no longer exists after copy
[ ] existing endpoint rows preserved as scope_type=ENDPOINT
[ ] Gateway 07.7.8-C regression passes
[ ] Gateway deploy succeeds
[ ] Test Data API no longer returns D1_ERROR no such table
```

If the precondition `endpoint_test_data_bindings exists` is false, stop and inspect the actual remote schema before applying any manual repair.

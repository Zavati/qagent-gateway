# VALIDATION — Foundation 07.7.9-C FIX-1

Production gate:

- [ ] `test_data_bindings` exists in QAGENT_DB.
- [ ] Gateway deploy uses this FIX-1 package.
- [ ] GET endpoint Test Data returns 200 and uses the scope hierarchy.
- [ ] Existing endpoint/environment binding remains visible.
- [ ] PROJECT < ENVIRONMENT < ENDPOINT precedence still works.
- [ ] Sensitive selectors cannot be persisted as FIXED/GENERATED.
- [ ] 07.7.9-C Automation summary/list/detail/latest routes still work.
- [ ] `npm run check:07.7.9-c` passes before deploy.

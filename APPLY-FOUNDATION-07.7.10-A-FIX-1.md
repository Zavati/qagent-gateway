# Apply — Foundation 07.7.10-A FIX-1 / qagent-gateway

Deploy only after Test Registry migration `0003` and Worker are available.

```bash
npm ci
npm run check:07.7.10-a-fix-1
npm run deploy
```

No Gateway database migration is required.

Keep `TEST_REGISTRY_SERVICE` bound to `qagent-test-registry` and preserve all existing Runner/Auth/Results bindings and Worker Secrets.

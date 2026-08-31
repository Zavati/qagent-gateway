# Apply — Foundation 07.7.8-C2-C FIX-1.1

No database migration is required.

```bash
npm run test:f07-7-8-c2-c
npm run test:f07-7-8-c2-c-fix-1
npm run test:f07-7-9-c-fix-1
npm run test:all
npm run deploy
```

After deploy, regenerate the POST `/web/index.php/api/v2/pim/employees` Test Design and verify `qagent.test-data-planner.v1.2.2` plus non-zero intent diagnostics for the negative scenarios.

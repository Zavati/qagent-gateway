# Apply — QAgent 07.7.10-B FIX-1

Only `qagent-gateway` changes.

## Steps

1. Replace the Gateway code with this package.
2. Do **not** re-run, edit, or recreate migration `0015` because the database schema is already correct.
3. Run:

```bash
npm ci
npm run check:07.7.10-b-fix-1
npm run deploy
```

4. Retry:

```text
POST /v1/console/projects/{projectId}/suite-runs
```

The request should create an `srun_*` instead of returning D1 arity error.

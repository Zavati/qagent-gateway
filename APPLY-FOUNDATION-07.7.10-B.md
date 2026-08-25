# Apply — 07.7.10-B Gateway

Prerequisites:
- Test Registry 07.7.10-B deployed and migration 0004 applied;
- Cloudflare Queue `qagent-suite-run-orchestration` exists.

Apply:
1. Preserve the existing `QAGENT_DB` database ID and all Worker secrets.
2. Create the Queue if it does not exist: `npx wrangler queues create qagent-suite-run-orchestration`.
3. `npm ci`
4. `npm run check:07.7.10-b`
5. `npx wrangler d1 migrations list QAGENT_DB --remote`
6. `npx wrangler d1 migrations apply QAGENT_DB --remote`
7. Verify `suite_runs`, `suite_run_dispatches`, `suite_run_children`.
8. Deploy Gateway.

No Runner deployment is required for this Foundation.

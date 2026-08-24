import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.match(wrangler, /"binding":\s*"RUN_QUEUE"/);
assert.match(wrangler, /"queue":\s*"qagent-run-requests"/);
assert.match(wrangler, /RUNNER_CONTROL_MAX_SKEW_SECONDS/);
// Worker secrets are configured with `wrangler secret put`, not an unsupported top-level `secrets` key.
assert.doesNotMatch(wrangler, /"secrets"\s*:/);
const runnerAuth = await readFile(new URL('../src/security/runnerControlAuth.js', import.meta.url), 'utf8');
assert.match(runnerAuth, /RUNNER_CONTROL_HMAC_SECRET/);

const migration = await readFile(new URL('../migrations/0006_foundation_07_7_3_run_queue_dispatch.sql', import.meta.url), 'utf8');
assert.match(migration, /run_queue_dispatches/);
assert.match(migration, /qagent\.run-requested\.v1/);

const requested = JSON.parse(await readFile(new URL('../docs/contracts/qagent.run-requested.v1.schema.json', import.meta.url), 'utf8'));
assert.equal(requested.$id, 'qagent.run-requested.v1');
assert.deepEqual(requested.required, ['contractVersion', 'runId', 'executionPlanId', 'runtimeSnapshotId']);

console.log('Foundation 07.7.3 Gateway Queue config verified ✅');

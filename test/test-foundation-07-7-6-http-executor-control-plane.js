import assert from 'node:assert/strict';
import { normalizeRunnerHttpExecutedInput } from '../src/lib/runContracts.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { postInternalRunnerHttpExecuted } from '../src/handlers/internalRunnerControl.js';

const runId = 'run_0776_12345678';
const attemptId = 'runatt_0776_12345678';
const leaseToken = 'L'.repeat(43);
const runtimePlanHash = 'a'.repeat(64);

const normalized = normalizeRunnerHttpExecutedInput({
  contractVersion: 'qagent.runner-http-executed.v1',
  attemptId,
  leaseToken,
  runtimePlanHash,
  requestCount: 2,
  responseCount: 2,
  networkErrorCount: 0,
  timeoutCount: 0,
  redirectCount: 0,
  durationMs: 321,
});
assert.equal(normalized.requestCount, 2);
assert.equal(normalized.durationMs, 321);

assert.throws(() => normalizeRunnerHttpExecutedInput({
  ...normalized,
  responseCount: 3,
}), (error) => error.code === 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID');

const route = resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/http-executed`);
assert.equal(route?.name, 'internalRunnerRunHttpExecutedPost');
assert.equal(route?.params?.runId, runId);

let persisted = null;
const req = new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/http-executed`, {
  method: 'POST',
  body: JSON.stringify({
    contractVersion: 'qagent.runner-http-executed.v1',
    attemptId,
    leaseToken,
    runtimePlanHash,
    requestCount: 2,
    responseCount: 1,
    networkErrorCount: 1,
    timeoutCount: 0,
    redirectCount: 0,
    durationMs: 500,
  }),
});
const response = await postInternalRunnerHttpExecuted(req, {}, { runId }, {
  verifyRequest: async () => true,
  getBundle: async () => ({
    run: {
      runId,
      organizationId: 'org_0776',
      projectId: 'prj_0776',
      status: 'QUEUED',
      executionPlanId: 'xplan_0776_12345678',
      runtimeSnapshotId: 'rts_0776_12345678',
    },
    executionPlan: {
      executionPlanId: 'xplan_0776_12345678',
      runtimeSnapshotId: 'rts_0776_12345678',
    },
    runtimeSnapshot: { runtimeSnapshotId: 'rts_0776_12345678' },
  }),
  markHttpExecuted: async (_env, values) => {
    persisted = values;
    return { updated: true };
  },
  now: () => '2026-08-22T00:00:00.000Z',
});
assert.equal(response.data.httpExecutionStatus, 'COMPLETED');
assert.equal(persisted.runtimePlanHash, runtimePlanHash);
assert.equal(persisted.requestCount, 2);
assert.equal(persisted.networkErrorCount, 1);
assert.equal(Object.hasOwn(persisted, 'body'), false);

console.log('Foundation 07.7.6 Gateway HTTP execution control-plane tests passed ✅');

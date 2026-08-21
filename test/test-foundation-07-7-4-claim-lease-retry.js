import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import {
  RUNNER_CLAIM_CONTRACT_VERSION,
  RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
  RUNNER_HEARTBEAT_CONTRACT_VERSION,
  RUNNER_RECEIVED_V2_CONTRACT_VERSION,
  RUNNER_RETRY_CONTRACT_VERSION,
  normalizeRunnerClaimInput,
  normalizeRunnerHeartbeatInput,
  normalizeRunnerRetryInput,
} from '../src/lib/runContracts.js';
import {
  getInternalRunnerRunBundle,
  postInternalRunnerClaim,
  postInternalRunnerHeartbeat,
  postInternalRunnerReceived,
  postInternalRunnerRetry,
} from '../src/handlers/internalRunnerControl.js';
import { createRunnerControlSignature, sha256TextHex } from '../src/security/runnerControlAuth.js';

const secret = 'runner-control-secret-0123456789-abcdef';
const runId = 'run_0774_12345678';
const projectId = 'prj_0774';
const organizationId = 'org_0774';
const executionPlanId = 'xplan_0774_12345678';
const runtimeSnapshotId = 'rts_0774_12345678';
const attemptId = 'runatt_0774_12345678';
const leaseToken = 'A'.repeat(43);

assert.equal(RUNNER_CLAIM_CONTRACT_VERSION, 'qagent.runner-claim.v1');
assert.equal(RUNNER_CLAIM_RESULT_CONTRACT_VERSION, 'qagent.runner-claim-result.v1');
assert.equal(RUNNER_HEARTBEAT_CONTRACT_VERSION, 'qagent.runner-heartbeat.v1');
assert.equal(RUNNER_RETRY_CONTRACT_VERSION, 'qagent.runner-retry.v1');
assert.equal(RUNNER_RECEIVED_V2_CONTRACT_VERSION, 'qagent.runner-received.v2');

assert.deepEqual(normalizeRunnerClaimInput({
  contractVersion: RUNNER_CLAIM_CONTRACT_VERSION,
  executionPlanId,
  runtimeSnapshotId,
  leaseOwnerId: 'rlo_0774_12345678',
  queueMessageId: 'msg-0774-1',
  queueDeliveryAttempt: 1,
}), {
  contractVersion: RUNNER_CLAIM_CONTRACT_VERSION,
  executionPlanId,
  runtimeSnapshotId,
  leaseOwnerId: 'rlo_0774_12345678',
  queueMessageId: 'msg-0774-1',
  queueDeliveryAttempt: 1,
});
assert.equal(normalizeRunnerHeartbeatInput({
  contractVersion: RUNNER_HEARTBEAT_CONTRACT_VERSION,
  attemptId,
  leaseToken,
}).attemptId, attemptId);
assert.equal(normalizeRunnerRetryInput({
  contractVersion: RUNNER_RETRY_CONTRACT_VERSION,
  attemptId,
  leaseToken,
  errorCode: 'RUN_CONTROL_TIMEOUT',
  retryAfterSeconds: 10,
}).retryAfterSeconds, 10);

let state = {
  run: {
    runId, organizationId, projectId, contractVersion: 'qagent.run.v1',
    testDesignId: 'td_0774', testDesignVersionId: 'tdv_0774', testDesignVersion: 3,
    endpointId: 'cep_0774', environmentId: 'env_0774', executionPlanId, runtimeSnapshotId,
    status: 'QUEUED', scenarioCount: 1, scenarioIds: ['test_001'],
    createdAt: '2026-08-21T17:10:00.000Z', updatedAt: '2026-08-21T17:10:01.000Z',
  },
  executionPlan: {
    executionPlanId, runId, runtimeSnapshotId, organizationId, projectId,
    contractVersion: 'qagent.execution-plan.v1',
    plan: {
      contractVersion: 'qagent.execution-plan.v1', executionPlanId, runId, runtimeSnapshotId,
      scenarios: [{ scenarioId: 'test_001', readiness: 'READY' }], schemaSnapshots: [], planHash: 'a'.repeat(64),
    },
    planHash: 'a'.repeat(64), scenarioCount: 1, schemaSnapshotCount: 0,
  },
  runtimeSnapshot: {
    runtimeSnapshotId, runId, organizationId, projectId, contractVersion: 'qagent.runtime-snapshot.v1',
    snapshot: { contractVersion: 'qagent.runtime-snapshot.v1', runtimeSnapshotId, runId, snapshotHash: 'b'.repeat(64) },
    snapshotHash: 'b'.repeat(64),
  },
  dispatch: {
    runId, organizationId, projectId, executionPlanId, runtimeSnapshotId,
    status: 'PUBLISHED', dispatchAttemptCount: 1, publishedAt: '2026-08-21T17:10:01.000Z', runnerReceivedAt: null,
  },
  latestAttempt: null,
};

async function signedRequest(method, path, body = null) {
  const rawBody = body == null ? '' : JSON.stringify(body);
  const url = `https://api.apiqagent.com${path}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha256TextHex(rawBody);
  const signature = await createRunnerControlSignature({ secret, method, url, timestamp, bodyHash });
  return new Request(url, {
    method,
    headers: {
      'X-QAgent-Runner-Timestamp': timestamp,
      'X-QAgent-Runner-Signature': signature,
      ...(body == null ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body == null ? undefined : rawBody,
  });
}

const claimBody = {
  contractVersion: RUNNER_CLAIM_CONTRACT_VERSION,
  executionPlanId,
  runtimeSnapshotId,
  leaseOwnerId: 'rlo_0774_12345678',
  queueMessageId: 'msg-0774-1',
  queueDeliveryAttempt: 1,
};
const claimReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/claim`, claimBody);
const claimResp = await postInternalRunnerClaim(
  claimReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret, RUNNER_LEASE_SECONDS: '60' },
  { runId },
  {
    getBundle: async () => structuredClone(state),
    now: () => '2026-08-21T18:00:00.000Z',
    newAttemptId: () => attemptId,
    newLeaseToken: () => leaseToken,
    tryClaim: async (_env, input) => ({
      acquired: true,
      claim: { currentAttemptId: attemptId, currentAttemptNumber: 1 },
      attempt: {
        attemptId, attemptNumber: 1, status: 'CLAIMED', leaseAcquiredAt: input.leaseAcquiredAt,
        leaseExpiresAt: input.leaseExpiresAt, heartbeatCount: 0,
      },
    }),
  },
);
assert.equal(claimResp.data.claimStatus, 'CLAIMED');
assert.equal(claimResp.data.attemptId, attemptId);
assert.equal(claimResp.data.leaseToken, leaseToken);
assert.equal(claimResp.data.leaseExpiresAt, '2026-08-21T18:01:00.000Z');

const activeClaimReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/claim`, claimBody);
const activeResp = await postInternalRunnerClaim(
  activeClaimReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret, RUNNER_LEASE_SECONDS: '60' },
  { runId },
  {
    getBundle: async () => structuredClone(state),
    now: () => '2026-08-21T18:00:10.000Z',
    tryClaim: async () => ({
      acquired: false,
      claim: { state: 'ACTIVE', currentAttemptId: attemptId, currentAttemptNumber: 1, leaseExpiresAt: '2026-08-21T18:01:00.000Z' },
    }),
  },
);
assert.equal(activeResp.data.claimStatus, 'ACTIVE_LEASE');
assert.equal(activeResp.data.activeAttemptId, attemptId);
assert.equal('leaseToken' in activeResp.data, false, 'active duplicate must never receive another owner lease token');
assert.ok(activeResp.data.retryAfterSeconds >= 1);

const hbBody = { contractVersion: RUNNER_HEARTBEAT_CONTRACT_VERSION, attemptId, leaseToken };
const hbReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/heartbeat`, hbBody);
const hbResp = await postInternalRunnerHeartbeat(
  hbReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret, RUNNER_LEASE_SECONDS: '60' },
  { runId },
  {
    getBundle: async () => structuredClone(state),
    now: () => '2026-08-21T18:00:20.000Z',
    heartbeat: async () => ({ updated: true, attempt: { heartbeatCount: 1 } }),
  },
);
assert.equal(hbResp.data.heartbeatStatus, 'EXTENDED');
assert.equal(hbResp.data.heartbeatCount, 1);
assert.equal(hbResp.data.leaseExpiresAt, '2026-08-21T18:01:20.000Z');

const retryBody = {
  contractVersion: RUNNER_RETRY_CONTRACT_VERSION,
  attemptId,
  leaseToken,
  errorCode: 'RUN_CONTROL_TIMEOUT',
  retryAfterSeconds: 20,
};
const retryReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/retry`, retryBody);
const retryResp = await postInternalRunnerRetry(
  retryReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  {
    getBundle: async () => structuredClone(state),
    now: () => '2026-08-21T18:00:30.000Z',
    markRetry: async () => ({ updated: true }),
  },
);
assert.equal(retryResp.data.retryStatus, 'SCHEDULED');
assert.equal(retryResp.data.nextRetryAt, '2026-08-21T18:00:50.000Z');

const receivedBody = {
  contractVersion: RUNNER_RECEIVED_V2_CONTRACT_VERSION,
  executionPlanId,
  runtimeSnapshotId,
  attemptId,
  leaseToken,
};
const receivedReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/received`, receivedBody);
const receivedResp = await postInternalRunnerReceived(
  receivedReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  {
    getBundle: async () => structuredClone(state),
    now: () => '2026-08-21T18:00:40.000Z',
    markReceivedWithLease: async () => {
      state.dispatch.status = 'RECEIVED';
      state.dispatch.runnerReceivedAt = '2026-08-21T18:00:40.000Z';
      state.latestAttempt = {
        attemptId, attemptNumber: 1, status: 'RECEIVED', leaseAcquiredAt: '2026-08-21T18:00:00.000Z',
        leaseExpiresAt: '2026-08-21T18:01:20.000Z', heartbeatCount: 1, receivedAt: '2026-08-21T18:00:40.000Z',
      };
      return { updated: true };
    },
  },
);
assert.equal(receivedResp.data.contractVersion, RUNNER_RECEIVED_V2_CONTRACT_VERSION);
assert.equal(receivedResp.data.queueStatus, 'RECEIVED');
assert.equal(receivedResp.data.attemptId, attemptId);

const bundleReq = await signedRequest('GET', `/internal/v1/runner/runs/${runId}/bundle`);
const bundleResp = await getInternalRunnerRunBundle(
  bundleReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  { getBundle: async () => structuredClone(state) },
);
assert.equal(bundleResp.data.latestAttempt.status, 'RECEIVED');
assert.equal(JSON.stringify(bundleResp).includes('leaseTokenHash'), false);
assert.equal(JSON.stringify(bundleResp).includes(leaseToken), false);

const cancelledState = structuredClone(state);
cancelledState.run.status = 'CANCELLED';
cancelledState.dispatch.status = 'PUBLISHED';
const cancelReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/claim`, claimBody);
let claimCalled = false;
const cancelResp = await postInternalRunnerClaim(
  cancelReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  { getBundle: async () => cancelledState, tryClaim: async () => { claimCalled = true; } },
);
assert.equal(cancelResp.data.claimStatus, 'CANCELLED');
assert.equal(claimCalled, false);

assert.deepEqual(resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/claim`), { name: 'internalRunnerRunClaimPost', params: { runId } });
assert.deepEqual(resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/heartbeat`), { name: 'internalRunnerRunHeartbeatPost', params: { runId } });
assert.deepEqual(resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/retry`), { name: 'internalRunnerRunRetryPost', params: { runId } });

const migration = await readFile(new URL('../migrations/0007_foundation_07_7_4_claim_lease_retry.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS run_execution_attempts/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS run_execution_claims/);
assert.match(migration, /ABANDONED/);
assert.match(migration, /RETRYABLE/);
assert.match(migration, /lease_token_hash/);

const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.match(wrangler, /RUNNER_LEASE_SECONDS/);

console.log('Foundation 07.7.4 Claim / Lease / Retry Gateway tests passed ✅');

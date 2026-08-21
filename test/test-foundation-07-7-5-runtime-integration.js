import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import {
  RUNNER_RUNTIME_READY_CONTRACT_VERSION,
  RUNNER_REJECTED_CONTRACT_VERSION,
  normalizeRunnerRuntimeReadyInput,
  normalizeRunnerRejectedInput,
} from '../src/lib/runContracts.js';
import {
  postInternalRunnerRuntimeReady,
  postInternalRunnerRejected,
} from '../src/handlers/internalRunnerControl.js';
import { createRunnerControlSignature, sha256TextHex } from '../src/security/runnerControlAuth.js';

const secret = 'runner-control-secret-0775-0123456789abcdef';
const runId = 'run_0775_12345678';
const attemptId = 'runatt_0775_12345678';
const leaseToken = 'B'.repeat(43);
const runtimePlanHash = 'a'.repeat(64);

assert.equal(RUNNER_RUNTIME_READY_CONTRACT_VERSION, 'qagent.runner-runtime-ready.v1');
assert.equal(RUNNER_REJECTED_CONTRACT_VERSION, 'qagent.runner-rejected.v1');
assert.equal(normalizeRunnerRuntimeReadyInput({
  contractVersion: RUNNER_RUNTIME_READY_CONTRACT_VERSION,
  attemptId,
  leaseToken,
  runtimePlanHash,
  targetCount: 1,
  resolutionSource: 'EXPLICIT_CONFIG',
  resolutionConfidence: 'CONFIRMED',
}).targetCount, 1);
assert.equal(normalizeRunnerRejectedInput({
  contractVersion: RUNNER_REJECTED_CONTRACT_VERSION,
  attemptId,
  leaseToken,
  errorCode: 'RUNNER_RUNTIME_API_SERVICE_UNAVAILABLE',
  phase: 'RUNTIME',
}).phase, 'RUNTIME');

const bundle = {
  run: {
    runId,
    organizationId: 'org_0775',
    projectId: 'prj_0775',
    status: 'QUEUED',
    executionPlanId: 'xplan_0775_12345678',
    runtimeSnapshotId: 'rts_0775_12345678',
  },
  executionPlan: {
    executionPlanId: 'xplan_0775_12345678',
    runtimeSnapshotId: 'rts_0775_12345678',
  },
  runtimeSnapshot: { runtimeSnapshotId: 'rts_0775_12345678' },
};

async function signedRequest(path, body) {
  const rawBody = JSON.stringify(body);
  const url = `https://api.apiqagent.com${path}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha256TextHex(rawBody);
  const signature = await createRunnerControlSignature({ secret, method: 'POST', url, timestamp, bodyHash });
  return new Request(url, {
    method: 'POST',
    headers: {
      'X-QAgent-Runner-Timestamp': timestamp,
      'X-QAgent-Runner-Signature': signature,
      'Content-Type': 'application/json',
    },
    body: rawBody,
  });
}

const readyBody = {
  contractVersion: RUNNER_RUNTIME_READY_CONTRACT_VERSION,
  attemptId,
  leaseToken,
  runtimePlanHash,
  targetCount: 1,
  resolutionSource: 'EXPLICIT_CONFIG',
  resolutionConfidence: 'CONFIRMED',
};
let markedReady = null;
const readyReq = await signedRequest(`/internal/v1/runner/runs/${runId}/runtime-ready`, readyBody);
const readyResp = await postInternalRunnerRuntimeReady(
  readyReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  {
    getBundle: async () => structuredClone(bundle),
    now: () => '2026-08-21T20:00:00.000Z',
    markRuntimeReady: async (_env, input) => { markedReady = input; return { updated: true }; },
  },
);
assert.equal(readyResp.data.runtimeReadinessStatus, 'READY');
assert.equal(markedReady.runtimePlanHash, runtimePlanHash);
assert.equal(markedReady.targetCount, 1);
assert.equal('leaseToken' in readyResp.data, false);

const rejectBody = {
  contractVersion: RUNNER_REJECTED_CONTRACT_VERSION,
  attemptId,
  leaseToken,
  errorCode: 'RUNNER_RUNTIME_CONFIRMATION_REQUIRED',
  phase: 'RUNTIME',
};
const rejectReq = await signedRequest(`/internal/v1/runner/runs/${runId}/rejected`, rejectBody);
const rejectResp = await postInternalRunnerRejected(
  rejectReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  {
    getBundle: async () => structuredClone(bundle),
    now: () => '2026-08-21T20:00:01.000Z',
    markRejected: async () => ({ updated: true }),
  },
);
assert.equal(rejectResp.data.status, 'REJECTED');
assert.equal(rejectResp.data.errorCode, 'RUNNER_RUNTIME_CONFIRMATION_REQUIRED');

assert.deepEqual(resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/runtime-ready`), {
  name: 'internalRunnerRunRuntimeReadyPost', params: { runId },
});
assert.deepEqual(resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/rejected`), {
  name: 'internalRunnerRunRejectedPost', params: { runId },
});

const migration = await readFile(new URL('../migrations/0008_foundation_07_7_5_runtime_integration.sql', import.meta.url), 'utf8');
assert.match(migration, /runtime_readiness_status/);
assert.match(migration, /runtime_plan_hash/);
assert.match(migration, /runtime_materialized_at/);
assert.doesNotMatch(migration, /response_body|authorization|secret_value/i);

console.log('Foundation 07.7.5 Runtime Integration Gateway tests passed ✅');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import {
  RUN_REQUESTED_CONTRACT_VERSION,
  RUNNER_RECEIVED_CONTRACT_VERSION,
  RUNNER_RUN_BUNDLE_CONTRACT_VERSION,
  buildRunRequestedMessage,
} from '../src/lib/runContracts.js';
import { dispatchRunToQueueV1 } from '../src/services/runQueueDispatchService.js';
import {
  createRunnerControlSignature,
  sha256TextHex,
} from '../src/security/runnerControlAuth.js';
import {
  getInternalRunnerRunBundle,
  postInternalRunnerReceived,
} from '../src/handlers/internalRunnerControl.js';

const secret = 'runner-control-secret-0123456789-abcdef';
const runId = 'run_0773_12345678';
const projectId = 'prj_0773';
const organizationId = 'org_0773';
const executionPlanId = 'xplan_0773_12345678';
const runtimeSnapshotId = 'rts_0773_12345678';

assert.equal(RUN_REQUESTED_CONTRACT_VERSION, 'qagent.run-requested.v1');
assert.equal(RUNNER_RUN_BUNDLE_CONTRACT_VERSION, 'qagent.runner-run-bundle.v1');
assert.equal(RUNNER_RECEIVED_CONTRACT_VERSION, 'qagent.runner-received.v1');
assert.deepEqual(buildRunRequestedMessage({ runId, executionPlanId, runtimeSnapshotId }), {
  contractVersion: 'qagent.run-requested.v1',
  runId,
  executionPlanId,
  runtimeSnapshotId,
});

const executionPlan = {
  contractVersion: 'qagent.execution-plan.v1',
  executionPlanId,
  runId,
  organizationId,
  projectId,
  testDesign: {
    testDesignId: 'td_0773', testDesignVersionId: 'tdv_0773', version: 3,
    endpointId: 'cep_0773', contextFingerprint: 'a'.repeat(64), specificationVersion: 'qagent.test-spec.v1',
  },
  environmentId: 'env_0773',
  runtimeSnapshotId,
  scenarios: [{
    scenarioId: 'test_001', readiness: 'READY',
    spec: {
      dslVersion: 'qagent.api-test-dsl.v1', type: 'api',
      target: { apiServiceKey: 'core-api', method: 'GET', path: '/health' },
      auth: { requirement: 'REQUIRED', authProfileRef: 'authp_0773' },
      request: { pathParams: {}, query: {}, headers: {}, body: {} },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }], extract: [],
    },
  }],
  schemaSnapshots: [],
  createdAt: '2026-08-21T17:10:00.000Z',
  planHash: 'b'.repeat(64),
};
const runtimeSnapshot = {
  contractVersion: 'qagent.runtime-snapshot.v1',
  runtimeSnapshotId,
  runId,
  organizationId,
  projectId,
  environment: { environmentId: 'env_0773', name: 'STG', slug: 'stg', environmentType: 'STG' },
  resolution: { source: 'EXPLICIT_CONFIG', confidence: 'CONFIRMED', requiresExecutionConfirmation: false },
  apiServices: { 'core-api': { apiServiceId: 'svc_0773', name: 'Core API', serviceKey: 'core-api', baseUrl: 'https://api-stg.example.com' } },
  variables: {},
  availableVariableKeys: [],
  authProfiles: {
    authp_0773: {
      authProfileId: 'authp_0773', profileKey: 'bearer', name: 'Bearer', type: 'api_key',
      config: { placement: 'header', name: 'Authorization', prefix: '' }, credentialsConfigured: true,
    },
  },
  createdAt: '2026-08-21T17:10:00.000Z',
  snapshotHash: 'c'.repeat(64),
};

let state = {
  run: {
    runId, organizationId, projectId, contractVersion: 'qagent.run.v1',
    testDesignId: 'td_0773', testDesignVersionId: 'tdv_0773', testDesignVersion: 3,
    endpointId: 'cep_0773', environmentId: 'env_0773', executionPlanId, runtimeSnapshotId,
    status: 'CREATED', scenarioCount: 1, scenarioIds: ['test_001'],
    createdAt: '2026-08-21T17:10:00.000Z', updatedAt: '2026-08-21T17:10:00.000Z',
    idempotencyKey: 'internal-only', requestFingerprint: 'd'.repeat(64),
  },
  executionPlan: {
    executionPlanId, runId, runtimeSnapshotId, organizationId, projectId,
    contractVersion: 'qagent.execution-plan.v1', plan: executionPlan, planHash: executionPlan.planHash,
    scenarioCount: 1, schemaSnapshotCount: 0, createdAt: executionPlan.createdAt,
  },
  runtimeSnapshot: {
    runtimeSnapshotId, runId, organizationId, projectId, contractVersion: 'qagent.runtime-snapshot.v1',
    resolutionSource: 'EXPLICIT_CONFIG', resolutionConfidence: 'CONFIRMED', requiresExecutionConfirmation: false,
    snapshot: runtimeSnapshot, snapshotHash: runtimeSnapshot.snapshotHash, createdAt: runtimeSnapshot.createdAt,
  },
  dispatch: {
    runId, organizationId, projectId, contractVersion: 'qagent.run-requested.v1',
    executionPlanId, runtimeSnapshotId, status: 'PENDING', dispatchAttemptCount: 0,
    publishedAt: null, runnerReceivedAt: null,
  },
};

const sent = [];
const deps = {
  queue: { send: async (body) => { sent.push(structuredClone(body)); } },
  ensureRunQueueDispatch: async () => state.dispatch,
  markRunDispatchAttempt: async () => {
    state.dispatch.dispatchAttemptCount += 1;
    return state.dispatch;
  },
  markRunDispatchFailed: async () => state.dispatch,
  markRunQueued: async () => {
    state.run.status = 'QUEUED';
    state.dispatch.status = 'PUBLISHED';
    state.dispatch.publishedAt = '2026-08-21T17:11:00.000Z';
    return structuredClone(state);
  },
  getRunBundle: async () => structuredClone(state),
};

const queued = await dispatchRunToQueueV1({ env: {}, bundle: structuredClone(state), deps });
assert.equal(queued.run.status, 'QUEUED');
assert.equal(queued.dispatch.status, 'PUBLISHED');
assert.equal(sent.length, 1);
assert.deepEqual(sent[0], {
  contractVersion: 'qagent.run-requested.v1', runId, executionPlanId, runtimeSnapshotId,
});
assert.equal(JSON.stringify(sent[0]).includes('api-stg.example.com'), false, 'queue message must not contain runtime plan');
assert.equal(JSON.stringify(sent[0]).includes('Authorization'), false, 'queue message must not contain auth config');

// Already published/replayed Run does not produce another queue message.
await dispatchRunToQueueV1({ env: {}, bundle: structuredClone(state), deps });
assert.equal(sent.length, 1);

await assert.rejects(
  dispatchRunToQueueV1({
    env: {},
    bundle: { ...structuredClone(state), dispatch: { ...state.dispatch, status: 'PENDING' } },
    deps: { ...deps, queue: null },
  }),
  (error) => error?.code === 'RUN_QUEUE_NOT_CONFIGURED' && error?.status === 503,
);

function signedRequest(method, path, rawBody = '') {
  return (async () => {
    const url = `https://api.apiqagent.com${path}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bodyHash = await sha256TextHex(rawBody);
    const signature = await createRunnerControlSignature({ secret, method, url, timestamp, bodyHash });
    return new Request(url, {
      method,
      headers: {
        'X-QAgent-Runner-Timestamp': timestamp,
        'X-QAgent-Runner-Signature': signature,
        ...(rawBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: rawBody || undefined,
    });
  })();
}

const getReq = await signedRequest('GET', `/internal/v1/runner/runs/${runId}/bundle`);
const internalBundleResponse = await getInternalRunnerRunBundle(
  getReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  { getBundle: async () => structuredClone(state) },
);
assert.equal(internalBundleResponse.data.contractVersion, 'qagent.runner-run-bundle.v1');
assert.equal(internalBundleResponse.data.run.runId, runId);
assert.equal(internalBundleResponse.data.executionPlan.executionPlanId, executionPlanId);
assert.equal(internalBundleResponse.data.runtimeSnapshot.runtimeSnapshotId, runtimeSnapshotId);
const internalJson = JSON.stringify(internalBundleResponse);
assert.equal(internalJson.includes('internal-only'), false, 'idempotency key must not leave internal bundle');
assert.equal(internalJson.includes('requestFingerprint'), false);

const receivedPayload = JSON.stringify({
  contractVersion: 'qagent.runner-received.v1', executionPlanId, runtimeSnapshotId,
});
const postReq = await signedRequest('POST', `/internal/v1/runner/runs/${runId}/received`, receivedPayload);
let receivedMarked = false;
const receivedResponse = await postInternalRunnerReceived(
  postReq,
  { RUNNER_CONTROL_HMAC_SECRET: secret },
  { runId },
  {
    getBundle: async () => structuredClone(state),
    markReceived: async () => {
      receivedMarked = true;
      state.dispatch.status = 'RECEIVED';
      state.dispatch.runnerReceivedAt = '2026-08-21T17:12:00.000Z';
      return structuredClone(state);
    },
  },
);
assert.equal(receivedMarked, true);
assert.equal(receivedResponse.data.queueStatus, 'RECEIVED');
assert.equal(receivedResponse.data.contractVersion, 'qagent.runner-received.v1');

const badReq = new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/bundle`, { method: 'GET' });
await assert.rejects(
  getInternalRunnerRunBundle(badReq, { RUNNER_CONTROL_HMAC_SECRET: secret }, { runId }, { getBundle: async () => state }),
  (error) => error?.code === 'RUNNER_CONTROL_UNAUTHORIZED',
);

assert.deepEqual(
  resolveGatewayRoute('GET', `/internal/v1/runner/runs/${runId}/bundle`),
  { name: 'internalRunnerRunBundleGet', params: { runId } },
);
assert.deepEqual(
  resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/received`),
  { name: 'internalRunnerRunReceivedPost', params: { runId } },
);

const migration = await readFile(new URL('../migrations/0006_foundation_07_7_3_run_queue_dispatch.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS run_queue_dispatches/);
assert.match(migration, /PENDING/);
assert.match(migration, /PUBLISHED/);
assert.match(migration, /RECEIVED/);

const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
assert.match(wrangler, /"binding": "RUN_QUEUE"/);
assert.match(wrangler, /"queue": "qagent-run-requests"/);
assert.doesNotMatch(wrangler, /\"secrets\"\s*:/);
const runnerAuthSource = await readFile(new URL('../src/security/runnerControlAuth.js', import.meta.url), 'utf8');
assert.match(runnerAuthSource, /RUNNER_CONTROL_HMAC_SECRET/);

console.log('Foundation 07.7.3 Queue + qagent-runner Gateway tests passed ✅');

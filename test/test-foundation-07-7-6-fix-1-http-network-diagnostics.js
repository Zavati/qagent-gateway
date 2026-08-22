import assert from 'node:assert/strict';
import { normalizeRunnerHttpExecutedInput } from '../src/lib/runContracts.js';
import { postInternalRunnerHttpExecuted } from '../src/handlers/internalRunnerControl.js';
import { getRunV1 } from '../src/services/runService.js';

const runId = 'run_0776fix1_12345678';
const attemptId = 'runatt_0776fix1_12345678';
const leaseToken = 'L'.repeat(43);
const runtimePlanHash = 'f'.repeat(64);

{
  const normalized = normalizeRunnerHttpExecutedInput({
    contractVersion: 'qagent.runner-http-executed.v1',
    attemptId,
    leaseToken,
    runtimePlanHash,
    requestCount: 1,
    responseCount: 0,
    networkErrorCount: 1,
    timeoutCount: 0,
    redirectCount: 0,
    durationMs: 443,
    responseStatusCounts: {
      response2xxCount: 0,
      response3xxCount: 0,
      response4xxCount: 0,
      response5xxCount: 0,
    },
    primaryDiagnostic: {
      kind: 'NETWORK_ERROR',
      scenarioId: 'test_001',
      statusCode: null,
      errorCode: 'RUNNER_HTTP_NETWORK_RESET',
      errorCategory: 'RESET',
      errorName: 'TypeError',
      causeCode: 'ECONNRESET',
    },
  });
  assert.equal(normalized.primaryDiagnostic.kind, 'NETWORK_ERROR');
  assert.equal(normalized.primaryDiagnostic.errorCategory, 'RESET');
  assert.equal(normalized.primaryDiagnostic.causeCode, 'ECONNRESET');
}

{
  const normalized = normalizeRunnerHttpExecutedInput({
    contractVersion: 'qagent.runner-http-executed.v1',
    attemptId,
    leaseToken,
    runtimePlanHash,
    requestCount: 1,
    responseCount: 1,
    networkErrorCount: 0,
    timeoutCount: 0,
    redirectCount: 0,
    durationMs: 100,
    responseStatusCounts: {
      response2xxCount: 0,
      response3xxCount: 0,
      response4xxCount: 0,
      response5xxCount: 1,
    },
    primaryDiagnostic: {
      kind: 'HTTP_RESPONSE',
      scenarioId: 'test_001',
      statusCode: 500,
      errorCode: null,
      errorCategory: null,
      errorName: null,
      causeCode: null,
    },
  });
  assert.equal(normalized.responseStatusCounts.response5xxCount, 1);
  assert.equal(normalized.primaryDiagnostic.statusCode, 500);
}

assert.throws(() => normalizeRunnerHttpExecutedInput({
  contractVersion: 'qagent.runner-http-executed.v1',
  attemptId,
  leaseToken,
  runtimePlanHash,
  requestCount: 1,
  responseCount: 0,
  networkErrorCount: 1,
  timeoutCount: 0,
  redirectCount: 0,
  durationMs: 100,
  primaryDiagnostic: {
    kind: 'NETWORK_ERROR',
    scenarioId: 'test_001',
    statusCode: null,
    errorCode: 'RUNNER_HTTP_NETWORK_FETCH',
    errorCategory: 'FETCH',
    errorName: 'TypeError',
    causeCode: null,
    rawMessage: 'https://example.com?token=must-not-pass',
  },
}), (error) => error.code === 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID');

{
  let persisted = null;
  const req = new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/http-executed`, {
    method: 'POST',
    body: JSON.stringify({
      contractVersion: 'qagent.runner-http-executed.v1',
      attemptId,
      leaseToken,
      runtimePlanHash,
      requestCount: 1,
      responseCount: 0,
      networkErrorCount: 1,
      timeoutCount: 0,
      redirectCount: 0,
      durationMs: 443,
      responseStatusCounts: {
        response2xxCount: 0,
        response3xxCount: 0,
        response4xxCount: 0,
        response5xxCount: 0,
      },
      primaryDiagnostic: {
        kind: 'NETWORK_ERROR',
        scenarioId: 'test_001',
        statusCode: null,
        errorCode: 'RUNNER_HTTP_NETWORK_FETCH',
        errorCategory: 'FETCH',
        errorName: 'TypeError',
        causeCode: null,
      },
    }),
  });

  const response = await postInternalRunnerHttpExecuted(req, {}, { runId }, {
    verifyRequest: async () => true,
    getBundle: async () => ({
      run: {
        runId,
        organizationId: 'org_0776fix1',
        projectId: 'prj_0776fix1',
        status: 'QUEUED',
        executionPlanId: 'xplan_0776fix1_12345678',
        runtimeSnapshotId: 'rts_0776fix1_12345678',
      },
      executionPlan: {
        executionPlanId: 'xplan_0776fix1_12345678',
        runtimeSnapshotId: 'rts_0776fix1_12345678',
      },
      runtimeSnapshot: { runtimeSnapshotId: 'rts_0776fix1_12345678' },
    }),
    markHttpExecuted: async (_env, values) => {
      persisted = values;
      return { updated: true };
    },
    now: () => '2026-08-22T02:30:00.000Z',
  });

  assert.equal(response.data.httpExecutionStatus, 'COMPLETED');
  assert.equal(response.data.primaryDiagnostic.errorCategory, 'FETCH');
  assert.equal(persisted.primaryDiagnostic.errorCode, 'RUNNER_HTTP_NETWORK_FETCH');
  assert.equal(persisted.responseStatusCounts.response5xxCount, 0);
  assert.equal(JSON.stringify(persisted).includes('token='), false);
}


{
  const envelope = await getRunV1({
    env: {},
    organizationId: 'org_0776fix1',
    projectId: 'prj_0776fix1',
    runId,
    deps: {
      getRunBundle: async () => ({
        run: {
          runId,
          status: 'QUEUED',
          projectId: 'prj_0776fix1',
          testDesignId: 'td_0776fix1',
          testDesignVersionId: 'tdv_0776fix1_12345678',
          testDesignVersion: 1,
          endpointId: 'cep_0776fix1',
          environmentId: 'env_0776fix1',
          executionPlanId: 'xplan_0776fix1_12345678',
          runtimeSnapshotId: 'rts_0776fix1_12345678',
          scenarioIds: ['test_001'],
          scenarioCount: 1,
          createdAt: '2026-08-22T02:00:00.000Z',
          updatedAt: '2026-08-22T02:00:01.000Z',
        },
        executionPlan: {
          contractVersion: 'qagent.execution-plan.v1',
          executionPlanId: 'xplan_0776fix1_12345678',
          runtimeSnapshotId: 'rts_0776fix1_12345678',
          planHash: 'a'.repeat(64),
          scenarioCount: 1,
          schemaSnapshotCount: 0,
          createdAt: '2026-08-22T02:00:00.000Z',
        },
        runtimeSnapshot: {
          contractVersion: 'qagent.runtime-snapshot.v1',
          runtimeSnapshotId: 'rts_0776fix1_12345678',
          snapshotHash: 'b'.repeat(64),
          resolutionSource: 'DISCOVERED_OBSERVATION',
          resolutionConfidence: 'HIGH',
          requiresExecutionConfirmation: false,
          snapshot: { environment: null, apiServices: {}, authProfiles: {} },
          createdAt: '2026-08-22T02:00:00.000Z',
        },
        dispatch: { status: 'RECEIVED', dispatchAttemptCount: 1 },
        latestAttempt: {
          attemptId,
          attemptNumber: 1,
          status: 'RECEIVED',
          heartbeatCount: 2,
          httpExecutionStatus: 'COMPLETED',
          httpRequestCount: 1,
          httpResponseCount: 1,
          httpNetworkErrorCount: 0,
          httpTimeoutCount: 0,
          httpRedirectCount: 0,
          httpDurationMs: 120,
          httpResponse2xxCount: 0,
          httpResponse3xxCount: 0,
          httpResponse4xxCount: 0,
          httpResponse5xxCount: 1,
          httpPrimaryDiagnosticKind: 'HTTP_RESPONSE',
          httpPrimaryScenarioId: 'test_001',
          httpPrimaryStatusCode: 500,
          httpPrimaryErrorCode: null,
          httpPrimaryErrorCategory: null,
          httpPrimaryErrorName: null,
          httpPrimaryCauseCode: null,
        },
      }),
    },
  });
  assert.equal(envelope.executionAttempt.httpResponseStatusCounts.response5xxCount, 1);
  assert.equal(envelope.executionAttempt.httpDiagnostic.kind, 'HTTP_RESPONSE');
  assert.equal(envelope.executionAttempt.httpDiagnostic.statusCode, 500);
}

console.log('Foundation 07.7.6 FIX-1 HTTP Network Diagnostics Gateway tests passed ✅');

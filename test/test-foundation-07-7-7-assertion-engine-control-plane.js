import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRunnerAssertionsEvaluatedInput,
  RUNNER_ASSERTIONS_EVALUATED_CONTRACT_VERSION,
} from '../src/lib/runContracts.js';
import { postInternalRunnerAssertionsEvaluated } from '../src/handlers/internalRunnerControl.js';
import { getRunV1 } from '../src/services/runService.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const runId = 'run_0777_12345678';
const attemptId = 'runatt_0777_12345678';
const leaseToken = 'L'.repeat(43);
const runtimePlanHash = 'a'.repeat(64);

assert.equal(RUNNER_ASSERTIONS_EVALUATED_CONTRACT_VERSION, 'qagent.runner-assertions-evaluated.v1');

{
  const normalized = normalizeRunnerAssertionsEvaluatedInput({
    contractVersion: 'qagent.runner-assertions-evaluated.v1',
    attemptId,
    leaseToken,
    runtimePlanHash,
    outcome: 'PASSED',
    scenarioCount: 2,
    scenarioPassedCount: 2,
    scenarioFailedCount: 0,
    scenarioNotEvaluatedCount: 0,
    assertionCount: 5,
    assertionPassedCount: 5,
    assertionFailedCount: 0,
    assertionNotEvaluatedCount: 0,
    durationMs: 2,
    primaryDiagnostic: null,
  });
  assert.equal(normalized.outcome, 'PASSED');
  assert.equal(normalized.assertionPassedCount, 5);
}

{
  const normalized = normalizeRunnerAssertionsEvaluatedInput({
    contractVersion: 'qagent.runner-assertions-evaluated.v1',
    attemptId,
    leaseToken,
    runtimePlanHash,
    outcome: 'FAILED',
    scenarioCount: 1,
    scenarioPassedCount: 0,
    scenarioFailedCount: 1,
    scenarioNotEvaluatedCount: 0,
    assertionCount: 3,
    assertionPassedCount: 2,
    assertionFailedCount: 1,
    assertionNotEvaluatedCount: 0,
    durationMs: 1,
    primaryDiagnostic: {
      kind: 'ASSERTION_FAILURE',
      scenarioId: 'test_001',
      assertionIndex: 0,
      assertionType: 'STATUS',
      errorCode: 'ASSERTION_STATUS_MISMATCH',
      path: null,
      headerName: null,
      schemaRef: null,
      actualStatusCode: 500,
      actualContentType: 'application/json',
    },
  });
  assert.equal(normalized.outcome, 'FAILED');
  assert.equal(normalized.primaryDiagnostic.actualStatusCode, 500);
}

{
  const normalized = normalizeRunnerAssertionsEvaluatedInput({
    contractVersion: 'qagent.runner-assertions-evaluated.v1',
    attemptId,
    leaseToken,
    runtimePlanHash,
    outcome: 'ERROR',
    scenarioCount: 1,
    scenarioPassedCount: 0,
    scenarioFailedCount: 0,
    scenarioNotEvaluatedCount: 1,
    assertionCount: 1,
    assertionPassedCount: 0,
    assertionFailedCount: 0,
    assertionNotEvaluatedCount: 1,
    durationMs: 1,
    primaryDiagnostic: {
      kind: 'ASSERTION_NOT_EVALUATED',
      scenarioId: 'test_001',
      assertionIndex: 0,
      assertionType: 'STATUS',
      errorCode: 'ASSERTION_HTTP_RESPONSE_UNAVAILABLE',
      path: null,
      headerName: null,
      schemaRef: null,
      actualStatusCode: null,
      actualContentType: null,
    },
  });
  assert.equal(normalized.outcome, 'ERROR');
}

assert.throws(() => normalizeRunnerAssertionsEvaluatedInput({
  contractVersion: 'qagent.runner-assertions-evaluated.v1',
  attemptId,
  leaseToken,
  runtimePlanHash,
  outcome: 'PASSED',
  scenarioCount: 1,
  scenarioPassedCount: 0,
  scenarioFailedCount: 1,
  scenarioNotEvaluatedCount: 0,
  assertionCount: 1,
  assertionPassedCount: 0,
  assertionFailedCount: 1,
  assertionNotEvaluatedCount: 0,
  durationMs: 1,
  primaryDiagnostic: null,
}), (error) => error.code === 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID');

assert.throws(() => normalizeRunnerAssertionsEvaluatedInput({
  contractVersion: 'qagent.runner-assertions-evaluated.v1',
  attemptId,
  leaseToken,
  runtimePlanHash,
  outcome: 'FAILED',
  scenarioCount: 1,
  scenarioPassedCount: 0,
  scenarioFailedCount: 1,
  scenarioNotEvaluatedCount: 0,
  assertionCount: 1,
  assertionPassedCount: 0,
  assertionFailedCount: 1,
  assertionNotEvaluatedCount: 0,
  durationMs: 1,
  primaryDiagnostic: {
    kind: 'ASSERTION_FAILURE', scenarioId: 'test_001', assertionIndex: 0, assertionType: 'JSON_PATH_EQUALS',
    errorCode: 'ASSERTION_JSON_PATH_VALUE_MISMATCH', path: '$.token',
    rawExpectedValue: 'secret-must-not-enter-control-plane',
  },
}), (error) => error.code === 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID');

{
  let persisted = null;
  const req = new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/assertions-evaluated`, {
    method: 'POST',
    body: JSON.stringify({
      contractVersion: 'qagent.runner-assertions-evaluated.v1',
      attemptId,
      leaseToken,
      runtimePlanHash,
      outcome: 'FAILED',
      scenarioCount: 1,
      scenarioPassedCount: 0,
      scenarioFailedCount: 1,
      scenarioNotEvaluatedCount: 0,
      assertionCount: 3,
      assertionPassedCount: 2,
      assertionFailedCount: 1,
      assertionNotEvaluatedCount: 0,
      durationMs: 1,
      primaryDiagnostic: {
        kind: 'ASSERTION_FAILURE',
        scenarioId: 'test_001',
        assertionIndex: 0,
        assertionType: 'STATUS',
        errorCode: 'ASSERTION_STATUS_MISMATCH',
        path: null,
        headerName: null,
        schemaRef: null,
        actualStatusCode: 500,
        actualContentType: 'application/json',
      },
    }),
  });

  const response = await postInternalRunnerAssertionsEvaluated(req, {}, { runId }, {
    verifyRequest: async () => true,
    getBundle: async () => ({
      run: {
        runId,
        organizationId: 'org_0777',
        projectId: 'prj_0777',
        status: 'QUEUED',
        executionPlanId: 'xplan_0777_12345678',
        runtimeSnapshotId: 'rts_0777_12345678',
      },
      executionPlan: {
        executionPlanId: 'xplan_0777_12345678',
        runtimeSnapshotId: 'rts_0777_12345678',
      },
      runtimeSnapshot: { runtimeSnapshotId: 'rts_0777_12345678' },
      latestAttempt: { attemptId, status: 'CLAIMED', httpExecutionStatus: 'COMPLETED' },
    }),
    markAssertionsEvaluated: async (_env, values) => {
      persisted = values;
      return { updated: true };
    },
    now: () => '2026-08-22T21:00:00.000Z',
  });

  assert.equal(response.data.assertionExecutionStatus, 'COMPLETED');
  assert.equal(response.data.outcome, 'FAILED');
  assert.equal(persisted.outcome, 'FAILED');
  assert.equal(persisted.primaryDiagnostic.actualStatusCode, 500);
  assert.equal(JSON.stringify(persisted).includes('L'.repeat(43)), false);
}

assert.deepEqual(
  resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/assertions-evaluated`),
  { name: 'internalRunnerRunAssertionsEvaluatedPost', params: { runId } },
);

{
  const envelope = await getRunV1({
    env: {}, organizationId: 'org_0777', projectId: 'prj_0777', runId,
    deps: {
      getRunBundle: async () => ({
        run: {
          runId,
          status: 'FAILED',
          projectId: 'prj_0777',
          testDesignId: 'td_0777',
          testDesignVersionId: 'tdv_0777_12345678',
          testDesignVersion: 1,
          endpointId: 'cep_0777',
          environmentId: 'env_0777',
          executionPlanId: 'xplan_0777_12345678',
          runtimeSnapshotId: 'rts_0777_12345678',
          scenarioIds: ['test_001'], scenarioCount: 1,
          createdAt: '2026-08-22T20:59:00.000Z', updatedAt: '2026-08-22T21:00:00.000Z',
        },
        executionPlan: {
          contractVersion: 'qagent.execution-plan.v1', executionPlanId: 'xplan_0777_12345678',
          runtimeSnapshotId: 'rts_0777_12345678', planHash: 'b'.repeat(64), scenarioCount: 1,
          schemaSnapshotCount: 1, createdAt: '2026-08-22T20:59:00.000Z',
        },
        runtimeSnapshot: {
          contractVersion: 'qagent.runtime-snapshot.v1', runtimeSnapshotId: 'rts_0777_12345678', snapshotHash: 'c'.repeat(64),
          resolutionSource: 'DISCOVERED_OBSERVATION', resolutionConfidence: 'HIGH', requiresExecutionConfirmation: false,
          snapshot: { environment: null, apiServices: {}, authProfiles: {} }, createdAt: '2026-08-22T20:59:00.000Z',
        },
        dispatch: { status: 'RECEIVED', dispatchAttemptCount: 1 },
        latestAttempt: {
          attemptId, attemptNumber: 1, status: 'RECEIVED', heartbeatCount: 3,
          runtimeReadinessStatus: 'READY', runtimePlanHash,
          httpExecutionStatus: 'COMPLETED', httpRequestCount: 1, httpResponseCount: 1,
          httpNetworkErrorCount: 0, httpTimeoutCount: 0, httpRedirectCount: 0, httpDurationMs: 100,
          httpResponse2xxCount: 0, httpResponse3xxCount: 0, httpResponse4xxCount: 0, httpResponse5xxCount: 1,
          assertionExecutionStatus: 'COMPLETED', assertionOutcome: 'FAILED',
          assertionScenarioCount: 1, assertionScenarioPassedCount: 0, assertionScenarioFailedCount: 1,
          assertionScenarioNotEvaluatedCount: 0, assertionCount: 3, assertionPassedCount: 2,
          assertionFailedCount: 1, assertionNotEvaluatedCount: 0, assertionDurationMs: 1,
          assertionEvaluatedAt: '2026-08-22T21:00:00.000Z',
          assertionPrimaryDiagnosticKind: 'ASSERTION_FAILURE', assertionPrimaryScenarioId: 'test_001',
          assertionPrimaryIndex: 0, assertionPrimaryType: 'STATUS', assertionPrimaryErrorCode: 'ASSERTION_STATUS_MISMATCH',
          assertionPrimaryPath: null, assertionPrimaryHeaderName: null, assertionPrimarySchemaRef: null,
          assertionPrimaryActualStatusCode: 500, assertionPrimaryActualContentType: 'application/json',
        },
      }),
    },
  });
  assert.equal(envelope.run.status, 'FAILED');
  assert.equal(envelope.executionAttempt.assertionExecutionStatus, 'COMPLETED');
  assert.equal(envelope.executionAttempt.assertionOutcome, 'FAILED');
  assert.equal(envelope.executionAttempt.assertionFailedCount, 1);
  assert.equal(envelope.executionAttempt.assertionDiagnostic.assertionType, 'STATUS');
  assert.equal(envelope.executionAttempt.assertionDiagnostic.actualStatusCode, 500);
}

// Lifecycle hardening: assertion persistence must not terminalize the Run before
// final RECEIVED/lease release. Terminal status is committed by the received path
// from the persisted assertion_outcome, closing the crash/redelivery window.
const claimRepositorySource = await readFile(new URL('../src/repositories/runExecutionClaimRepository.js', import.meta.url), 'utf8');
const assertionRepoSection = claimRepositorySource.slice(
  claimRepositorySource.indexOf('export async function markRunAssertionsEvaluated'),
);
assert.doesNotMatch(
  assertionRepoSection.slice(0, assertionRepoSection.indexOf('\n}')),
  /UPDATE\s+runs/i,
  'assertion summary must not make the Run terminal before final receive',
);
const receivedRepoSection = claimRepositorySource.slice(
  claimRepositorySource.indexOf('export async function markRunExecutionReceived'),
  claimRepositorySource.indexOf('export async function markRunExecutionCancelled'),
);
assert.match(receivedRepoSection, /assertion_execution_status\s*=\s*'COMPLETED'/i);
assert.match(receivedRepoSection, /assertion_outcome\s+IN\s*\('PASSED',\s*'FAILED',\s*'ERROR'\)/i);

const migration = await readFile(new URL('../migrations/0011_foundation_07_7_7_assertion_engine.sql', import.meta.url), 'utf8');
assert.match(migration, /assertion_execution_status/i);
assert.match(migration, /assertion_outcome/i);
assert.match(migration, /assertion_primary_error_code/i);
assert.doesNotMatch(migration, /response_body|request_body|authorization|cookie/i);

console.log('Foundation 07.7.7 Assertion Engine v1 Gateway Control Plane tests passed ✅');

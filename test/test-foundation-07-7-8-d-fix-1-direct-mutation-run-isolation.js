import assert from 'node:assert/strict';
import { fingerprintRunCreateInput } from '../src/lib/runContracts.js';
import { createRunV1 } from '../src/services/runService.js';

const organizationId = 'org_fix_d';
const projectId = 'prj_fix_d';
const environmentId = 'env_fix_d_stg';
const artifact = {
  testDesignId: 'td_fix_d',
  testDesignVersionId: 'tdv_fix_d',
  version: 1,
  endpointId: 'cep_fix_d',
};

function makeMaterialized(methods, ids = methods.map((_, index) => `test_${index + 1}`)) {
  return ({ runId, executionPlanId, runtimeSnapshotId, createdAt }) => ({
    selectedScenarioIds: ids,
    runtimeSnapshot: {
      contractVersion: 'qagent.runtime-snapshot.v1',
      runId,
      runtimeSnapshotId,
      resolution: { source: 'EXPLICIT_CONFIG', confidence: 'CONFIRMED', requiresExecutionConfirmation: false },
      environment: { environmentId, name: 'STG', slug: 'stg', environmentType: 'STG' },
      apiServices: {},
      authProfiles: {},
      testData: {},
      snapshotHash: 'a'.repeat(64),
      createdAt,
    },
    executionPlan: {
      contractVersion: 'qagent.execution-plan.v1',
      executionPlanId,
      runId,
      runtimeSnapshotId,
      planHash: 'b'.repeat(64),
      scenarios: methods.map((method, index) => ({
        scenarioId: ids[index],
        spec: { target: { method } },
      })),
      schemaSnapshots: [],
      createdAt,
    },
  });
}

function makeDeps({ methods, ids, existing = null, existingBundle = null } = {}) {
  let persistCount = 0;
  let dispatchCount = 0;
  let persistedBundle = existingBundle;

  const deps = {
    getRunByIdempotencyKey: async () => existing || persistedBundle?.run || null,
    getRunBundle: async () => existingBundle || persistedBundle,
    getRunnerTestArtifact: async () => artifact,
    materializeExecutionPlan: async (input) => makeMaterialized(methods, ids)(input),
    createRunArtifacts: async (_env, payload) => {
      persistCount += 1;
      persistedBundle = {
        run: payload.run,
        runtimeSnapshot: {
          runtimeSnapshotId: payload.runtimeSnapshot.runtimeSnapshotId,
          runId: payload.run.runId,
          contractVersion: payload.runtimeSnapshot.contractVersion,
          resolutionSource: payload.runtimeSnapshot.resolution.source,
          resolutionConfidence: payload.runtimeSnapshot.resolution.confidence,
          requiresExecutionConfirmation: payload.runtimeSnapshot.resolution.requiresExecutionConfirmation,
          snapshotHash: payload.runtimeSnapshot.snapshotHash,
          snapshot: payload.runtimeSnapshot,
          createdAt: payload.runtimeSnapshot.createdAt,
        },
        executionPlan: {
          executionPlanId: payload.executionPlan.executionPlanId,
          runId: payload.run.runId,
          runtimeSnapshotId: payload.runtimeSnapshot.runtimeSnapshotId,
          contractVersion: payload.executionPlan.contractVersion,
          planHash: payload.executionPlan.planHash,
          scenarioCount: payload.executionPlan.scenarios.length,
          schemaSnapshotCount: payload.executionPlan.schemaSnapshots.length,
          plan: payload.executionPlan,
          createdAt: payload.executionPlan.createdAt,
        },
        dispatch: null,
        latestAttempt: null,
      };
      return persistedBundle;
    },
    dispatchRun: async ({ bundle }) => {
      dispatchCount += 1;
      return bundle;
    },
  };

  return {
    deps,
    counts: () => ({ persistCount, dispatchCount }),
  };
}

async function createWith(methods, ids, suffix) {
  const { deps, counts } = makeDeps({ methods, ids });
  const input = {
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: artifact.testDesignVersionId,
    environmentId,
    scenarioIds: ids,
    confirmDiscoveredRuntime: false,
  };
  const result = await createRunV1({
    env: {}, organizationId, projectId, userId: 'usr_fix_d', input,
    idempotencyKey: `fix-d:${suffix}:12345678`, deps,
  });
  return { result, counts };
}

// A — read-only Direct Run remains batched.
{
  const { result, counts } = await createWith(['GET', 'GET', 'GET'], ['test_a', 'test_b', 'test_c'], 'read');
  assert.equal(result.run.scenarioCount, 3);
  assert.deepEqual(result.run.scenarioIds, ['test_a', 'test_b', 'test_c']);
  assert.deepEqual(counts(), { persistCount: 1, dispatchCount: 1 });
}

// B/C — a Direct mutation Run with more than one selected scenario must fail before persistence and queue dispatch.
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const { deps, counts } = makeDeps({ methods: [method, method], ids: ['test_a', 'test_b'] });
  const input = {
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: artifact.testDesignVersionId,
    environmentId,
    scenarioIds: ['test_a', 'test_b'],
    confirmDiscoveredRuntime: false,
  };
  await assert.rejects(
    createRunV1({
      env: {}, organizationId, projectId, userId: 'usr_fix_d', input,
      idempotencyKey: `fix-d:${method.toLowerCase()}:12345678`, deps,
    }),
    (error) => error?.code === 'RUN_MUTATION_REQUIRES_SINGLE_SCENARIO'
      && error?.status === 409
      && error?.publicDetails?.scenarioCount === 2
      && error?.publicDetails?.mutationScenarioCount === 2,
  );
  assert.deepEqual(counts(), { persistCount: 0, dispatchCount: 0 });
}

// B — scenarioIds absent: materialization may resolve all READY scenarios, but mutation Direct Run still fails closed.
{
  const { deps, counts } = makeDeps({ methods: ['POST', 'POST'], ids: ['test_ready_a', 'test_ready_b'] });
  const input = {
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: artifact.testDesignVersionId,
    environmentId,
    scenarioIds: null,
    confirmDiscoveredRuntime: false,
  };
  await assert.rejects(
    createRunV1({
      env: {}, organizationId, projectId, userId: 'usr_fix_d', input,
      idempotencyKey: 'fix-d:implicit-ready:12345678', deps,
    }),
    (error) => error?.code === 'RUN_MUTATION_REQUIRES_SINGLE_SCENARIO'
      && error?.publicDetails?.scenarioCount === 2,
  );
  assert.deepEqual(counts(), { persistCount: 0, dispatchCount: 0 });
}

// D — one mutation scenario is still valid.
{
  const { result, counts } = await createWith(['POST'], ['test_only'], 'single');
  assert.equal(result.run.scenarioCount, 1);
  assert.deepEqual(counts(), { persistCount: 1, dispatchCount: 1 });
}

// Existing invalid Direct Runs created before FIX-1 must not be re-dispatched on idempotent replay.
{
  const input = {
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: artifact.testDesignVersionId,
    environmentId,
    scenarioIds: ['test_old_a', 'test_old_b'],
    confirmDiscoveredRuntime: false,
  };
  const requestFingerprint = await fingerprintRunCreateInput(input);
  const existingRun = {
    runId: 'run_existing_invalid',
    organizationId,
    projectId,
    testDesignId: artifact.testDesignId,
    testDesignVersionId: artifact.testDesignVersionId,
    testDesignVersion: 1,
    endpointId: artifact.endpointId,
    environmentId,
    executionPlanId: 'xplan_existing_invalid',
    runtimeSnapshotId: 'rts_existing_invalid',
    scenarioCount: 2,
    scenarioIds: ['test_old_a', 'test_old_b'],
    requestFingerprint,
  };
  const existingBundle = {
    run: existingRun,
    runtimeSnapshot: { runtimeSnapshotId: existingRun.runtimeSnapshotId },
    executionPlan: {
      executionPlanId: existingRun.executionPlanId,
      runtimeSnapshotId: existingRun.runtimeSnapshotId,
      plan: {
        scenarios: [
          { scenarioId: 'test_old_a', spec: { target: { method: 'POST' } } },
          { scenarioId: 'test_old_b', spec: { target: { method: 'POST' } } },
        ],
      },
    },
  };
  const { deps, counts } = makeDeps({ existing: existingRun, existingBundle, methods: ['POST', 'POST'] });
  await assert.rejects(
    createRunV1({
      env: {}, organizationId, projectId, userId: 'usr_fix_d', input,
      idempotencyKey: 'fix-d:existing:12345678', deps,
    }),
    (error) => error?.code === 'RUN_MUTATION_REQUIRES_SINGLE_SCENARIO',
  );
  assert.deepEqual(counts(), { persistCount: 0, dispatchCount: 0 });
}

console.log('07.7.8-D FIX-1 Direct Mutation Run Isolation: PASS ✅');

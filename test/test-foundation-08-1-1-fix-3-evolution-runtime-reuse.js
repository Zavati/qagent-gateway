import assert from 'node:assert/strict';
import { discoveredRuntimeServiceKey } from '../src/intelligence/discoveredRuntime.js';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';
import {
  buildEvolutionConfirmedRuntimeReuse,
  createEvolutionRerunV1,
} from '../src/services/evolutionRerunService.js';

const organizationId = 'org_fix3';
const projectId = 'prj_fix3';
const environmentId = 'env_fix3';
const endpointId = 'cep_fix3';
const scenarioId = 'test_001';
const sourceRunId = 'run_source_fix3';
const origin = 'https://opensource-demo.orangehrmlive.com';
const serviceKey = discoveredRuntimeServiceKey(origin);

function sourceBundle(source = 'DISCOVERED_OBSERVATION') {
  return {
    run: {
      runId: sourceRunId,
      organizationId,
      projectId,
      endpointId,
      environmentId,
      scenarioIds: [scenarioId],
    },
    runtimeSnapshot: {
      runtimeSnapshotId: 'rts_source_fix3',
      requiresExecutionConfirmation: false,
      resolutionConfidence: 'HIGH',
      snapshot: {
        environment: { environmentId, name: 'STG' },
        resolution: {
          source,
          confidence: source === 'DISCOVERED_OBSERVATION' ? 'HIGH' : 'CONFIRMED',
          requiresExecutionConfirmation: false,
        },
        apiServices: {
          [serviceKey]: {
            apiServiceId: null,
            name: 'OrangeHRM discovered',
            serviceKey,
            baseUrl: origin,
          },
        },
        // These must never be copied into the reuse token.
        authProfiles: { auth_1: { credentialsConfigured: true, config: { secret: 'must-not-copy' } } },
        testData: { fixed: { 'QUERY:limit': { value: 123 } }, secrets: { x: { secretId: 'sec_1' } } },
      },
    },
    latestAttempt: {
      runtimeReadinessStatus: 'READY',
      httpExecutionStatus: 'COMPLETED',
      httpResponseCount: 6,
    },
  };
}

const reuse = buildEvolutionConfirmedRuntimeReuse(sourceBundle(), {
  organizationId,
  projectId,
  environmentId,
  scenarioId,
});
assert.equal(reuse.kind, 'EVOLUTION_CONFIRMED_RUNTIME_REUSE');
assert.equal(reuse.sourceRunId, sourceRunId);
assert.equal(reuse.apiServices[serviceKey].baseUrl, origin);
assert.equal('authProfiles' in reuse, false);
assert.equal('testData' in reuse, false);

let capturedCreate = null;
const created = await createEvolutionRerunV1({
  env: {},
  organizationId,
  projectId,
  userId: 'usr_fix3',
  sourceRunId,
  testDesignVersionId: 'tdv_fix3_v5',
  environmentId,
  scenarioId,
  idempotencyKey: 'test-evolution-rerun:tep_fix3:tdv_fix3_v5',
  deps: {
    getRunBundle: async () => sourceBundle(),
    createRun: async (args) => {
      capturedCreate = args;
      return { run: { runId: 'run_rerun_fix3', status: 'QUEUED' } };
    },
  },
});
assert.equal(capturedCreate.input.confirmDiscoveredRuntime, false);
assert.equal(capturedCreate.runtimeReuse.sourceRunId, sourceRunId);
assert.equal(capturedCreate.runtimeReuse.apiServices[serviceKey].baseUrl, origin);
assert.equal(created.evolutionRuntimeReuse.reusedDiscoveredRuntime, true);
assert.equal(created.evolutionRuntimeReuse.strategy, 'CONFIRMED_SOURCE_RUNTIME_TARGET');

// Explicit-config source runs do not pin old explicit URLs; the Environment is
// resolved fresh and no special reuse token is passed.
let explicitCaptured = undefined;
const explicitCreated = await createEvolutionRerunV1({
  env: {},
  organizationId,
  projectId,
  sourceRunId,
  testDesignVersionId: 'tdv_fix3_v5',
  environmentId,
  scenarioId,
  idempotencyKey: 'test-evolution-rerun:tep_fix3_explicit:tdv_fix3_v5',
  deps: {
    getRunBundle: async () => sourceBundle('EXPLICIT_CONFIG'),
    createRun: async (args) => {
      explicitCaptured = args.runtimeReuse;
      return { run: { runId: 'run_rerun_explicit', status: 'QUEUED' } };
    },
  },
});
assert.equal(explicitCaptured, null);
assert.equal(explicitCreated.evolutionRuntimeReuse.reusedDiscoveredRuntime, false);
assert.equal(explicitCreated.evolutionRuntimeReuse.strategy, 'FRESH_EXPLICIT_ENVIRONMENT_CONFIG');

// Runtime target reuse bypasses only the confirmation prompt. The new
// Execution Plan is still materialized from the new Test Design Version.
const artifact = {
  organizationId,
  projectId,
  endpointId,
  testDesignId: 'td_fix3',
  testDesignVersionId: 'tdv_fix3_v5',
  version: 5,
  specificationVersion: 'qagent.test-spec.v1',
  contextFingerprint: 'ctx_fix3',
  specification: {
    contractVersion: 'qagent.test-design.v1',
    specificationVersion: 'qagent.test-spec.v1',
    source: { organizationId, projectId, endpointId },
    scenarios: [{
      scenarioId,
      title: 'Request-aware evolved scenario',
      category: 'HAPPY_PATH',
      priority: 'HIGH',
      confidence: 'HIGH',
      automation: { readiness: 'READY', evolutionState: 'STABLE' },
      spec: {
        dslVersion: 'qagent.api-test-dsl.v1',
        type: 'api',
        target: { apiServiceKey: serviceKey, method: 'GET', path: '/web/index.php/api/v2/pim/employees/{id}/screen/contact/attachments' },
        auth: { requirement: 'NONE' },
        request: { pathParams: { id: '7' }, query: {}, headers: {}, body: null },
        assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }],
        testData: { contractVersion: 'qagent.test-data-bindings.v1', bindings: [] },
      },
    }],
  },
};
const runtimeConfig = {
  organizationId,
  projectId,
  environment: { environmentId, name: 'STG', slug: 'stg', environmentType: 'STG' },
  apiServices: {},
  variables: {},
  authProfiles: {},
};
let catalogDiscoveryCalled = false;
const materialized = await materializeExecutionPlanV1({
  organizationId,
  projectId,
  artifact,
  environmentId,
  requestedScenarioIds: [scenarioId],
  confirmDiscoveredRuntime: false,
  confirmedRuntimeReuse: reuse,
  runId: 'run_new_fix3',
  executionPlanId: 'xplan_new_fix3',
  runtimeSnapshotId: 'rts_new_fix3',
  createdAt: '2026-09-06T20:00:00.000Z',
  resolveRuntime: async () => runtimeConfig,
  loadEndpoint: async () => { catalogDiscoveryCalled = true; throw new Error('must not rediscover'); },
  loadEvidence: async () => { catalogDiscoveryCalled = true; throw new Error('must not rediscover'); },
});
assert.equal(catalogDiscoveryCalled, false);
assert.equal(materialized.runtimeSnapshot.apiServices[serviceKey].baseUrl, origin);
assert.equal(materialized.runtimeSnapshot.resolution.source, 'DISCOVERED_OBSERVATION');
assert.equal(materialized.runtimeSnapshot.resolution.requiresExecutionConfirmation, false);
assert.equal(materialized.runtimeSnapshot.resolution.reuse.sourceRunId, sourceRunId);
assert.equal(materialized.executionPlan.testDesign.version, 5);

// Reuse is fail-closed if someone tries to cross endpoint boundaries.
await assert.rejects(
  () => materializeExecutionPlanV1({
    organizationId,
    projectId,
    artifact: { ...artifact, endpointId: 'cep_other', specification: { ...artifact.specification, source: { organizationId, projectId, endpointId: 'cep_other' } } },
    environmentId,
    requestedScenarioIds: [scenarioId],
    confirmedRuntimeReuse: reuse,
    runId: 'run_bad_fix3',
    executionPlanId: 'xplan_bad_fix3',
    runtimeSnapshotId: 'rts_bad_fix3',
    createdAt: '2026-09-06T20:01:00.000Z',
    resolveRuntime: async () => runtimeConfig,
  }),
  (error) => error?.code === 'RUN_EVOLUTION_RUNTIME_REUSE_SCOPE_MISMATCH',
);

console.log('Foundation 08.1.1 FIX-3 Evolution Runtime Snapshot Reuse: PASS');

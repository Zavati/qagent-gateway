import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import {
  EXECUTION_PLAN_CONTRACT_VERSION,
  RUN_CONTRACT_VERSION,
  RUN_CREATE_CONTRACT_VERSION,
  RUN_REQUESTED_CONTRACT_VERSION,
  RUNTIME_SNAPSHOT_CONTRACT_VERSION,
  buildRunRequestedMessage,
  normalizeIdempotencyKey,
  normalizeRunCreateInput,
} from '../src/lib/runContracts.js';
import { getRunnerTestArtifact } from '../src/services/testRegistryClient.js';
import {
  materializeExecutionPlanV1,
  materializeSchemaSnapshotsV1,
} from '../src/services/executionPlanMaterializerService.js';
import { createRunV1 } from '../src/services/runService.js';
import { postConsoleRun } from '../src/handlers/consoleRuns.js';

const organizationId = 'org_0772';
const projectId = 'prj_0772';
const endpointId = 'cep_0772_orders';
const environmentId = 'env_0772_stg';
const testDesignVersionId = 'tdv_0772_12345678';
const testDesignId = 'td_0772_root';
const fingerprint = 'a'.repeat(64);

assert.equal(RUN_CREATE_CONTRACT_VERSION, 'qagent.run-create.v1');
assert.equal(RUN_CONTRACT_VERSION, 'qagent.run.v1');
assert.equal(RUNTIME_SNAPSHOT_CONTRACT_VERSION, 'qagent.runtime-snapshot.v1');
assert.equal(EXECUTION_PLAN_CONTRACT_VERSION, 'qagent.execution-plan.v1');
assert.equal(RUN_REQUESTED_CONTRACT_VERSION, 'qagent.run-requested.v1');
assert.deepEqual(buildRunRequestedMessage('run_12345678'), {
  contractVersion: 'qagent.run-requested.v1', runId: 'run_12345678',
});

const normalized = normalizeRunCreateInput({
  contractVersion: 'qagent.run-create.v1',
  testDesignVersionId,
  environmentId,
  scenarioIds: ['test_002', 'test_001', 'test_001'],
});
assert.deepEqual(normalized.scenarioIds, ['test_001', 'test_002']);
assert.equal(normalizeIdempotencyKey('run-create:12345678'), 'run-create:12345678');
assert.throws(() => normalizeRunCreateInput({ contractVersion: 'wrong' }), /contractVersion/);
assert.throws(() => normalizeIdempotencyKey('short'), /Idempotency-Key/);

const readyScenario = {
  scenarioId: 'test_001',
  title: 'GET orders',
  category: 'HAPPY_PATH',
  priority: 'HIGH',
  confidence: 'HIGH',
  grounding: { level: 'OBSERVED', rationale: [], evidenceRefs: ['ev_1'], schemaRefs: ['sv_res_1'] },
  automation: { readiness: 'READY', blockers: [] },
  spec: {
    dslVersion: 'qagent.api-test-dsl.v1',
    type: 'api',
    target: { catalogEndpointId: endpointId, apiServiceKey: 'core-api', method: 'GET', path: '/core-api/orders' },
    auth: { requirement: 'NONE', authProfileRef: null },
    request: { pathParams: {}, query: {}, headers: {}, body: {} },
    assertions: [
      { type: 'STATUS', expectedStatusCodes: [200] },
      { type: 'SCHEMA', schemaRef: 'sv_res_1' },
    ],
    extract: [],
  },
};

const needsDataScenario = {
  ...structuredClone(readyScenario),
  scenarioId: 'test_002',
  title: 'Needs data',
  automation: { readiness: 'NEEDS_DATA', blockers: ['fixture required'] },
};

const specification = {
  contractVersion: 'qagent.test-design.v1',
  specificationVersion: 'qagent.test-spec.v1',
  source: { type: 'CATALOG_ENDPOINT', organizationId, projectId, endpointId },
  title: 'Orders test design',
  objective: 'Execute safely',
  assumptions: [],
  summary: {
    scenarioCount: 2,
    readyCount: 1,
    byCategory: { HAPPY_PATH: 2 },
    byReadiness: { READY: 1, NEEDS_DATA: 1 },
    byGrounding: { OBSERVED: 2 },
  },
  scenarios: [readyScenario, needsDataScenario],
  generation: { mode: 'AI', provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-21T00:00:00.000Z', contextFingerprint: fingerprint },
};

const artifact = {
  testDesignId,
  testDesignVersionId,
  version: 3,
  organizationId,
  projectId,
  endpointId,
  contextFingerprint: fingerprint,
  specificationVersion: 'qagent.test-spec.v1',
  createdAt: '2026-08-21T00:00:00.000Z',
  specification,
};

// Exact pinned tdv_* retrieval uses the frozen Runner contract and authoritative internal scope headers.
let capturedRegistryRequest;
const registryArtifact = await getRunnerTestArtifact({
  env: {}, organizationId, projectId, testDesignVersionId,
  fetchImpl: async (request) => {
    capturedRegistryRequest = request;
    return new Response(JSON.stringify({
      status: 'ok',
      data: { contractVersion: 'qagent.runner-test-artifact.v1', artifact },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(capturedRegistryRequest.url, `https://qagent-test-registry.internal/v1/test-registry/runner/test-design-versions/${testDesignVersionId}`);
assert.equal(capturedRegistryRequest.headers.get('x-qagent-organization-id'), organizationId);
assert.equal(capturedRegistryRequest.headers.get('x-qagent-project-id'), projectId);
assert.equal(registryArtifact.testDesignVersionId, testDesignVersionId);

const catalogSchemas = {
  endpointId,
  tracks: [{
    schemaTrackId: 'track_response_200',
    direction: 'RESPONSE',
    statusCode: 200,
    currentSchemaVersionId: 'sv_res_1',
    currentSchemaHash: 'hash_res_1',
    versions: [{
      schemaVersionId: 'sv_res_1', schemaHash: 'hash_res_1',
      schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      contentTypes: [{ contentType: 'application/json' }],
    }],
  }],
};

const snapshots = materializeSchemaSnapshotsV1(catalogSchemas, ['sv_res_1']);
assert.equal(snapshots.length, 1);
assert.equal(snapshots[0].schemaVersionId, 'sv_res_1');
assert.equal(snapshots[0].refType, 'VERSION');
assert.equal(snapshots[0].schema.properties.id.type, 'string');

const runtimeConfig = {
  organizationId,
  projectId,
  environment: {
    environmentId, name: 'Homologação', slug: 'homologacao', environmentType: 'STG',
    webBaseUrl: 'https://app.example.com', isDefault: true,
  },
  apiServices: {
    'core-api': { apiServiceId: 'apisvc_core', name: 'Core API', baseUrl: 'https://api-stg.example.com' },
  },
  variables: { CUSTOMER_ID: 'customer-1' },
  authProfiles: {},
};

const materialized = await materializeExecutionPlanV1({
  env: {}, organizationId, projectId, artifact, environmentId,
  requestedScenarioIds: ['test_001'],
  runId: 'run_0772_12345678',
  executionPlanId: 'xplan_0772_12345678',
  runtimeSnapshotId: 'rts_0772_12345678',
  createdAt: '2026-08-21T01:00:00.000Z',
  resolveRuntime: async () => runtimeConfig,
  loadSchemas: async () => catalogSchemas,
});
assert.deepEqual(materialized.selectedScenarioIds, ['test_001']);
assert.equal(materialized.runtimeSnapshot.contractVersion, 'qagent.runtime-snapshot.v1');
assert.equal(materialized.runtimeSnapshot.resolution.source, 'EXPLICIT_CONFIG');
assert.equal(materialized.runtimeSnapshot.resolution.confidence, 'CONFIRMED');
assert.equal(materialized.runtimeSnapshot.resolution.requiresExecutionConfirmation, false);
assert.equal(materialized.runtimeSnapshot.apiServices['core-api'].baseUrl, 'https://api-stg.example.com');
assert.deepEqual(materialized.runtimeSnapshot.variables, {});
assert.deepEqual(materialized.runtimeSnapshot.availableVariableKeys, ['CUSTOMER_ID']);
assert.equal(JSON.stringify(materialized.runtimeSnapshot).includes('customer-1'), false, 'unreferenced variable values must not be copied into the snapshot');
assert.equal(materialized.executionPlan.contractVersion, 'qagent.execution-plan.v1');
assert.equal(materialized.executionPlan.testDesign.testDesignVersionId, testDesignVersionId);
assert.equal(materialized.executionPlan.schemaSnapshots[0].schemaVersionId, 'sv_res_1');
assert.match(materialized.executionPlan.planHash, /^[0-9a-f]{64}$/);
assert.match(materialized.runtimeSnapshot.snapshotHash, /^[0-9a-f]{64}$/);

await assert.rejects(
  materializeExecutionPlanV1({
    env: {}, organizationId, projectId, artifact, environmentId,
    requestedScenarioIds: ['test_002'],
    runId: 'run_0772_abcdefgh', executionPlanId: 'xplan_0772_abcdefgh', runtimeSnapshotId: 'rts_0772_abcdefgh',
    createdAt: '2026-08-21T01:00:00.000Z',
    resolveRuntime: async () => runtimeConfig,
    loadSchemas: async () => catalogSchemas,
  }),
  (error) => error?.code === 'RUN_SCENARIO_NOT_EXECUTABLE' && error?.publicDetails?.readiness === 'NEEDS_DATA',
);

await assert.rejects(
  materializeExecutionPlanV1({
    env: {}, organizationId, projectId, artifact, environmentId,
    requestedScenarioIds: ['test_001'],
    runId: 'run_0772_missing', executionPlanId: 'xplan_0772_missing', runtimeSnapshotId: 'rts_0772_missing',
    createdAt: '2026-08-21T01:00:00.000Z',
    resolveRuntime: async () => ({ ...runtimeConfig, apiServices: {} }),
    loadSchemas: async () => catalogSchemas,
  }),
  (error) => error?.code === 'RUN_API_SERVICE_ENVIRONMENT_BINDING_MISSING',
);

// Run creation persists exactly one pinned artifact/plan and replays the same idempotency key.
let persistedBundle = null;
const deps = {
  getRunByIdempotencyKey: async () => persistedBundle?.run || null,
  getRunBundle: async () => persistedBundle,
  getRunnerTestArtifact: async () => artifact,
  materializeExecutionPlan: async ({ runId, executionPlanId, runtimeSnapshotId, createdAt }) => {
    const out = structuredClone(materialized);
    out.runtimeSnapshot.runId = runId;
    out.runtimeSnapshot.runtimeSnapshotId = runtimeSnapshotId;
    out.runtimeSnapshot.createdAt = createdAt;
    out.executionPlan.runId = runId;
    out.executionPlan.executionPlanId = executionPlanId;
    out.executionPlan.runtimeSnapshotId = runtimeSnapshotId;
    out.executionPlan.createdAt = createdAt;
    return out;
  },
  dispatchRun: async ({ bundle }) => bundle,
  createRunArtifacts: async (_env, payload) => {
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
    };
    return persistedBundle;
  },
};

const createInput = normalizeRunCreateInput({
  contractVersion: 'qagent.run-create.v1', testDesignVersionId, environmentId, scenarioIds: ['test_001'],
});
const created = await createRunV1({
  env: {}, organizationId, projectId, userId: 'usr_1', input: createInput,
  idempotencyKey: 'run-create:0772:0001', deps,
});
assert.equal(created.contractVersion, 'qagent.run.v1');
assert.equal(created.run.status, 'CREATED');
assert.equal(created.run.testDesignVersionId, testDesignVersionId);
assert.equal(created.run.scenarioCount, 1);
assert.equal(created.idempotentReplay, false);
assert.equal(created.runtime.resolution.source, 'EXPLICIT_CONFIG');

const replay = await createRunV1({
  env: {}, organizationId, projectId, userId: 'usr_1', input: createInput,
  idempotencyKey: 'run-create:0772:0001', deps,
});
assert.equal(replay.run.runId, created.run.runId);
assert.equal(replay.idempotentReplay, true);

await assert.rejects(
  createRunV1({
    env: {}, organizationId, projectId, userId: 'usr_1',
    input: { ...createInput, environmentId: 'env_0772_other' },
    idempotencyKey: 'run-create:0772:0001', deps,
  }),
  (error) => error?.code === 'RUN_IDEMPOTENCY_CONFLICT',
);

// Console authorization happens before Run creation.
const order = [];
const handlerResponse = await postConsoleRun(
  new Request(`https://api.apiqagent.com/v1/console/projects/${projectId}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'run-create:handler:1' },
    body: JSON.stringify({ contractVersion: RUN_CREATE_CONTRACT_VERSION, testDesignVersionId, environmentId, scenarioIds: ['test_001'] }),
  }),
  {},
  { projectId },
  {
    requireTenant: async () => { order.push('tenant'); return { organizationId, organizationRole: 'member', user: { userId: 'usr_1' } }; },
    getProject: async () => { order.push('project'); },
    createRun: async ({ input, idempotencyKey }) => { order.push('run'); assert.equal(input.testDesignVersionId, testDesignVersionId); assert.equal(idempotencyKey, 'run-create:handler:1'); return created; },
  },
);
assert.deepEqual(order, ['tenant', 'project', 'run']);
assert.equal(handlerResponse.status, 'ok');
assert.equal(handlerResponse.data.run.status, 'CREATED');

// Router contract.
assert.deepEqual(
  resolveGatewayRoute('POST', `/v1/console/projects/${projectId}/runs`),
  { name: 'consoleRunsCreate', params: { projectId } },
);
assert.deepEqual(
  resolveGatewayRoute('GET', `/v1/console/projects/${projectId}/runs/run_12345678`),
  { name: 'consoleRunGet', params: { projectId, runId: 'run_12345678' } },
);
assert.equal(resolveGatewayRoute('DELETE', `/v1/console/projects/${projectId}/runs/run_12345678`), null);

// D1 schema freezes run/runtime/plan contracts and idempotency.
const migration = await readFile(new URL('../migrations/0005_foundation_07_7_2_run_contract_execution_plan.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS runs/);
assert.match(migration, /qagent\.run\.v1/);
assert.match(migration, /UNIQUE \(organization_id, project_id, idempotency_key\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS runtime_snapshots/);
assert.match(migration, /DISCOVERED_OBSERVATION/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_plans/);
assert.match(migration, /qagent\.execution-plan\.v1/);

// 07.7.2 materializer itself performs no external HTTP execution; later foundations may add queue bindings.
const materializerSource = await readFile(new URL('../src/services/executionPlanMaterializerService.js', import.meta.url), 'utf8');
assert.doesNotMatch(materializerSource, /fetch\s*\(/);

console.log('Foundation 07.7.2 Run Contract + Execution Plan tests passed ✅');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveObservedTestDataForRun } from '../src/services/observedTestDataRuntimeResolver.js';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';

const organizationId = 'org_c2d';
const projectId = 'prj_c2d';
const endpointId = 'cep_c2d_employee';
const environmentId = 'env_c2d_stg';

function observedBinding(selector, valueType = 'STRING') {
  return { target: 'BODY', selector, source: 'OBSERVED', valueType, bindingKey: `BODY:${selector}` };
}

function readyScenario(scenarioId, bindings) {
  return {
    scenarioId,
    title: scenarioId,
    category: 'HAPPY_PATH',
    priority: 'HIGH',
    confidence: 'HIGH',
    grounding: { level: 'OBSERVED', rationale: [], evidenceRefs: [], schemaRefs: [] },
    automation: { readiness: 'READY', blockers: [] },
    spec: {
      dslVersion: 'qagent.api-test-dsl.v1',
      type: 'api',
      target: { catalogEndpointId: endpointId, apiServiceKey: 'employee-api', method: 'POST', path: '/employees' },
      auth: { requirement: 'NONE', authProfileRef: null },
      request: { pathParams: {}, query: {}, headers: {}, body: {} },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }],
      extract: [],
      testData: { contractVersion: 'qagent.test-data-bindings.v1', bindings },
    },
  };
}

const correlatedScenarios = [readyScenario('happy_001', [
  observedBinding('$.employeeId'),
  observedBinding('$.departmentId', 'INTEGER'),
])];
let sampleQuery;
let scalarQueryCount = 0;
const correlated = await resolveObservedTestDataForRun({
  env: {}, organizationId, projectId, endpointId, environmentId,
  selectedScenarios: correlatedScenarios,
  loadSamples: async (input) => {
    sampleQuery = input;
    return [{
      environmentId,
      encoding: 'JSON',
      sampleFingerprint: 'otds_1234567890abcdef1234567890abcdef12345678',
      observationCount: 4,
      successCount: 4,
      lastSeenAt: '2026-08-31T10:00:00.000Z',
      values: [
        { target: 'BODY', selector: '$.employeeId', valueType: 'STRING', value: 'EMP-001' },
        { target: 'BODY', selector: '$.departmentId', valueType: 'INTEGER', value: 7 },
      ],
    }];
  },
  loadValues: async () => { scalarQueryCount += 1; return []; },
});
assert.equal(sampleQuery.environmentId, environmentId);
assert.equal(sampleQuery.outcomeClass, 'HTTP_2XX');
assert.equal(correlated.resolvedCount, 2);
assert.equal(correlated.correlatedSampleBindingCount, 2);
assert.equal(correlated.scalarFallbackBindingCount, 0);
assert.equal(scalarQueryCount, 0);
assert.equal(correlated.frozenByBindingKey['BODY:$.employeeId'].value, 'EMP-001');
assert.equal(correlated.frozenByBindingKey['BODY:$.departmentId'].value, 7);
assert.equal(correlated.provenanceByBindingKey['BODY:$.employeeId'].resolutionMode, 'CORRELATED_SAMPLE');
assert.equal(JSON.stringify(correlated.provenanceByBindingKey).includes('EMP-001'), false, 'provenance must never contain the observed literal');

let scalarQuery;
const scalar = await resolveObservedTestDataForRun({
  env: {}, organizationId, projectId, endpointId, environmentId,
  selectedScenarios: [readyScenario('duplicate_001', [observedBinding('$.employeeId')])],
  loadSamples: async () => [],
  loadValues: async (input) => {
    scalarQuery = input;
    return [{
      environmentId,
      target: 'BODY', selector: '$.employeeId', valueType: 'STRING', value: 'EMP-EXISTING',
      valueFingerprint: 'otdv_abcdef1234567890abcdef1234567890abcdef12',
      observationCount: 3, successCount: 3, lastSeenAt: '2026-08-31T11:00:00.000Z',
    }];
  },
});
assert.equal(scalarQuery.environmentId, environmentId);
assert.equal(scalarQuery.selector, '$.employeeId');
assert.equal(scalarQuery.outcomeClass, 'HTTP_2XX');
assert.equal(scalar.scalarFallbackBindingCount, 1);
assert.equal(scalar.frozenByBindingKey['BODY:$.employeeId'].value, 'EMP-EXISTING');
assert.equal(JSON.stringify(scalar.provenanceByBindingKey).includes('EMP-EXISTING'), false);

await assert.rejects(
  resolveObservedTestDataForRun({
    env: {}, organizationId, projectId, endpointId, environmentId,
    selectedScenarios: correlatedScenarios,
    loadSamples: async () => [],
    loadValues: async () => [],
  }),
  (error) => error?.code === 'RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING',
);

await assert.rejects(
  resolveObservedTestDataForRun({
    env: {}, organizationId, projectId, endpointId, environmentId,
    selectedScenarios: [readyScenario('unsafe_001', [observedBinding('$.password')])],
    loadSamples: async () => [],
    loadValues: async () => [],
  }),
  (error) => error?.code === 'RUN_OBSERVED_TEST_DATA_BINDING_INVALID',
);

const artifactScenario = readyScenario('create_employee_success', [
  observedBinding('$.employeeId'),
  { target: 'BODY', selector: '$.firstName', source: 'GENERATED', valueType: 'STRING', generator: { kind: 'FIRST_NAME', config: {} } },
]);
const artifact = {
  testDesignId: 'td_c2d',
  testDesignVersionId: 'tdv_c2d_12345678',
  version: 2,
  organizationId,
  projectId,
  endpointId,
  contextFingerprint: 'a'.repeat(64),
  specificationVersion: 'qagent.test-spec.v1',
  createdAt: '2026-08-31T12:00:00.000Z',
  specification: {
    contractVersion: 'qagent.test-design.v1',
    specificationVersion: 'qagent.test-spec.v1',
    source: { type: 'CATALOG_ENDPOINT', organizationId, projectId, endpointId },
    title: 'Employee create', objective: 'Create employee', assumptions: [],
    summary: { scenarioCount: 1, readyCount: 1, byCategory: { HAPPY_PATH: 1 }, byReadiness: { READY: 1 }, byGrounding: { OBSERVED: 1 } },
    scenarios: [artifactScenario],
    generation: { mode: 'AI', provider: 'openai', model: 'test', generatedAt: '2026-08-31T12:00:00.000Z', contextFingerprint: 'a'.repeat(64) },
  },
};
const runtimeConfig = {
  organizationId, projectId,
  environment: { environmentId, name: 'STG', slug: 'stg', environmentType: 'STG', webBaseUrl: 'https://app.example.test', isDefault: true },
  apiServices: { 'employee-api': { apiServiceId: 'apisvc_employee', name: 'Employee API', baseUrl: 'https://api.example.test' } },
  variables: {}, authProfiles: {},
};
const materialized = await materializeExecutionPlanV1({
  env: {}, organizationId, projectId, artifact, environmentId,
  requestedScenarioIds: ['create_employee_success'],
  runId: 'run_c2d_12345678', executionPlanId: 'xplan_c2d_12345678', runtimeSnapshotId: 'rts_c2d_12345678',
  createdAt: '2026-08-31T12:01:00.000Z',
  resolveRuntime: async () => runtimeConfig,
  loadSchemas: async () => ({ endpointId, tracks: [] }),
  resolveObservedTestData: async () => ({
    contractVersion: 'qagent.observed-test-data-runtime-resolution.v1',
    frozenByBindingKey: {
      'BODY:$.employeeId': { target: 'BODY', selector: '$.employeeId', valueType: 'STRING', value: 'EMP-FROZEN' },
    },
    provenanceByBindingKey: {
      'BODY:$.employeeId': {
        source: 'OBSERVED', resolutionMode: 'CORRELATED_SAMPLE', environmentId,
        sampleFingerprint: 'otds_abcdef1234567890abcdef1234567890abcdef12', observationCount: 2, successCount: 2,
      },
    },
    resolvedCount: 1, correlatedSampleBindingCount: 1, scalarFallbackBindingCount: 0, durationMs: 1,
  }),
});
assert.equal(artifact.specification.scenarios[0].spec.testData.bindings[0].source, 'OBSERVED', 'immutable Test Design must remain OBSERVED');
assert.equal(materialized.runtimeSnapshot.testData.fixed['BODY:$.employeeId'].value, 'EMP-FROZEN');
assert.equal(materialized.runtimeSnapshot.testData.observedResolution.resolvedCount, 1);
assert.equal(materialized.runtimeSnapshot.testData.observedProvenance['BODY:$.employeeId'].source, 'OBSERVED');
assert.equal(JSON.stringify(materialized.runtimeSnapshot.testData.observedProvenance).includes('EMP-FROZEN'), false);
assert.equal(materialized.executionPlan.scenarios[0].spec.testData.bindings[0].source, 'FIXED', 'Runner must reuse the existing frozen FIXED materialization path');
assert.equal(materialized.executionPlan.scenarios[0].spec.testData.bindings[1].source, 'GENERATED');
assert.equal(JSON.stringify(materialized.executionPlan).includes('EMP-FROZEN'), false, 'Execution Plan must not carry the observed literal');
assert.equal(JSON.stringify(materialized.runtimeSnapshot).includes('EMP-FROZEN'), true, 'non-secret observed value must be frozen only in the immutable Runtime Snapshot');

// C2-D must enable runtime-backed OBSERVED during Test Design generation.
const testDesignServiceSource = fs.readFileSync(new URL('../src/intelligence/testDesignService.js', import.meta.url), 'utf8');
assert.match(testDesignServiceSource, /observedRuntimeEnabled:\s*true/);

// Suite fan-out must keep using the exact same child Run creation path; no parallel C2-D architecture.
const suiteRunServiceSource = fs.readFileSync(new URL('../src/services/suiteRunService.js', import.meta.url), 'utf8');
assert.match(suiteRunServiceSource, /import \{ createRunV1 \} from '\.\/runService\.js'/);
assert.match(suiteRunServiceSource, /deps\.createRun\|\|createRunV1/);
assert.equal(suiteRunServiceSource.includes('observedTestDataRuntimeResolver'), false);

console.log('Foundation 07.7.8-C2-D Observed Runtime Resolution tests passed ✅');

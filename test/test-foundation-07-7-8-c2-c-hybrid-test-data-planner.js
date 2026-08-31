import assert from 'node:assert/strict';
import { buildCatalogTestDesignContextV1 } from '../src/intelligence/catalogContextBuilder.js';
import { applyTestDataPlannerV1 } from '../src/intelligence/testDataPlanner.js';
import { buildTestSpecificationV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

const endpointId = 'cep_leave';
const endpointDetail = {
  endpointId,
  serviceId: 'svc_leave',
  serviceName: 'Leave API',
  classification: 'FIRST_PARTY_API',
  classificationConfidence: 99,
  method: 'POST',
  normalizedPath: '/leave-requests',
  discoveryConfidenceScore: 99,
  discoveryConfidenceLevel: 'HIGH',
  lifecycleState: 'DISCOVERED',
  observationCount: 10,
  sessionCount: 1,
  environmentCount: 1,
  successRatePct: 100,
  latencyAvgMs: 100,
  firstSeenAt: '2026-08-31T00:00:00.000Z',
  lastSeenAt: '2026-08-31T01:00:00.000Z',
  environments: [{ environmentId: 'env_stg', observationCount: 10, successRatePct: 100, lastSeenAt: '2026-08-31T01:00:00.000Z' }],
  bindings: [{ environmentId: 'env_stg', scheme: 'https', host: 'api.example.com', hostname: 'api.example.com', port: null }],
};
const requestSchema = {
  type: 'object',
  required: ['empNumber', 'leaveTypeId', 'duration', 'comment'],
  properties: {
    empNumber: { type: 'integer' },
    leaveTypeId: { type: 'integer' },
    duration: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } },
    comment: { type: 'string' },
  },
};
const schemas = { endpointId, tracks: [{
  schemaTrackId: 'cst_req', direction: 'REQUEST', statusCode: null,
  currentSchemaVersionId: 'csv_req', currentSchemaHash: 'sch_req',
  versions: [{ schemaVersionId: 'csv_req', schemaHash: 'sch_req', observationCount: 10, firstSeenAt: '2026-08-31T00:00:00.000Z', schema: requestSchema, contentTypes: [{ contentType: 'application/json' }] }],
}] };
const evidence = [{
  evidenceId: 'cev_success', environmentId: 'env_stg', observationSessionId: 'obs_1', host: 'api.example.com',
  observedAt: '2026-08-31T01:00:00.000Z', statusCode: 200, evidenceOutcomeClass: 'HTTP_2XX', latencyMs: 100,
  requestSchemaVersionId: 'csv_req', responseSchemaVersionId: null, authObserved: false, authScheme: null,
}];
const rawObservedValues = [
  { environmentId: 'env_stg', target: 'BODY', selector: '$.empNumber', valueType: 'INTEGER', value: 7, observationCount: 10, successCount: 10, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' },
  { environmentId: 'env_stg', target: 'BODY', selector: '$.leaveTypeId', valueType: 'INTEGER', value: 3, observationCount: 10, successCount: 10, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' },
  { environmentId: 'env_stg', target: 'BODY', selector: '$.duration.type', valueType: 'STRING', value: 'full_day', observationCount: 10, successCount: 10, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' },
  { environmentId: 'env_stg', target: 'BODY', selector: '$.comment', valueType: 'STRING', value: 'observed literal must not leak', observationCount: 10, successCount: 10, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' },
  { environmentId: 'env_stg', target: 'BODY', selector: '$.password', valueType: 'STRING', value: 'must-never-survive', observationCount: 1, successCount: 1, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' },
];
const rawObservedSamples = [{
  environmentId: 'env_stg', encoding: 'JSON', observationCount: 10, successCount: 10, clientErrorCount: 0, serverErrorCount: 0,
  lastSeenAt: '2026-08-31T01:00:00.000Z',
  values: rawObservedValues.map((item) => ({ target: 'BODY', selector: item.selector, valueType: item.valueType, value: item.value })),
}];
const controlPlane = {
  environments: [{ environmentId: 'env_stg', name: 'STG', status: 'active' }],
  apiServices: [{ apiServiceId: 'svc_runtime', serviceKey: 'leave-api', name: 'Leave', status: 'active' }],
  apiBindings: [{ apiServiceId: 'svc_runtime', environmentId: 'env_stg', baseUrl: 'https://api.example.com' }],
  authProfiles: [], authBindings: [], testDataBindings: [],
};

const built = await buildCatalogTestDesignContextV1({
  organizationId: 'org_test', projectId: 'prj_test', endpointId,
  catalogLoader: async () => ({
    endpointDetail, schemas, evidence,
    observedValues: rawObservedValues,
    observedSamples: rawObservedSamples,
    observedTestDataLoadStatus: 'AVAILABLE',
  }),
  controlPlaneLoader: async () => controlPlane,
});

assert.equal(built.diagnostics.builderVersion, 'qagent.catalog-context-builder.v1.8');
assert.equal(built.diagnostics.testData.observedReservoirStatus, 'AVAILABLE');
assert.equal(built.observedTestData.values.length, 4, 'sensitive observed selector must be removed from planning metadata');
assert.equal(built.observedTestData.samples[0].selectors.length, 4);
assert.equal(JSON.stringify(built.context).includes('observed literal must not leak'), false, 'observed literals must never enter AI context');
assert.equal(JSON.stringify(built.observedTestData).includes('observed literal must not leak'), false, 'planning sidecar must be metadata-only');
assert.equal(JSON.stringify(built.observedTestData).includes('must-never-survive'), false);
assert.equal(Object.hasOwn(built.observedTestData.values[0], 'value'), false);

const sameShapeDifferentLiteral = await buildCatalogTestDesignContextV1({
  organizationId: 'org_test', projectId: 'prj_test', endpointId,
  catalogLoader: async () => ({
    endpointDetail, schemas, evidence,
    observedValues: rawObservedValues.map((item) => item.selector === '$.leaveTypeId' ? { ...item, value: 999999 } : item),
    observedSamples: rawObservedSamples.map((sample) => ({
      ...sample,
      values: sample.values.map((item) => item.selector === '$.leaveTypeId' ? { ...item, value: 999999 } : item),
    })),
    observedTestDataLoadStatus: 'AVAILABLE',
  }),
  controlPlaneLoader: async () => controlPlane,
});
assert.equal(sameShapeDifferentLiteral.contextFingerprint, built.contextFingerprint, 'literal changes must not affect the planning fingerprint');

function scenario(id, { category = 'HAPPY_PATH', body = {}, status = 200, needsData = true } = {}) {
  return {
    scenarioId: id, title: id, objective: id, category, priority: 'HIGH', confidence: 'MEDIUM',
    grounding: { level: 'INFERRED', rationale: ['observed request baseline'], evidenceRefs: ['cev_success'], schemaRefs: ['cst_req'] },
    preconditions: [], authRequirement: 'NONE',
    request: { pathParams: {}, query: {}, headers: {}, body },
    assertions: [{ type: 'STATUS', expectedStatusCodes: [status] }], extract: [],
    automationHints: { needsData, reviewRequired: false, reasons: needsData ? ['O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.'] : [] },
  };
}

const model = { title: 'Hybrid', objective: 'Hybrid', assumptions: [], scenarios: [scenario('happy_001')] };
const planned = applyTestDataPlannerV1(model, built.context, { observedTestData: built.observedTestData });
const bindings = planned.plansByScenarioId.happy_001.bindings;
assert.equal(planned.diagnostics.strategy, 'HYBRID');
assert.equal(planned.diagnostics.observedCount, 3);
assert.equal(planned.diagnostics.generatedCount, 1);
assert.equal(planned.diagnostics.observedRuntimePendingCount, 3);
assert.equal(planned.diagnostics.unresolvedCount, 0);
assert.deepEqual(bindings.map((item) => [item.selector, item.source]).sort(), [
  ['$.comment', 'GENERATED'],
  ['$.duration.type', 'OBSERVED'],
  ['$.empNumber', 'OBSERVED'],
  ['$.leaveTypeId', 'OBSERVED'],
]);
assert.equal(bindings.some((item) => Object.hasOwn(item, 'value')), false, 'OBSERVED binding cannot persist the monitored literal');
assert.equal(JSON.stringify(bindings).includes('full_day'), false);
assert.equal(planned.output.scenarios[0].automationHints.needsData, true, 'C2-C must not declare OBSERVED data READY before C2-D runtime resolution');
assert.match(planned.output.scenarios[0].automationHints.reasons.join(' '), /Observed Test Data/);

// C2-D hook: once runtime resolution is explicitly enabled, the same plan becomes data-satisfied.
const runtimeReadyPlan = applyTestDataPlannerV1(model, built.context, { observedTestData: built.observedTestData, observedRuntimeEnabled: true });
assert.equal(runtimeReadyPlan.output.scenarios[0].automationHints.needsData, false);
const specification = buildTestSpecificationV1({
  context: built.context,
  modelOutput: runtimeReadyPlan.output,
  generation: { provider: 'openai', model: 'test', generatedAt: new Date().toISOString(), contextFingerprint: built.contextFingerprint },
  testDataPlans: runtimeReadyPlan.plansByScenarioId,
});
assert.doesNotThrow(() => validateTestSpecificationV1(specification, built.context));
assert.equal(specification.scenarios[0].spec.testData.bindings.filter((item) => item.source === 'OBSERVED').length, 3);

// A free-text observed field remains GENERATED under HYBRID; observed is not a blanket replay mode.
const customSchemaContext = structuredClone(built.context);
customSchemaContext.schemas[0].schema = { type: 'object', properties: { custom2: { type: 'string' } } };
const customObserved = {
  contractVersion: built.observedTestData.contractVersion,
  values: [{ environmentId: 'env_stg', target: 'BODY', selector: '$.custom2', valueType: 'STRING', observationCount: 1, successCount: 1, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' }],
  samples: [{ environmentId: 'env_stg', encoding: 'JSON', selectors: [{ target: 'BODY', selector: '$.custom2', valueType: 'STRING' }], observationCount: 1, successCount: 1, clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T01:00:00.000Z' }],
};
const customPlan = applyTestDataPlannerV1({ title: 'Custom', objective: 'Custom', assumptions: [], scenarios: [scenario('custom_001', { needsData: false })] }, customSchemaContext, { observedTestData: customObserved });
assert.equal(customPlan.plansByScenarioId.custom_001.bindings[0].source, 'GENERATED');

// Explicit QA configuration always wins over HYBRID auto-selection.
const explicitContext = structuredClone(built.context);
explicitContext.testData.configuredBindings = [{
  bindingId: 'tdb_leave', scopeType: 'ENDPOINT', environmentId: 'env_stg', target: 'BODY', selector: '$.leaveTypeId',
  sourceType: 'FIXED', valueType: 'INTEGER', generatorKind: null, generatorConfig: {}, secretConfigured: false,
}];
const explicitPlan = applyTestDataPlannerV1({ title: 'Explicit', objective: 'Explicit', assumptions: [], scenarios: [scenario('explicit_001', { body: { leaveTypeId: 999 } })] }, explicitContext, { observedTestData: built.observedTestData });
assert.equal(explicitPlan.plansByScenarioId.explicit_001.bindings.find((item) => item.selector === '$.leaveTypeId').source, 'FIXED');

// Explicit negative omission is preserved: C2-C does not repopulate a missing body in NEGATIVE scenarios.
const negative = applyTestDataPlannerV1({ title: 'Negative', objective: 'Negative', assumptions: [], scenarios: [scenario('negative_001', { category: 'NEGATIVE', body: {}, status: 400, needsData: false })] }, built.context, { observedTestData: built.observedTestData });
assert.equal(negative.plansByScenarioId.negative_001, undefined);
assert.deepEqual(negative.output.scenarios[0].request.body, {});

// Observed auto-selection is fail-closed when Environment coverage is incomplete.
const twoEnvContext = structuredClone(built.context);
twoEnvContext.environments.push({ environmentId: 'env_prod', name: 'PROD', observationCount: 1, successRatePct: 100, lastSeenAt: '2026-08-31T01:00:00.000Z' });
const partialPlan = applyTestDataPlannerV1({ title: 'Partial', objective: 'Partial', assumptions: [], scenarios: [scenario('partial_001', { body: { leaveTypeId: 1 } })] }, twoEnvContext, { observedTestData: built.observedTestData });
assert.equal(partialPlan.diagnostics.observedCoverageIncompleteCount, 3);
assert.equal(partialPlan.diagnostics.unresolvedCount, 3);
assert.match(partialPlan.output.scenarios[0].automationHints.reasons.join(' '), /não possui massa 2xx segura em todos os Environments/);

console.log('Foundation 07.7.8-C2-C Hybrid Test Data Planner tests passed ✅');

import assert from 'node:assert/strict';
import { applyTestDataPlannerV1, TEST_DATA_PLANNER_VERSION } from '../src/intelligence/testDataPlanner.js';

const context = {
  endpoint: {
    normalizedPath: '/web/index.php/api/v2/leave/employees/leave-requests',
    queryParameters: [
      { name: 'includeEmployees', baselineEligible: true },
      { name: 'limit', baselineEligible: true },
      { name: 'offset', baselineEligible: true },
    ],
  },
  environments: [{ environmentId: 'env_stg' }],
  schemas: [{
    direction: 'REQUEST',
    schema: {
      type: 'object',
      required: ['comment'],
      properties: { comment: { type: 'string' } },
    },
  }],
  testData: { configuredBindings: [] },
};

const observedTestData = {
  contractVersion: 'qagent.observed-test-data-planning-context.v1',
  values: [
    { environmentId: 'env_stg', target: 'QUERY', selector: 'includeEmployees', valueType: 'BOOLEAN', successCount: 8, observationCount: 8 },
    { environmentId: 'env_stg', target: 'QUERY', selector: 'limit', valueType: 'INTEGER', successCount: 8, observationCount: 8 },
    { environmentId: 'env_stg', target: 'QUERY', selector: 'offset', valueType: 'INTEGER', successCount: 8, observationCount: 8 },
    { environmentId: 'env_stg', target: 'BODY', selector: '$.comment', valueType: 'STRING', successCount: 8, observationCount: 8 },
  ],
  samples: [{
    environmentId: 'env_stg', encoding: 'QUERY', successCount: 8, observationCount: 8,
    selectors: [
      { target: 'QUERY', selector: 'includeEmployees', valueType: 'BOOLEAN' },
      { target: 'QUERY', selector: 'limit', valueType: 'INTEGER' },
      { target: 'QUERY', selector: 'offset', valueType: 'INTEGER' },
    ],
  }, {
    environmentId: 'env_stg', encoding: 'JSON', successCount: 8, observationCount: 8,
    selectors: [{ target: 'BODY', selector: '$.comment', valueType: 'STRING' }],
  }],
};

function scenario(id, { body = {}, query = {}, category = 'HAPPY_PATH', status = 200 } = {}) {
  return {
    scenarioId: id,
    title: id,
    objective: id,
    category,
    request: { pathParams: {}, query, headers: {}, body },
    assertions: [{ type: 'STATUS', expectedStatusCodes: [status] }],
    automationHints: { needsData: true, reviewRequired: false, reasons: [] },
  };
}

const model = {
  title: 'Observed First',
  objective: 'Observed First',
  assumptions: [],
  scenarios: [scenario('happy_001', { body: { comment: 'model-literal-must-not-win' } })],
};

const planned = applyTestDataPlannerV1(model, context, {
  observedTestData,
  observedRuntimeEnabled: true,
});

assert.equal(TEST_DATA_PLANNER_VERSION, 'qagent.test-data-planner.v1.3.0');
assert.equal(planned.diagnostics.defaultResolutionPolicy, 'OBSERVED_FIRST');

const bindings = planned.plansByScenarioId.happy_001.bindings;
assert.deepEqual(
  bindings.map((item) => [item.target, item.selector, item.source]).sort(),
  [
    ['BODY', '$.comment', 'OBSERVED'],
    ['QUERY', 'includeEmployees', 'OBSERVED'],
    ['QUERY', 'limit', 'OBSERVED'],
    ['QUERY', 'offset', 'OBSERVED'],
  ].sort(),
  'zero-config safe fields with successful observed evidence must default to OBSERVED',
);
assert.equal(bindings.some((item) => Object.hasOwn(item, 'value')), false, 'observed literals must not be persisted in Test Design');

// Manual QA choice must override the default for exactly that selector.
const explicitGeneratedContext = structuredClone(context);
explicitGeneratedContext.testData.configuredBindings = [{
  bindingId: 'tdb_includeEmployees',
  scopeType: 'ENDPOINT',
  environmentId: 'env_stg',
  target: 'QUERY',
  selector: 'includeEmployees',
  sourceType: 'GENERATED',
  valueType: 'BOOLEAN',
  generatorKind: 'BOOLEAN',
  generatorConfig: {},
  secretConfigured: false,
}];

const explicitGenerated = applyTestDataPlannerV1(model, explicitGeneratedContext, {
  observedTestData,
  observedRuntimeEnabled: true,
});
const explicitBindings = explicitGenerated.plansByScenarioId.happy_001.bindings;
assert.equal(explicitBindings.find((item) => item.selector === 'includeEmployees').source, 'GENERATED');
assert.equal(explicitBindings.find((item) => item.selector === 'limit').source, 'OBSERVED');
assert.equal(explicitBindings.find((item) => item.selector === 'offset').source, 'OBSERVED');
assert.equal(explicitBindings.find((item) => item.selector === '$.comment').source, 'OBSERVED');

// No observed evidence keeps the existing zero-config fallback.
const fallback = applyTestDataPlannerV1(model, context, {
  observedTestData: { contractVersion: observedTestData.contractVersion, values: [], samples: [] },
  observedRuntimeEnabled: true,
});
const fallbackBindings = fallback.plansByScenarioId.happy_001.bindings;
assert.equal(fallbackBindings.find((item) => item.selector === 'includeEmployees').source, 'GENERATED');
assert.equal(fallbackBindings.find((item) => item.selector === 'limit').source, 'GENERATED');
assert.equal(fallbackBindings.find((item) => item.selector === 'offset').source, 'GENERATED');
assert.equal(fallbackBindings.find((item) => item.selector === '$.comment').source, 'GENERATED');

// Correlated successful sample alone is enough for BODY baseline; scalar value metadata is optional.
const sampleOnlyObserved = {
  contractVersion: observedTestData.contractVersion,
  values: observedTestData.values.filter((item) => item.target === 'QUERY'),
  samples: observedTestData.samples,
};
const sampleOnly = applyTestDataPlannerV1(model, context, {
  observedTestData: sampleOnlyObserved,
  observedRuntimeEnabled: true,
});
assert.equal(sampleOnly.plansByScenarioId.happy_001.bindings.find((item) => item.selector === '$.comment').source, 'OBSERVED');

console.log('Foundation 07.7.8-C2 FIX-2 Observed-First Test Data Resolution tests passed ✅');

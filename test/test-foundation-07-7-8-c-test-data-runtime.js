import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTestDataPlannerV1 } from '../src/intelligence/testDataPlanner.js';
import { buildTestSpecificationV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import { isSensitiveTestDataSelector, sanitizeTestDataGeneratorConfig } from '../src/lib/testDataPolicy.js';

const context = {
  contractVersion: 'qagent.test-design.v1',
  organizationId: 'org_test',
  projectId: 'prj_test',
  endpoint: {
    endpointId: 'cep_comment', serviceId: null, serviceName: 'Comments', classification: 'FIRST_PARTY_API', classificationConfidence: 90,
    method: 'POST', normalizedPath: '/comments', discoveryConfidenceScore: 90, discoveryConfidenceLevel: 'HIGH', lifecycleState: 'DISCOVERED',
    observationCount: 4, sessionCount: 2, environmentCount: 1, successRatePct: 100, latencyAvgMs: 100, firstSeenAt: null, lastSeenAt: null,
  },
  schemas: [{
    trackId: 'cst_req', direction: 'REQUEST', statusCode: null, currentVersionId: 'csv_req', currentSchemaHash: 'sch_req', contentTypes: ['application/json'],
    schema: { type: 'object', properties: { comment: { type: 'string' }, customerId: { type: 'string' }, newPassword: { type: 'string' } } },
    versions: [{ versionId: 'csv_req', schemaHash: 'sch_req', observationCount: 4, introducedAt: null }],
  }, {
    trackId: 'cst_res', direction: 'RESPONSE', statusCode: 200, currentVersionId: 'csv_res', currentSchemaHash: 'sch_res', contentTypes: ['application/json'],
    schema: { type: 'object', properties: { ok: { type: 'boolean' } } }, versions: [{ versionId: 'csv_res', schemaHash: 'sch_res', observationCount: 4, introducedAt: null }],
  }],
  evidence: [],
  environments: [{ environmentId: 'env_stg', name: 'STG', observationCount: 4, successRatePct: 100, lastSeenAt: null }],
  testData: { configuredBindings: [
    { bindingId: 'tdb_fixed', scopeType: 'ENDPOINT', environmentId: 'env_stg', target: 'BODY', selector: '$.customerId', sourceType: 'FIXED', valueType: 'STRING', generatorKind: null, generatorConfig: {}, secretConfigured: false },
    { bindingId: 'tdb_secret', scopeType: 'ENDPOINT', environmentId: 'env_stg', target: 'BODY', selector: '$.newPassword', sourceType: 'SECRET', valueType: 'STRING', generatorKind: null, generatorConfig: {}, secretConfigured: true },
  ] },
  runtime: { apiServiceKey: 'svc_comments', resolutionSource: 'EXPLICIT_CONFIG', resolutionConfidence: 'CONFIRMED', requiresExecutionConfirmation: false, discoveredOrigin: null, defaultAuthProfileRef: null, availableAuthProfileRefs: [], authObservation: { status: 'NONE', scheme: null, evidenceRefs: [] } },
};

function baseScenario(id, body) {
  return {
    scenarioId: id, title: id, objective: 'test', category: 'HAPPY_PATH', priority: 'HIGH', confidence: 'MEDIUM',
    grounding: { level: 'INFERRED', rationale: ['request schema observed'], evidenceRefs: [], schemaRefs: ['cst_req'] },
    preconditions: [], authRequirement: 'NONE', request: { pathParams: {}, query: {}, headers: {}, body },
    assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }], extract: [],
    automationHints: { needsData: true, reviewRequired: false, reasons: ['O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.'] },
  };
}

const modelOutput = { title: 'Comments', objective: 'Validate comments', assumptions: [], scenarios: [
  baseScenario('test_001', { comment: 'AI literal sample' }),
  baseScenario('test_002', { customerId: 'invented-id' }),
  baseScenario('test_003', {}),
] };
const secretSafeDiagnostics = { sanitizedPaths: ['modelOutput.scenarios[2].request.body.newPassword'] };
const planned = applyTestDataPlannerV1(modelOutput, context, { secretSafeDiagnostics });
assert.equal(planned.diagnostics.generatedCount, 1);
assert.equal(planned.diagnostics.fixedCount, 1);
assert.equal(planned.diagnostics.secretCount, 1);
assert.equal(planned.diagnostics.unresolvedCount, 0);
assert.equal(planned.output.scenarios[0].automationHints.needsData, false);
assert.deepEqual(planned.output.scenarios[0].request.body, {});
assert.deepEqual(planned.output.scenarios[1].request.body, {});
assert.deepEqual(planned.output.scenarios[2].request.body, {});
assert.equal(planned.plansByScenarioId.test_001.bindings[0].source, 'GENERATED');
assert.equal(planned.plansByScenarioId.test_001.bindings[0].generator.kind, 'TEXT_SENTENCE');
assert.equal(planned.plansByScenarioId.test_002.bindings[0].source, 'FIXED');
assert.equal(planned.plansByScenarioId.test_003.bindings[0].source, 'SECRET');

const specification = buildTestSpecificationV1({
  context, modelOutput: planned.output,
  generation: { provider: 'openai', model: 'test', generatedAt: new Date().toISOString(), contextFingerprint: 'a'.repeat(64) },
  testDataPlans: planned.plansByScenarioId,
});
validateTestSpecificationV1(specification, context);
assert.equal(specification.summary.readyCount, 3);
const serialized = JSON.stringify(specification);
assert.equal(serialized.includes('AI literal sample'), false);
assert.equal(serialized.includes('invented-id'), false);
assert.equal(serialized.includes('secret-value'), false);
assert.equal(specification.scenarios[0].spec.testData.contractVersion, 'qagent.test-data-bindings.v1');

const unresolvedContext = structuredClone(context);
unresolvedContext.testData.configuredBindings = [];
const unresolved = applyTestDataPlannerV1({ ...modelOutput, scenarios: [baseScenario('test_004', { customerId: 'fake' })] }, unresolvedContext);
assert.equal(unresolved.diagnostics.unresolvedCount, 1);
assert.equal(unresolved.output.scenarios[0].automationHints.needsData, true);
assert.match(unresolved.output.scenarios[0].automationHints.reasons.join(' '), /configure FIXED/);

const listRoute = resolveGatewayRoute('GET', '/v1/console/projects/prj_test/catalog/endpoints/cep_comment/test-data');
assert.equal(listRoute?.name, 'consoleEndpointTestDataBindingsList');
const createRoute = resolveGatewayRoute('POST', '/v1/console/projects/prj_test/catalog/endpoints/cep_comment/test-data');
assert.equal(createRoute?.name, 'consoleEndpointTestDataBindingsCreate');
const deleteRoute = resolveGatewayRoute('DELETE', '/v1/console/projects/prj_test/catalog/endpoints/cep_comment/test-data/tdb_1');
assert.equal(deleteRoute?.name, 'consoleEndpointTestDataBindingDelete');

// Sensitive selectors are deterministic and exact-token based: $.tokens is legitimate domain data.
assert.equal(isSensitiveTestDataSelector('BODY', '$.password'), true);
assert.equal(isSensitiveTestDataSelector('BODY', '$.clientSecret'), true);
assert.equal(isSensitiveTestDataSelector('QUERY', 'access_token'), true);
assert.equal(isSensitiveTestDataSelector('BODY', '$.tokens'), false);

assert.deepEqual(
  sanitizeTestDataGeneratorConfig('JSON_SCHEMA', { schema: {
    type: 'object', required: ['status', 'password'],
    properties: {
      status: { type: 'string', enum: ['ACTIVE'], default: 'SHOULD_NOT_PERSIST', example: 'SHOULD_NOT_PERSIST' },
      password: { type: 'string', enum: ['real-secret'], default: 'real-secret', example: 'real-secret' },
    },
    example: { password: 'real-secret' },
  } }, { valueType: 'JSON', selectorPath: '$.payload' }),
  { schema: {
    type: 'object', required: ['status', 'password'],
    properties: { status: { type: 'string', enum: ['ACTIVE'] }, password: { type: 'string' } },
  } },
);
assert.deepEqual(sanitizeTestDataGeneratorConfig('EMAIL', { arbitrary: 'must-not-survive' }, { valueType: 'STRING', selectorPath: '$.email' }), {});


// Missing pathParams are still discovered from the canonical path template.
const pathContext = structuredClone(context);
pathContext.endpoint.method = 'GET';
pathContext.endpoint.normalizedPath = '/customers/{customerId}';
pathContext.schemas = pathContext.schemas.filter((track) => track.direction === 'RESPONSE');
pathContext.testData.configuredBindings = [{
  bindingId: 'tdb_project_customer', scopeType: 'PROJECT', environmentId: null,
  target: 'PATH_PARAM', selector: 'customerId', sourceType: 'FIXED', valueType: 'STRING', generatorKind: null, generatorConfig: {}, secretConfigured: false,
}];
const pathScenario = baseScenario('test_path', {});
pathScenario.request.body = null;
pathScenario.request.pathParams = {};
pathScenario.automationHints.reasons = ['Valores de path params precisam ser fornecidos por massa de teste/runtime.'];
const plannedPath = applyTestDataPlannerV1({ title: 'Path', objective: 'Path', assumptions: [], scenarios: [pathScenario] }, pathContext, {
  semanticDiagnostics: { issues: [{ scenarioId: 'test_path', code: 'SEMANTIC_PATH_PARAM_NEEDS_DATA', action: 'NEEDS_DATA' }] },
});
assert.equal(plannedPath.plansByScenarioId.test_path.bindings[0].target, 'PATH_PARAM');
assert.equal(plannedPath.plansByScenarioId.test_path.bindings[0].source, 'FIXED');
assert.equal(plannedPath.output.scenarios[0].automationHints.needsData, false);

// AUTO is resolved deterministically from the schema/value type, never as arbitrary text.
const autoContext = structuredClone(context);
autoContext.schemas[0].schema.properties.age = { type: 'integer', minimum: 1 };
autoContext.testData.configuredBindings.push({
  bindingId: 'tdb_age', scopeType: 'ENDPOINT', environmentId: 'env_stg', target: 'BODY', selector: '$.age',
  sourceType: 'GENERATED', valueType: 'INTEGER', generatorKind: 'AUTO', generatorConfig: {}, secretConfigured: false,
});
const autoPlanned = applyTestDataPlannerV1({ title: 'Auto', objective: 'Auto', assumptions: [], scenarios: [baseScenario('test_auto', { age: 123 })] }, autoContext);
assert.equal(autoPlanned.plansByScenarioId.test_auto.bindings[0].generator.kind, 'INTEGER');

// Planner must not clear NEEDS_DATA owned by another semantic blocker.
const preserve = applyTestDataPlannerV1({ title: 'Preserve', objective: 'Preserve', assumptions: [], scenarios: [baseScenario('test_preserve', { comment: 'x' })] }, context, {
  semanticDiagnostics: { issues: [{ scenarioId: 'test_preserve', code: 'SEMANTIC_EXACT_VALUE_UNGROUNDED', action: 'NEEDS_DATA' }] },
});
assert.equal(preserve.output.scenarios[0].automationHints.needsData, true);

// A misconfigured sensitive binding can never override SECRET authority.
const unsafeContext = structuredClone(context);
unsafeContext.testData.configuredBindings = [{
  bindingId: 'tdb_unsafe', scopeType: 'ENDPOINT', environmentId: 'env_stg', target: 'BODY', selector: '$.password',
  sourceType: 'FIXED', valueType: 'STRING', generatorKind: null, generatorConfig: {}, secretConfigured: false,
}];
const unsafe = applyTestDataPlannerV1({ title: 'Unsafe', objective: 'Unsafe', assumptions: [], scenarios: [baseScenario('test_unsafe', { password: 'fake' })] }, unsafeContext);
assert.equal(unsafe.diagnostics.unresolvedCount, 1);
assert.match(unsafe.output.scenarios[0].automationHints.reasons.join(' '), /configure SECRET/);

const migration = fs.readFileSync(new URL('../migrations/0013_foundation_07_7_8_c_test_data_runtime.sql', import.meta.url), 'utf8');
for (const needle of [
  'CREATE TABLE IF NOT EXISTS test_data_bindings',
  "scope_type IN ('PROJECT', 'ENVIRONMENT', 'ENDPOINT')",
  'idx_test_data_binding_project_active',
  'idx_test_data_binding_environment_active',
  'idx_test_data_binding_endpoint_active',
  'test_data_runtime_status',
  'test_data_generated_count',
  "source_type IN ('GENERATED', 'FIXED', 'SECRET')",
]) assert.ok(migration.includes(needle));
const secretVault = fs.readFileSync(new URL('../src/services/secretVaultService.js', import.meta.url), 'utf8');
assert.ok(secretVault.includes('countActiveTestDataSecretBindings'));
const bindingService = fs.readFileSync(new URL('../src/services/testDataBindingService.js', import.meta.url), 'utf8');
assert.ok(bindingService.includes('assertTestDataSourceSecurity'));
assert.ok(bindingService.includes('scopeType'));

console.log('Foundation 07.7.8-C Test Data Runtime gateway tests passed ✅');

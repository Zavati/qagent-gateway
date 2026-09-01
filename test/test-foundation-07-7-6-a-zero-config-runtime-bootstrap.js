import assert from 'node:assert/strict';
import { buildCatalogTestDesignContextV1 } from '../src/intelligence/catalogContextBuilder.js';
import { buildTestSpecificationV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';
import { discoveredRuntimeServiceKey } from '../src/intelligence/discoveredRuntime.js';
import { normalizeRunCreateInput, fingerprintRunCreateInput } from '../src/lib/runContracts.js';

const organizationId = 'org_0776a';
const projectId = 'prj_0776a';
const endpointId = 'cep_buggy_models';
const environmentId = 'env_buggy_qa';
const origin = 'https://k51qryqov3.execute-api.ap-southeast-2.amazonaws.com';
const discoveredKey = discoveredRuntimeServiceKey(origin);

const endpointDetail = {
  endpointId,
  serviceId: 'csvc_buggy',
  serviceName: 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com',
  classification: 'FIRST_PARTY_API',
  classificationConfidence: 99,
  method: 'GET',
  normalizedPath: '/prod/models',
  discoveryConfidenceScore: 98,
  discoveryConfidenceLevel: 'HIGH',
  lifecycleState: 'DISCOVERED',
  observationCount: 4,
  sessionCount: 1,
  environmentCount: 1,
  successRatePct: 100,
  firstSeenAt: '2026-08-21T22:00:00.000Z',
  lastSeenAt: '2026-08-21T22:10:00.000Z',
  environments: [{ environmentId, observationCount: 4, successRatePct: 100, lastSeenAt: '2026-08-21T22:10:00.000Z' }],
  bindings: [{ environmentId, scheme: 'https', host: 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com', port: null }],
};

const evidence = [{
  evidenceId: 'cev_buggy_models_200',
  environmentId,
  observationSessionId: 'obs_buggy',
  scheme: 'https',
  host: 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com',
  observedAt: '2026-08-21T22:10:00.000Z',
  statusCode: 200,
  evidenceOutcomeClass: 'HTTP_2XX',
  responseSchemaVersionId: 'csv_buggy_models_200_v1',
  authObserved: false,
  authScheme: null,
}];

const schemas = {
  endpointId,
  tracks: [{
    schemaTrackId: 'cst_buggy_models_200',
    direction: 'RESPONSE',
    statusCode: 200,
    currentSchemaVersionId: 'csv_buggy_models_200_v1',
    currentSchemaHash: 'hash_buggy_models_200_v1',
    versions: [{
      schemaVersionId: 'csv_buggy_models_200_v1',
      schemaHash: 'hash_buggy_models_200_v1',
      observationCount: 4,
      firstSeenAt: '2026-08-21T22:00:00.000Z',
      schema: { type: 'array', items: { type: 'object' } },
      contentTypes: [{ contentType: 'application/json' }],
    }],
  }],
};

const controlPlane = {
  environments: [{ environmentId, name: 'QA', status: 'active' }],
  apiServices: [],
  apiBindings: [],
  authProfiles: [],
  authBindings: [],
};

const built = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader: async () => ({ endpointDetail, schemas, evidence }),
  controlPlaneLoader: async () => controlPlane,
});

assert.equal(built.diagnostics.builderVersion, 'qagent.catalog-context-builder.v1.9');
assert.equal(built.diagnostics.runtimeMapping.status, 'DISCOVERED');
assert.equal(built.diagnostics.runtimeMapping.resolutionSource, 'DISCOVERED_OBSERVATION');
assert.equal(built.diagnostics.runtimeMapping.resolutionConfidence, 'HIGH');
assert.equal(built.diagnostics.runtimeMapping.requiresExecutionConfirmation, true);
assert.equal(built.diagnostics.runtimeMapping.discoveredOrigin, origin);
assert.equal(built.context.runtime.apiServiceKey, discoveredKey);
assert.equal(built.context.runtime.resolutionSource, 'DISCOVERED_OBSERVATION');
assert.equal(built.context.runtime.discoveredOrigin, origin);
assert.equal(built.context.runtime.authObservation.status, 'NONE');

const modelOutput = {
  title: 'Buggy Cars public models',
  objective: 'Validar o endpoint público observado.',
  assumptions: [],
  scenarios: [{
    scenarioId: 'happy_path_001',
    title: 'Retorno bem-sucedido de modelos',
    objective: 'Verificar status 200 e schema observado.',
    category: 'HAPPY_PATH',
    priority: 'HIGH',
    confidence: 'HIGH',
    grounding: {
      level: 'OBSERVED',
      rationale: ['O endpoint foi observado retornando status 200.'],
      evidenceRefs: ['cev_buggy_models_200'],
      schemaRefs: ['cst_buggy_models_200'],
    },
    preconditions: [],
    authRequirement: 'NONE',
    request: { pathParams: {}, query: {}, headers: {}, body: null },
    assertions: [
      { type: 'STATUS', expectedStatusCodes: [200] },
      { type: 'SCHEMA', schemaRef: 'cst_buggy_models_200' },
      { type: 'CONTENT_TYPE', expected: ['application/json'] },
    ],
    extract: [],
    automationHints: { needsData: false, reviewRequired: false, reasons: [] },
  }],
};

const specification = buildTestSpecificationV1({
  context: built.context,
  modelOutput,
  generation: {
    provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-21T22:15:00.000Z', contextFingerprint: built.contextFingerprint,
  },
});
assert.equal(specification.summary.readyCount, 1);
assert.equal(specification.scenarios[0].automation.readiness, 'READY');
assert.equal(specification.scenarios[0].spec.target.apiServiceKey, discoveredKey);
assert.equal(specification.scenarios[0].spec.auth.requirement, 'NONE');
assert.doesNotThrow(() => validateTestSpecificationV1(specification, built.context));

const artifact = {
  organizationId,
  projectId,
  endpointId,
  testDesignId: 'td_buggy',
  testDesignVersionId: 'tdv_buggy_v1',
  version: 1,
  specificationVersion: 'qagent.test-spec.v1',
  contextFingerprint: built.contextFingerprint,
  specification,
};
const runtimeConfig = {
  organizationId,
  projectId,
  environment: { environmentId, name: 'QA', slug: 'qa', environmentType: 'QA', webBaseUrl: 'https://buggy.justtestit.org', isDefault: true },
  apiServices: {},
  variables: {},
  authProfiles: {},
};
const catalogEndpointLoader = async () => endpointDetail;
const catalogEvidenceLoader = async () => evidence;
const schemaLoader = async () => schemas;

await assert.rejects(
  () => materializeExecutionPlanV1({
    organizationId, projectId, artifact, environmentId, runId: 'run_buggy_1', executionPlanId: 'xplan_buggy_1', runtimeSnapshotId: 'rts_buggy_1', createdAt: '2026-08-21T22:20:00.000Z',
    resolveRuntime: async () => runtimeConfig,
    loadEndpoint: catalogEndpointLoader,
    loadEvidence: catalogEvidenceLoader,
    loadSchemas: schemaLoader,
  }),
  (error) => error?.code === 'RUN_DISCOVERED_RUNTIME_CONFIRMATION_REQUIRED' && error?.publicDetails?.baseUrl === origin,
);

const materialized = await materializeExecutionPlanV1({
  organizationId, projectId, artifact, environmentId, confirmDiscoveredRuntime: true,
  runId: 'run_buggy_2', executionPlanId: 'xplan_buggy_2', runtimeSnapshotId: 'rts_buggy_2', createdAt: '2026-08-21T22:21:00.000Z',
  resolveRuntime: async () => runtimeConfig,
  loadEndpoint: catalogEndpointLoader,
  loadEvidence: catalogEvidenceLoader,
  loadSchemas: schemaLoader,
});
assert.equal(materialized.runtimeSnapshot.resolution.source, 'DISCOVERED_OBSERVATION');
assert.equal(materialized.runtimeSnapshot.resolution.confidence, 'HIGH');
assert.equal(materialized.runtimeSnapshot.resolution.requiresExecutionConfirmation, false);
assert.equal(materialized.runtimeSnapshot.apiServices[discoveredKey].baseUrl, origin);
assert.equal(materialized.executionPlan.scenarios[0].spec.target.apiServiceKey, discoveredKey);

await assert.rejects(
  () => materializeExecutionPlanV1({
    organizationId, projectId, artifact, environmentId: 'env_other', confirmDiscoveredRuntime: true,
    runId: 'run_buggy_3', executionPlanId: 'xplan_buggy_3', runtimeSnapshotId: 'rts_buggy_3', createdAt: '2026-08-21T22:22:00.000Z',
    resolveRuntime: async () => ({ ...runtimeConfig, environment: { ...runtimeConfig.environment, environmentId: 'env_other' } }),
    loadEndpoint: catalogEndpointLoader,
    loadEvidence: catalogEvidenceLoader,
    loadSchemas: schemaLoader,
  }),
  (error) => error?.code === 'RUN_DISCOVERED_RUNTIME_ENVIRONMENT_MISMATCH',
);

const normalized = normalizeRunCreateInput({
  contractVersion: 'qagent.run-create.v1', testDesignVersionId: 'tdv_buggy_v1', environmentId, scenarioIds: ['happy_path_001'], confirmDiscoveredRuntime: true,
});
assert.equal(normalized.confirmDiscoveredRuntime, true);
const fpConfirmed = await fingerprintRunCreateInput(normalized);
const fpUnconfirmed = await fingerprintRunCreateInput({ ...normalized, confirmDiscoveredRuntime: false });
assert.notEqual(fpConfirmed, fpUnconfirmed);

// Explicit config always wins over discovered observation.
const explicitControlPlane = {
  ...controlPlane,
  apiServices: [{ apiServiceId: 'svc_buggy', serviceKey: 'buggy-cars-api', name: 'Buggy Cars API', status: 'active' }],
  apiBindings: [{ apiServiceId: 'svc_buggy', environmentId, baseUrl: origin, status: 'active' }],
};
const explicit = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader: async () => ({ endpointDetail, schemas, evidence }),
  controlPlaneLoader: async () => explicitControlPlane,
});
assert.equal(explicit.context.runtime.apiServiceKey, 'buggy-cars-api');
assert.equal(explicit.context.runtime.resolutionSource, 'EXPLICIT_CONFIG');
assert.equal(explicit.context.runtime.requiresExecutionConfirmation, false);

// Multiple observed origins remain fail-closed.
const ambiguousEndpoint = structuredClone(endpointDetail);
ambiguousEndpoint.bindings.push({ environmentId, scheme: 'https', host: 'another.example.com', port: null });
const ambiguous = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader: async () => ({ endpointDetail: ambiguousEndpoint, schemas, evidence: [] }),
  controlPlaneLoader: async () => controlPlane,
});
assert.equal(ambiguous.context.runtime.apiServiceKey, null);
assert.equal(ambiguous.diagnostics.runtimeMapping.status, 'AMBIGUOUS');

// Private/local origins are never promoted to executable discovered runtime.
const unsafeEndpoint = structuredClone(endpointDetail);
unsafeEndpoint.bindings = [{ environmentId, scheme: 'https', host: '127.0.0.1', port: 8443 }];
const unsafe = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader: async () => ({ endpointDetail: unsafeEndpoint, schemas, evidence: [] }),
  controlPlaneLoader: async () => controlPlane,
});
assert.equal(unsafe.context.runtime.apiServiceKey, null);
assert.equal(unsafe.diagnostics.runtimeMapping.status, 'UNMATCHED');

const mixedSafetyEndpoint = structuredClone(endpointDetail);
mixedSafetyEndpoint.bindings.push({ environmentId, scheme: 'https', host: '127.0.0.1', port: 8443 });
const mixedSafety = await buildCatalogTestDesignContextV1({
  organizationId, projectId, endpointId,
  catalogLoader: async () => ({ endpointDetail: mixedSafetyEndpoint, schemas, evidence: [] }),
  controlPlaneLoader: async () => controlPlane,
});
assert.equal(mixedSafety.context.runtime.apiServiceKey, null);
assert.equal(mixedSafety.diagnostics.runtimeMapping.status, 'AMBIGUOUS');

console.log('Foundation 07.7.6-A Zero-Config Runtime Bootstrap tests passed ✅');

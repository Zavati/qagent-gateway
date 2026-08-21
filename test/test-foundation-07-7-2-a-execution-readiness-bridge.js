import assert from 'node:assert/strict';
import { buildCatalogTestDesignContextV1 } from '../src/intelligence/catalogContextBuilder.js';
import { applySemanticGroundingGuardV1 } from '../src/intelligence/semanticGroundingGuard.js';
import {
  buildTestSpecificationV1,
  validateTestSpecificationV1,
} from '../src/intelligence/testDesignContract.js';

const organizationId = 'org_0772a';
const projectId = 'prj_0772a';
const endpointId = 'cep_myself';

const endpointDetail = {
  endpointId,
  serviceId: 'csvc_sestsenat',
  serviceName: 'api-sestsenat.studionmx.com',
  classification: 'FIRST_PARTY_API',
  classificationConfidence: 99,
  method: 'GET',
  normalizedPath: '/api/myself',
  discoveryConfidenceScore: 96,
  discoveryConfidenceLevel: 'HIGH',
  lifecycleState: 'DISCOVERED',
  observationCount: 16,
  sessionCount: 2,
  environmentCount: 1,
  successRatePct: 100,
  latencyAvgMs: 120,
  firstSeenAt: '2026-08-21T12:00:00.000Z',
  lastSeenAt: '2026-08-21T13:00:00.000Z',
  environments: [
    { environmentId: 'env_observed_plugin', observationCount: 16, successRatePct: 100, lastSeenAt: '2026-08-21T13:00:00.000Z' },
  ],
  bindings: [
    {
      environmentId: 'env_observed_plugin',
      scheme: 'https',
      host: 'api-sestsenat.studionmx.com',
      hostname: 'api-sestsenat.studionmx.com',
      port: null,
    },
  ],
};

const schemas = {
  endpointId,
  tracks: [
    {
      schemaTrackId: 'cst_myself_200',
      direction: 'RESPONSE',
      statusCode: 200,
      currentSchemaVersionId: 'csv_myself_200_v1',
      currentSchemaHash: 'hash_myself_200_v1',
      versions: [
        {
          schemaVersionId: 'csv_myself_200_v1',
          schemaHash: 'hash_myself_200_v1',
          observationCount: 16,
          firstSeenAt: '2026-08-21T12:00:00.000Z',
          schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          contentTypes: [{ contentType: 'application/json' }],
        },
      ],
    },
  ],
};

const evidence = [
  {
    evidenceId: 'cev_myself_200',
    environmentId: 'env_observed_plugin',
    observationSessionId: 'obs_myself',
    host: 'api-sestsenat.studionmx.com',
    observedAt: '2026-08-21T13:00:00.000Z',
    statusCode: 200,
    evidenceOutcomeClass: 'HTTP_2XX',
    latencyMs: 120,
    requestSchemaVersionId: null,
    responseSchemaVersionId: 'csv_myself_200_v1',
  },
];

const controlPlane = {
  environments: [
    { environmentId: 'env_stg', name: 'Homologação', status: 'active' },
    { environmentId: 'env_prod', name: 'PROD', status: 'active' },
  ],
  apiServices: [
    { apiServiceId: 'svc_sestsenat', serviceKey: 'sestsenat-api', name: 'SEST SENAT API', status: 'active' },
  ],
  apiBindings: [
    {
      apiServiceId: 'svc_sestsenat',
      environmentId: 'env_stg',
      baseUrl: 'https://api-sestsenat.studionmx.com',
      status: 'active',
    },
  ],
  authProfiles: [
    { authProfileId: 'authp_sestsenat', type: 'api_key', enabled: true, status: 'active' },
  ],
  authBindings: [
    {
      authProfileId: 'authp_sestsenat',
      environmentId: 'env_stg',
      status: 'active',
      authProfileEnabled: true,
      credentialsConfigured: true,
    },
  ],
};

const contextResult = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader: async () => ({ endpointDetail, schemas, evidence }),
  controlPlaneLoader: async () => controlPlane,
});

assert.equal(contextResult.context.runtime.apiServiceKey, 'sestsenat-api');
assert.equal(contextResult.diagnostics.runtimeMapping.status, 'MATCHED');
assert.equal(contextResult.diagnostics.runtimeMapping.resolutionSource, 'ORIGIN');
assert.equal(contextResult.diagnostics.runtimeMapping.environmentCoverageStatus, 'NONE');
assert.equal(contextResult.context.runtime.defaultAuthProfileRef, 'authp_sestsenat');
assert.deepEqual(contextResult.context.runtime.availableAuthProfileRefs, ['authp_sestsenat']);
assert.equal(contextResult.diagnostics.auth.defaultSelected, true);

const modelOutput = {
  title: 'Testes executáveis para /api/myself',
  objective: 'Validar o comportamento 200 observado no endpoint autenticado.',
  assumptions: [],
  scenarios: [
    {
      scenarioId: 'test_001',
      title: 'Consultar usuário atual com sucesso',
      objective: 'Validar o status 200 e o schema observado da resposta.',
      category: 'HAPPY_PATH',
      priority: 'HIGH',
      confidence: 'HIGH',
      grounding: {
        level: 'OBSERVED',
        rationale: ['Status 200 e schema de resposta foram observados no Catalog.'],
        evidenceRefs: ['cev_myself_200'],
        schemaRefs: ['csv_myself_200_v1'],
      },
      preconditions: [],
      authRequirement: 'REQUIRED',
      request: { pathParams: {}, query: {}, headers: {}, body: null },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'SCHEMA', schemaRef: 'csv_myself_200_v1' },
        { type: 'CONTENT_TYPE', expected: ['application/json'] },
      ],
      extract: [],
      automationHints: { needsData: false, reviewRequired: false, reasons: [] },
    },
  ],
};

const guarded = applySemanticGroundingGuardV1(modelOutput, contextResult.context);
const specification = buildTestSpecificationV1({
  context: contextResult.context,
  modelOutput: guarded.output,
  generation: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    generatedAt: '2026-08-21T14:00:00.000Z',
    contextFingerprint: contextResult.contextFingerprint,
  },
});

assert.equal(specification.summary.readyCount, 1);
assert.equal(specification.scenarios[0].automation.readiness, 'READY');
assert.deepEqual(specification.scenarios[0].automation.blockers, []);
assert.equal(specification.scenarios[0].spec.target.apiServiceKey, 'sestsenat-api');
assert.equal(specification.scenarios[0].spec.auth.requirement, 'REQUIRED');
assert.equal(specification.scenarios[0].spec.auth.authProfileRef, 'authp_sestsenat');
assert.equal(specification.scenarios[0].grounding.level, 'INFERRED', 'Auth Profile may downgrade auth grounding to INFERRED without blocking execution');
assert.doesNotThrow(() => validateTestSpecificationV1(specification, contextResult.context));

// Safety regression: ambiguity still blocks service identity and therefore READY.
const ambiguousControlPlane = structuredClone(controlPlane);
ambiguousControlPlane.apiServices.push({ apiServiceId: 'svc_other', serviceKey: 'other-api', name: 'Other', status: 'active' });
ambiguousControlPlane.apiBindings.push({
  apiServiceId: 'svc_other', environmentId: 'env_stg', baseUrl: 'https://api-sestsenat.studionmx.com', status: 'active',
});
const ambiguousContext = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader: async () => ({ endpointDetail, schemas, evidence }),
  controlPlaneLoader: async () => ambiguousControlPlane,
});
assert.equal(ambiguousContext.context.runtime.apiServiceKey, null);
assert.equal(ambiguousContext.diagnostics.runtimeMapping.status, 'AMBIGUOUS');

const ambiguousSpec = buildTestSpecificationV1({
  context: ambiguousContext.context,
  modelOutput: guarded.output,
  generation: {
    provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-21T14:00:00.000Z', contextFingerprint: ambiguousContext.contextFingerprint,
  },
});
assert.equal(ambiguousSpec.scenarios[0].automation.readiness, 'NEEDS_ENVIRONMENT');

console.log('Foundation 07.7.2-A Execution Readiness Bridge tests passed ✅');

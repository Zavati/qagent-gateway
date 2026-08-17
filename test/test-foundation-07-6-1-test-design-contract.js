import assert from 'node:assert';
import {
  API_TEST_DSL_VERSION,
  TEST_DESIGN_CONTRACT_VERSION,
  TEST_SPECIFICATION_VERSION,
  TestDesignContractError,
  buildTestSpecificationV1,
  validateCatalogTestDesignContextV1,
  validateTestDesignModelOutputV1,
  validateTestSpecificationV1,
} from '../src/intelligence/testDesignContract.js';

function context(overrides = {}) {
  return {
    contractVersion: TEST_DESIGN_CONTRACT_VERSION,
    organizationId: 'org_123',
    projectId: 'prj_123',
    endpoint: {
      endpointId: 'ep_123',
      serviceId: 'svc_123',
      serviceName: 'Checkout API',
      classification: 'FIRST_PARTY_API',
      classificationConfidence: 98,
      method: 'POST',
      normalizedPath: '/orders/{id}',
      discoveryConfidenceScore: 92,
      discoveryConfidenceLevel: 'HIGH',
      lifecycleState: 'DISCOVERED',
      observationCount: 50,
      sessionCount: 6,
      environmentCount: 2,
      successRatePct: 96,
      latencyAvgMs: 120,
      firstSeenAt: '2026-08-16T10:00:00.000Z',
      lastSeenAt: '2026-08-17T10:00:00.000Z',
    },
    schemas: [
      {
        trackId: 'track_req',
        direction: 'REQUEST',
        statusCode: null,
        currentVersionId: 'sch_req_v2',
        currentSchemaHash: 'hash_req_v2',
        contentTypes: ['application/json'],
        schema: { type: 'object', properties: { quantity: { type: 'integer' } } },
        versions: [
          { versionId: 'sch_req_v2', schemaHash: 'hash_req_v2', observationCount: 40, introducedAt: '2026-08-16T10:00:00.000Z' },
        ],
      },
      {
        trackId: 'track_res_200',
        direction: 'RESPONSE',
        statusCode: 200,
        currentVersionId: 'sch_res_200_v1',
        currentSchemaHash: 'hash_res_200_v1',
        contentTypes: ['application/json'],
        schema: { type: 'object', properties: { id: { type: 'string' } } },
        versions: [
          { versionId: 'sch_res_200_v1', schemaHash: 'hash_res_200_v1', observationCount: 45, introducedAt: '2026-08-16T10:00:00.000Z' },
        ],
      },
    ],
    evidence: [
      {
        evidenceId: 'ev_1',
        observedAt: '2026-08-17T09:00:00.000Z',
        environmentId: 'env_stg',
        outcome: 'HTTP_2XX',
        statusCode: 200,
        latencyMs: 110,
        sourceHost: 'stg-api.example.test',
        sessionId: 'obs_1',
        requestSchemaVersionId: 'sch_req_v2',
        responseSchemaVersionId: 'sch_res_200_v1',
      },
    ],
    environments: [
      { environmentId: 'env_stg', name: 'STG', observationCount: 50, successRatePct: 96, lastSeenAt: '2026-08-17T10:00:00.000Z' },
    ],
    runtime: {
      apiServiceKey: 'checkout',
      defaultAuthProfileRef: 'authp_default',
      availableAuthProfileRefs: ['authp_default'],
    },
    ...overrides,
  };
}

function modelOutput(overrides = {}) {
  return {
    title: 'POST /orders/{id} — estratégia de testes',
    objective: 'Validar comportamento funcional e contrato observado do endpoint.',
    assumptions: [],
    scenarios: [
      {
        scenarioId: 'scn_happy_001',
        title: 'Retorna pedido com sucesso',
        objective: 'Validar resposta 200 e o schema observado.',
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        confidence: 'HIGH',
        grounding: {
          level: 'OBSERVED',
          rationale: ['Status 200 e schema de resposta foram observados no Catalog.'],
          evidenceRefs: ['ev_1'],
          schemaRefs: ['sch_res_200_v1'],
        },
        preconditions: ['Pedido existente.'],
        authRequirement: 'REQUIRED',
        request: {
          pathParams: { id: 'order-123' },
          query: {},
          headers: { Accept: 'application/json' },
          body: { quantity: 1 },
        },
        assertions: [
          { type: 'STATUS', expectedStatusCodes: [200] },
          { type: 'SCHEMA', schemaRef: 'sch_res_200_v1' },
        ],
        extract: [],
        automationHints: { needsData: false, reviewRequired: false, reasons: [] },
      },
    ],
    ...overrides,
  };
}

function generation() {
  return {
    provider: 'gemini',
    model: 'gemini-test-model',
    generatedAt: '2026-08-17T14:00:00.000Z',
    contextFingerprint: 'ctx_sha256_abc123',
  };
}

function mustThrow(fn, code) {
  assert.throws(fn, (error) => error instanceof TestDesignContractError && error.code === code);
}

validateCatalogTestDesignContextV1(context());
validateTestDesignModelOutputV1(modelOutput(), context());

const spec = buildTestSpecificationV1({ context: context(), modelOutput: modelOutput(), generation: generation() });
assert.strictEqual(spec.contractVersion, TEST_DESIGN_CONTRACT_VERSION);
assert.strictEqual(spec.specificationVersion, TEST_SPECIFICATION_VERSION);
assert.strictEqual(spec.scenarios[0].spec.dslVersion, API_TEST_DSL_VERSION);
assert.strictEqual(spec.scenarios[0].spec.target.catalogEndpointId, 'ep_123');
assert.strictEqual(spec.scenarios[0].spec.target.method, 'POST');
assert.strictEqual(spec.scenarios[0].spec.target.path, '/orders/{id}');
assert.strictEqual(spec.scenarios[0].spec.target.apiServiceKey, 'checkout');
assert.strictEqual(spec.scenarios[0].spec.auth.authProfileRef, 'authp_default');
assert.strictEqual(spec.scenarios[0].automation.readiness, 'READY');
assert.strictEqual(spec.summary.scenarioCount, 1);
assert.strictEqual(spec.summary.readyCount, 1);
validateTestSpecificationV1(spec, context());

const withoutRuntimeService = context({
  runtime: { apiServiceKey: null, defaultAuthProfileRef: 'authp_default', availableAuthProfileRefs: ['authp_default'] },
});
const envBlocked = buildTestSpecificationV1({ context: withoutRuntimeService, modelOutput: modelOutput(), generation: generation() });
assert.strictEqual(envBlocked.scenarios[0].automation.readiness, 'NEEDS_ENVIRONMENT');

const withoutAuth = context({
  runtime: { apiServiceKey: 'checkout', defaultAuthProfileRef: null, availableAuthProfileRefs: [] },
});
const authBlocked = buildTestSpecificationV1({ context: withoutAuth, modelOutput: modelOutput(), generation: generation() });
assert.strictEqual(authBlocked.scenarios[0].automation.readiness, 'NEEDS_AUTH');

const needsDataOutput = modelOutput();
needsDataOutput.scenarios[0].automationHints = { needsData: true, reviewRequired: false, reasons: ['ID válido precisa ser fornecido.'] };
const dataBlocked = buildTestSpecificationV1({ context: context(), modelOutput: needsDataOutput, generation: generation() });
assert.strictEqual(dataBlocked.scenarios[0].automation.readiness, 'NEEDS_DATA');

const assumedOutput = modelOutput();
assumedOutput.scenarios[0].grounding = { level: 'ASSUMED', rationale: ['Hipótese de negócio não observada.'], evidenceRefs: [], schemaRefs: [] };
assumedOutput.scenarios[0].confidence = 'LOW';
const reviewBlocked = buildTestSpecificationV1({ context: context(), modelOutput: assumedOutput, generation: generation() });
assert.strictEqual(reviewBlocked.scenarios[0].automation.readiness, 'REVIEW_REQUIRED');

const inventedEvidence = modelOutput();
inventedEvidence.scenarios[0].grounding.evidenceRefs = ['ev_does_not_exist'];
mustThrow(() => validateTestDesignModelOutputV1(inventedEvidence, context()), 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN');

const unknownSystemField = modelOutput({ organizationId: 'org_attacker' });
mustThrow(() => validateTestDesignModelOutputV1(unknownSystemField, context()), 'TEST_DESIGN_UNKNOWN_FIELD');

const secretHeader = modelOutput();
secretHeader.scenarios[0].request.headers.Authorization = 'Bearer secret';
mustThrow(() => validateTestDesignModelOutputV1(secretHeader, context()), 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');

const assumedHigh = modelOutput();
assumedHigh.scenarios[0].grounding = { level: 'ASSUMED', rationale: ['Hipótese.'], evidenceRefs: [], schemaRefs: [] };
assumedHigh.scenarios[0].confidence = 'HIGH';
mustThrow(() => validateTestDesignModelOutputV1(assumedHigh, context()), 'TEST_DESIGN_CONFIDENCE_INCONSISTENT');

const badContext = context();
badContext.endpoint.normalizedPath = 'https://evil.example/orders';
mustThrow(() => validateCatalogTestDesignContextV1(badContext), 'TEST_DESIGN_ABSOLUTE_URL_FORBIDDEN');

const tamperedSpec = structuredClone(spec);
tamperedSpec.scenarios[0].spec.target.path = 'https://evil.example/orders';
mustThrow(() => validateTestSpecificationV1(tamperedSpec, context()), 'TEST_DESIGN_ABSOLUTE_URL_FORBIDDEN');

const tamperedRuntimeRef = structuredClone(spec);
tamperedRuntimeRef.scenarios[0].spec.target.apiServiceKey = 'invented';
mustThrow(() => validateTestSpecificationV1(tamperedRuntimeRef, context()), 'TEST_DESIGN_RUNTIME_SERVICE_MISMATCH');

const invalidSchemaRef = modelOutput();
invalidSchemaRef.scenarios[0].assertions[1].schemaRef = 'sch_fake';
mustThrow(() => validateTestDesignModelOutputV1(invalidSchemaRef, context()), 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN');

const secretBody = modelOutput();
secretBody.scenarios[0].request.body = { password: 'should-not-be-materialized' };
mustThrow(() => validateTestDesignModelOutputV1(secretBody, context()), 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');

const tamperedSummary = structuredClone(spec);
tamperedSummary.summary.readyCount = 999;
mustThrow(() => validateTestSpecificationV1(tamperedSummary, context()), 'TEST_DESIGN_SUMMARY_MISMATCH');

console.log('Foundation 07.6.1 Test Design Contract v1 tests passed ✅');

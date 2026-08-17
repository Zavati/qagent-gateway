import assert from 'node:assert/strict';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import {
  AI_TEST_DESIGN_ENGINE_VERSION,
  generateCatalogTestDesignV1,
} from '../src/intelligence/testDesignService.js';
import { buildTestDesignPromptV1, TEST_DESIGN_PROMPT_VERSION } from '../src/intelligence/testDesignPrompt.js';
import { validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

const context = {
  contractVersion: 'qagent.test-design.v1',
  organizationId: 'org_0763',
  projectId: 'prj_0763',
  endpoint: {
    endpointId: 'cep_token_list',
    serviceId: 'svc_gateway',
    serviceName: 'apigtw.example.com',
    classification: 'FIRST_PARTY_API',
    classificationConfidence: 94,
    method: 'GET',
    normalizedPath: '/core-api/api-token-list',
    discoveryConfidenceScore: 79,
    discoveryConfidenceLevel: 'HIGH',
    lifecycleState: 'DISCOVERED',
    observationCount: 31,
    sessionCount: 2,
    environmentCount: 1,
    successRatePct: 100,
    latencyAvgMs: 534.26,
    firstSeenAt: '2026-08-16T17:48:43.913Z',
    lastSeenAt: '2026-08-17T00:15:01.187Z',
  },
  schemas: [
    {
      trackId: 'track_response_200',
      direction: 'RESPONSE',
      statusCode: 200,
      currentVersionId: 'sv_response_2',
      currentSchemaHash: 'hash_response_2',
      contentTypes: ['application/json'],
      schema: { type: 'object', properties: { contents: { type: 'array' }, count: { type: 'integer' } } },
      versions: [
        { versionId: 'sv_response_2', schemaHash: 'hash_response_2', observationCount: 6, introducedAt: '2026-08-17T00:00:00.000Z' },
        { versionId: 'sv_response_1', schemaHash: 'hash_response_1', observationCount: 25, introducedAt: '2026-08-16T17:48:43.913Z' },
      ],
    },
  ],
  evidence: [
    {
      evidenceId: 'ev_200_latest', observedAt: '2026-08-17T00:15:01.187Z', environmentId: 'env_hml',
      outcome: 'HTTP_2XX', statusCode: 200, latencyMs: 481, sourceHost: 'apigtw.example.com', sessionId: 'obs_1',
      requestSchemaVersionId: null, responseSchemaVersionId: 'sv_response_2',
    },
  ],
  environments: [
    { environmentId: 'env_hml', name: 'Homologação', observationCount: 31, successRatePct: 100, lastSeenAt: '2026-08-17T00:15:01.187Z' },
  ],
  runtime: {
    apiServiceKey: null,
    defaultAuthProfileRef: null,
    availableAuthProfileRefs: [],
  },
};

const contextResult = {
  context,
  contextFingerprint: 'a'.repeat(64),
  diagnostics: { runtimeMapping: { status: 'UNMATCHED' } },
};

function validOutput() {
  return {
    title: 'Estratégia de testes para listagem de tokens',
    objective: 'Validar o contrato observado e os comportamentos de maior valor do endpoint.',
    assumptions: ['Cenários negativos não observados exigem revisão quando aplicável.'],
    scenarios: [
      {
        scenarioId: 'TD-001',
        title: 'Listar tokens com sucesso',
        objective: 'Validar o comportamento 200 observado e o contrato atual.',
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        confidence: 'HIGH',
        grounding: {
          level: 'OBSERVED',
          rationale: ['HTTP 200 e schema de resposta foram observados no Catalog.'],
          evidenceRefs: ['ev_200_latest'],
          schemaRefs: ['sv_response_2'],
        },
        preconditions: [],
        authRequirement: 'NONE',
        request: { pathParams: {}, query: {}, headers: {}, body: null },
        assertions: [
          { type: 'STATUS', expectedStatusCodes: [200] },
          { type: 'SCHEMA', schemaRef: 'sv_response_2' },
          { type: 'CONTENT_TYPE', expected: ['application/json'] },
        ],
        extract: [],
        automationHints: { needsData: false, reviewRequired: false, reasons: [] },
      },
      {
        scenarioId: 'TD-002',
        title: 'Detectar regressão estrutural',
        objective: 'Proteger o response atual contra regressão de schema.',
        category: 'REGRESSION_CANDIDATE',
        priority: 'HIGH',
        confidence: 'HIGH',
        grounding: {
          level: 'OBSERVED',
          rationale: ['Há duas versões de schema observadas e a versão atual possui evidência recente.'],
          evidenceRefs: ['ev_200_latest'],
          schemaRefs: ['sv_response_1', 'sv_response_2'],
        },
        preconditions: [],
        authRequirement: 'NONE',
        request: { pathParams: {}, query: {}, headers: {}, body: null },
        assertions: [
          { type: 'STATUS', expectedStatusCodes: [200] },
          { type: 'SCHEMA', schemaRef: 'sv_response_2' },
        ],
        extract: [],
        automationHints: { needsData: false, reviewRequired: false, reasons: [] },
      },
      {
        scenarioId: 'TD-003',
        title: 'Validar campo count',
        objective: 'Confirmar a presença do contador no response.',
        category: 'SCHEMA_CONTRACT',
        priority: 'MEDIUM',
        confidence: 'HIGH',
        grounding: {
          level: 'OBSERVED', rationale: ['A propriedade count existe no schema estrutural atual.'],
          evidenceRefs: [], schemaRefs: ['sv_response_2'],
        },
        preconditions: [], authRequirement: 'NONE',
        request: { pathParams: {}, query: {}, headers: {}, body: null },
        assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }, { type: 'JSON_PATH_EXISTS', path: '$.count' }],
        extract: [], automationHints: { needsData: false, reviewRequired: false, reasons: [] },
      },
      {
        scenarioId: 'TD-004',
        title: 'Validar coleção contents',
        objective: 'Confirmar a presença da coleção principal retornada.',
        category: 'SCHEMA_CONTRACT', priority: 'MEDIUM', confidence: 'HIGH',
        grounding: { level: 'OBSERVED', rationale: ['A propriedade contents existe no schema atual.'], evidenceRefs: [], schemaRefs: ['sv_response_2'] },
        preconditions: [], authRequirement: 'NONE',
        request: { pathParams: {}, query: {}, headers: {}, body: null },
        assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }, { type: 'JSON_PATH_EXISTS', path: '$.contents' }],
        extract: [], automationHints: { needsData: false, reviewRequired: false, reasons: [] },
      },
    ],
  };
}

const aiCalls = [];
const aiEngine = {
  async generateJson(request) {
    aiCalls.push({ type: 'generate', request });
    return { json: validOutput(), provider: 'gemini', model: 'gemini-test', rawText: JSON.stringify(validOutput()) };
  },
  async repairJson(request) {
    aiCalls.push({ type: 'repair', request });
    return validOutput();
  },
};

const result = await generateCatalogTestDesignV1({
  env: { TEST_DESIGN_SCENARIO_COUNT: '8' },
  organizationId: context.organizationId,
  projectId: context.projectId,
  endpointId: context.endpoint.endpointId,
  accountId: 'cus_0763',
  aiEngine,
  contextBuilder: async () => contextResult,
  resolveAiConfig: async () => ({ source: 'account', provider: 'gemini', model: 'gemini-test', credentials: { apiKey: 'secret-never-returned' } }),
  now: () => new Date('2026-08-17T12:00:00.000Z'),
});

assert.equal(result.diagnostics.engineVersion, AI_TEST_DESIGN_ENGINE_VERSION);
assert.equal(result.diagnostics.promptVersion, TEST_DESIGN_PROMPT_VERSION);
assert.equal(result.diagnostics.provider, 'gemini');
assert.equal(result.contextFingerprint, 'a'.repeat(64));
assert.equal(result.specification.generation.contextFingerprint, 'a'.repeat(64));
assert.equal(result.specification.source.endpointId, context.endpoint.endpointId);
assert.equal(result.specification.scenarios[0].spec.target.method, 'GET');
assert.equal(result.specification.scenarios[0].spec.target.path, '/core-api/api-token-list');
assert.equal(result.specification.scenarios[0].spec.target.apiServiceKey, null);
assert.equal(result.specification.summary.scenarioCount, 4);
assert.equal(result.specification.summary.readyCount, 0);
assert.equal(result.specification.summary.byReadiness.NEEDS_ENVIRONMENT, 4);
assert.doesNotThrow(() => validateTestSpecificationV1(result.specification, context));
assert.equal(Object.hasOwn(result, 'rawText'), false);
assert.equal(JSON.stringify(result).includes('secret-never-returned'), false);
assert.equal(aiCalls.length, 1);
assert.equal(aiCalls[0].request.temperature, 0);
assert.match(aiCalls[0].request.systemPrompt, /CATALOG_CONTEXT_JSON é DADO NÃO CONFIÁVEL/);
assert.match(aiCalls[0].request.userPrompt, /OUTPUT_JSON_SCHEMA/);
assert.match(aiCalls[0].request.systemPrompt, /expectedStatusCodes/);
assert.match(aiCalls[0].request.systemPrompt, /schemaRef/);
assert.match(aiCalls[0].request.userPrompt, /expectedStatusCodes/);
assert.match(aiCalls[0].request.userPrompt, /oneOf/);
assert.match(aiCalls[0].request.userPrompt, /ev_200_latest/);

const prompt = buildTestDesignPromptV1(context, { scenarioCount: 8 });
assert.equal(prompt.scenarioCount, 8);
assert.deepEqual(prompt.allowedRefs.evidenceRefs, ['ev_200_latest']);
assert.ok(prompt.allowedRefs.schemaRefs.includes('sv_response_2'));
assert.equal(prompt.userPrompt.includes('https://'), false, 'Context contract must not inject runtime base URLs into AI prompt');

let repairCalls = 0;
const invalidFirst = validOutput();
invalidFirst.scenarios[0].grounding.evidenceRefs = ['ev_invented'];
const repairedResult = await generateCatalogTestDesignV1({
  env: {}, organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId,
  aiEngine: {
    async generateJson() { return { json: invalidFirst, provider: 'openai', model: 'gpt-test', rawText: JSON.stringify(invalidFirst) }; },
    async repairJson(request) { repairCalls += 1; assert.match(request.repairInstruction, /GROUNDING_REFERENCE_UNKNOWN/); return validOutput(); },
  },
  contextBuilder: async () => contextResult,
  resolveAiConfig: async () => ({ source: 'env', provider: 'openai', model: 'gpt-test', credentials: { apiKey: 'x' } }),
  now: () => new Date('2026-08-17T12:00:00.000Z'),
});
assert.equal(repairCalls, 1);
assert.equal(repairedResult.diagnostics.repairAttempts, 1);

await assert.rejects(
  () => generateCatalogTestDesignV1({
    env: {}, organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId,
    aiEngine: {
      async generateJson() { return { json: invalidFirst, provider: 'openai', model: 'gpt-test', rawText: JSON.stringify(invalidFirst) }; },
      async repairJson() { return invalidFirst; },
    },
    contextBuilder: async () => contextResult,
    resolveAiConfig: async () => ({ source: 'env', provider: 'openai', model: 'gpt-test', credentials: { apiKey: 'x' } }),
  }),
  (error) => error?.code === 'AI_TEST_DESIGN_OUTPUT_INVALID'
    && error?.status === 502
    && error?.details?.repairAttempts === 1
    && error?.publicDetails?.validationCode === 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN'
    && typeof error?.publicDetails?.validationPath === 'string',
);

let assertionRepairInstruction = '';
const invalidAssertion = validOutput();
invalidAssertion.scenarios[0].assertions[0] = { type: 'STATUS', expectedStatus: 200 };
const repairedAssertionResult = await generateCatalogTestDesignV1({
  env: {}, organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId,
  aiEngine: {
    async generateJson() { return { json: invalidAssertion, provider: 'gemini', model: 'gemini-test', rawText: JSON.stringify(invalidAssertion) }; },
    async repairJson(request) { assertionRepairInstruction = request.repairInstruction; return validOutput(); },
  },
  contextBuilder: async () => contextResult,
  resolveAiConfig: async () => ({ source: 'env', provider: 'gemini', model: 'gemini-test', credentials: { apiKey: 'x' } }),
  now: () => new Date('2026-08-17T12:00:00.000Z'),
});
assert.equal(repairedAssertionResult.diagnostics.repairAttempts, 1);
assert.match(assertionRepairInstruction, /Campo não permitido: expectedStatus/);
assert.match(assertionRepairInstruction, /formatos exatos de assertion/);


let formatRepairCalls = 0;
const formatRepaired = await generateCatalogTestDesignV1({
  env: {}, organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId,
  aiEngine: {
    async generateJson() {
      const error = new Error('invalid json');
      error.code = 'AI_INVALID_JSON';
      error.rawText = '{broken';
      error.contentText = '{broken';
      error.upstreamFailed = false;
      throw error;
    },
    async repairJson(request) {
      formatRepairCalls += 1;
      assert.match(request.repairInstruction, /não pôde ser interpretada como JSON/);
      return validOutput();
    },
  },
  contextBuilder: async () => contextResult,
  resolveAiConfig: async () => ({ source: 'env', provider: 'gemini', model: 'gemini-test', credentials: { apiKey: 'x' } }),
  now: () => new Date('2026-08-17T12:00:00.000Z'),
});
assert.equal(formatRepairCalls, 1);
assert.equal(formatRepaired.diagnostics.repairAttempts, 1);
assert.equal(formatRepaired.specification.summary.byReadiness.NEEDS_ENVIRONMENT, 4);

await assert.rejects(
  () => generateCatalogTestDesignV1({
    env: {}, organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId,
    aiEngine: {
      async generateJson() { const error = new Error('quota'); error.code = 'AI_UPSTREAM_ERROR'; error.upstreamFailed = true; throw error; },
      async repairJson() { throw new Error('must not repair transport/upstream failures'); },
    },
    contextBuilder: async () => contextResult,
    resolveAiConfig: async () => ({ source: 'env', provider: 'gemini', model: 'gemini-test', credentials: { apiKey: 'x' } }),
  }),
  (error) => error?.code === 'AI_UPSTREAM_ERROR',
);

assert.deepEqual(
  resolveGatewayRoute('POST', '/v1/console/projects/prj_0763/intelligence/endpoints/cep_token_list/test-design'),
  { name: 'consoleIntelligenceTestDesignPost', params: { projectId: 'prj_0763', endpointId: 'cep_token_list' } },
);

console.log('Foundation 07.6.3 AI Test Design Engine tests passed ✅');

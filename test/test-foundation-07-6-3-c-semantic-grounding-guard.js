import assert from 'node:assert/strict';
import { applySemanticGroundingGuardV1, SEMANTIC_GROUNDING_GUARD_VERSION } from '../src/intelligence/semanticGroundingGuard.js';
import { buildTestSpecificationV1, validateTestDesignModelOutputV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';
import { generateCatalogTestDesignV1 } from '../src/intelligence/testDesignService.js';
import { buildTestDesignPromptV1, TEST_DESIGN_PROMPT_VERSION } from '../src/intelligence/testDesignPrompt.js';

const context = {
  contractVersion: 'qagent.test-design.v1',
  organizationId: 'org_guard',
  projectId: 'prj_guard',
  endpoint: {
    endpointId: 'cep_guard', serviceId: 'svc_guard', serviceName: 'apigtw.example.com', classification: 'FIRST_PARTY_API',
    classificationConfidence: 94, method: 'GET', normalizedPath: '/core-api/api-token-list', discoveryConfidenceScore: 79,
    discoveryConfidenceLevel: 'HIGH', lifecycleState: 'DISCOVERED', observationCount: 31, sessionCount: 2, environmentCount: 1,
    successRatePct: 100, latencyAvgMs: 534.26, firstSeenAt: '2026-08-16T17:48:43.913Z', lastSeenAt: '2026-08-17T00:15:01.187Z',
  },
  schemas: [{
    trackId: 'track_response_200', direction: 'RESPONSE', statusCode: 200, currentVersionId: 'sv_response_2', currentSchemaHash: 'hash_response_2',
    contentTypes: ['application/json'],
    schema: {
      type: 'object',
      properties: {
        contents: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              isDeleted: { type: 'boolean' },
              userId: { type: 'string', format: 'uuid' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'integer' },
      },
    },
    versions: [
      { versionId: 'sv_response_2', schemaHash: 'hash_response_2', observationCount: 6, introducedAt: '2026-08-17T00:00:00.000Z' },
      { versionId: 'sv_response_1', schemaHash: 'hash_response_1', observationCount: 25, introducedAt: '2026-08-16T17:48:43.913Z' },
    ],
  }],
  evidence: [
    { evidenceId: 'ev_200_a', observedAt: '2026-08-17T00:15:01.187Z', environmentId: 'env_hml', outcome: 'HTTP_2XX', statusCode: 200, latencyMs: 481, sourceHost: 'apigtw.example.com', sessionId: 'obs_1', requestSchemaVersionId: null, responseSchemaVersionId: 'sv_response_2' },
    { evidenceId: 'ev_200_b', observedAt: '2026-08-17T00:14:52.253Z', environmentId: 'env_hml', outcome: 'HTTP_2XX', statusCode: 200, latencyMs: 1040, sourceHost: 'apigtw.example.com', sessionId: 'obs_1', requestSchemaVersionId: null, responseSchemaVersionId: 'sv_response_2' },
  ],
  environments: [{ environmentId: 'env_hml', name: 'Homologação', observationCount: 31, successRatePct: 100, lastSeenAt: '2026-08-17T00:15:01.187Z' }],
  runtime: { apiServiceKey: null, defaultAuthProfileRef: null, availableAuthProfileRefs: [] },
};

function baseScenario(id, overrides = {}) {
  return {
    scenarioId: id,
    title: 'Cenário',
    objective: 'Validar comportamento observado.',
    category: 'HAPPY_PATH',
    priority: 'MEDIUM',
    confidence: 'HIGH',
    grounding: { level: 'OBSERVED', rationale: ['Comportamento observado.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
    preconditions: [],
    authRequirement: 'NONE',
    request: { pathParams: {}, query: {}, headers: {}, body: {} },
    assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }],
    extract: [],
    automationHints: { needsData: false, reviewRequired: false, reasons: [] },
    ...overrides,
  };
}

const modelOutput = {
  title: 'Semantic guard regression pack',
  objective: 'Reproduzir falsos groundings observados no primeiro retorno real da 07.6.3.',
  assumptions: [],
  scenarios: [
    baseScenario('SAFE_001', {
      title: 'Happy path observado',
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'SCHEMA', schemaRef: 'track_response_200' },
        { type: 'CONTENT_TYPE', expected: ['application/json'] },
      ],
    }),
    baseScenario('VALUE_002', {
      title: 'Contagem exata inventada',
      category: 'DATA_VARIATION',
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EQUALS', path: '$.count', expected: 5 },
      ],
    }),
    baseScenario('FILTER_003', {
      title: 'ID específico sem massa de teste',
      category: 'DATA_VARIATION',
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: "$.contents[?(@.id == 'token-uuid-123')]" },
      ],
    }),
    baseScenario('QUERY_004', {
      title: 'Query param inventado',
      category: 'NEGATIVE',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Hipótese negativa.'], evidenceRefs: [], schemaRefs: [] },
      request: { pathParams: {}, query: { id: 'token-inexistente' }, headers: {}, body: {} },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [404] }],
    }),
    baseScenario('BODY_005', {
      title: 'GET com body inventado',
      category: 'NEGATIVE',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Hipótese negativa.'], evidenceRefs: [], schemaRefs: [] },
      request: { pathParams: {}, query: {}, headers: {}, body: { invalidField: 'invalidValue' } },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [400] }],
    }),
    baseScenario('AUTH_006', {
      title: '401 sem intenção de auth consistente',
      category: 'NEGATIVE',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Hipótese de autenticação.'], evidenceRefs: [], schemaRefs: [] },
      authRequirement: 'NONE',
      assertions: [{ type: 'STATUS', expectedStatusCodes: [401] }],
    }),
    baseScenario('LATENCY_007', {
      title: 'Verificar latência do endpoint',
      objective: 'Garantir que a latência esteja dentro do limite aceitável.',
      category: 'STATUS_BEHAVIOR',
      assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }],
    }),
    baseScenario('SCHEMA_008', {
      title: 'Campo count existe',
      category: 'SCHEMA_CONTRACT',
      grounding: { level: 'OBSERVED', rationale: ['Schema estrutural observado.'], evidenceRefs: [], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.count' },
      ],
    }),
  ],
};

assert.doesNotThrow(() => validateTestDesignModelOutputV1(modelOutput, context));
const guarded = applySemanticGroundingGuardV1(modelOutput, context);
assert.equal(guarded.diagnostics.guardVersion, SEMANTIC_GROUNDING_GUARD_VERSION);
assert.equal(guarded.diagnostics.scenarioCount, 8);
assert.ok(guarded.diagnostics.issueCount >= 8);
assert.ok(guarded.diagnostics.issuesByCode.SEMANTIC_EXACT_VALUE_UNGROUNDED >= 1);
assert.ok(guarded.diagnostics.issuesByCode.SEMANTIC_JSON_PATH_VALUE_DEPENDENT >= 1);
assert.ok(guarded.diagnostics.issuesByCode.SEMANTIC_QUERY_PARAM_UNMODELED >= 1);
assert.ok(guarded.diagnostics.issuesByCode.SEMANTIC_BODY_UNSUPPORTED_FOR_METHOD >= 1);
assert.ok(guarded.diagnostics.issuesByCode.SEMANTIC_AUTH_CONTRADICTION >= 1);
assert.ok(guarded.diagnostics.issuesByCode.SEMANTIC_ASSERTION_COVERAGE_GAP >= 1);

const safe = guarded.output.scenarios[0];
assert.equal(safe.grounding.level, 'OBSERVED');
assert.equal(safe.confidence, 'HIGH');
assert.equal(safe.automationHints.needsData, false);
assert.equal(safe.automationHints.reviewRequired, false);

const exact = guarded.output.scenarios[1];
assert.equal(exact.grounding.level, 'ASSUMED');
assert.equal(exact.confidence, 'LOW');
assert.equal(exact.automationHints.needsData, true);
assert.equal(exact.automationHints.reviewRequired, false);
assert.match(exact.automationHints.reasons.join(' '), /valor literal esperado/i);

const filter = guarded.output.scenarios[2];
assert.equal(filter.grounding.level, 'INFERRED');
assert.equal(filter.confidence, 'MEDIUM');
assert.equal(filter.automationHints.needsData, true);

const query = guarded.output.scenarios[3];
assert.equal(query.grounding.level, 'ASSUMED');
assert.equal(query.automationHints.reviewRequired, true);
assert.equal(query.automationHints.needsData, true);

const body = guarded.output.scenarios[4];
assert.equal(body.grounding.level, 'ASSUMED');
assert.equal(body.automationHints.reviewRequired, true);

const auth = guarded.output.scenarios[5];
assert.equal(auth.grounding.level, 'ASSUMED');
assert.equal(auth.automationHints.reviewRequired, true);

const latency = guarded.output.scenarios[6];
assert.equal(latency.grounding.level, 'OBSERVED');
assert.equal(latency.automationHints.reviewRequired, true);

const schema = guarded.output.scenarios[7];
assert.equal(schema.grounding.level, 'OBSERVED');
assert.ok(schema.grounding.evidenceRefs.includes('ev_200_a'), 'Guard should auto-ground observed 200 with real evidence');
assert.ok(schema.grounding.schemaRefs.includes('track_response_200'));
assert.doesNotThrow(() => validateTestDesignModelOutputV1(guarded.output, context));

const specification = buildTestSpecificationV1({
  context,
  modelOutput: guarded.output,
  generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-17T23:03:37.011Z', contextFingerprint: 'b'.repeat(64) },
});
assert.doesNotThrow(() => validateTestSpecificationV1(specification, context));
assert.equal(specification.scenarios[0].automation.readiness, 'NEEDS_ENVIRONMENT');
assert.equal(specification.scenarios[1].automation.readiness, 'NEEDS_DATA');
assert.equal(specification.scenarios[2].automation.readiness, 'NEEDS_DATA');
assert.equal(specification.scenarios[3].automation.readiness, 'REVIEW_REQUIRED');
assert.equal(specification.scenarios[4].automation.readiness, 'REVIEW_REQUIRED');
assert.equal(specification.scenarios[5].automation.readiness, 'REVIEW_REQUIRED');
assert.equal(specification.scenarios[6].automation.readiness, 'REVIEW_REQUIRED');
assert.equal(specification.scenarios[7].automation.readiness, 'NEEDS_ENVIRONMENT');
assert.ok(specification.scenarios[1].automation.blockers.some((reason) => /valor literal/i.test(reason)));
assert.ok(specification.scenarios[0].automation.blockers.some((reason) => /API Service de runtime/i.test(reason)));

// Fix 2: intent can demand a target/failure mechanism that the DSL cannot execute.
const executabilityOutput = {
  title: 'Semantic executability regression pack',
  objective: 'Reproduzir target mutation e fault injection observados na geração real.',
  assumptions: [],
  scenarios: [
    baseScenario('TARGET_PATH_009', {
      title: 'Caminho Inválido para Listagem de Tokens',
      objective: 'Verificar a resposta do endpoint quando um caminho inválido é acessado.',
      category: 'NEGATIVE',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Hipótese negativa.'], evidenceRefs: [], schemaRefs: [] },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [404] }],
    }),
    baseScenario('TARGET_METHOD_010', {
      title: 'Método Inválido ao Listar Tokens',
      objective: 'Verificar a resposta do endpoint quando um método HTTP inválido é utilizado.',
      category: 'NEGATIVE',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Hipótese negativa.'], evidenceRefs: [], schemaRefs: [] },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [405] }],
    }),
    baseScenario('FAULT_011', {
      title: 'Erro Interno do Servidor ao Listar Tokens',
      objective: 'Verificar a resposta do endpoint em caso de erro interno do servidor.',
      category: 'NEGATIVE',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Hipótese de falha.'], evidenceRefs: [], schemaRefs: [] },
      assertions: [{ type: 'STATUS', expectedStatusCodes: [500] }],
    }),
  ],
};
assert.doesNotThrow(() => validateTestDesignModelOutputV1(executabilityOutput, context));
const executableGuard = applySemanticGroundingGuardV1(executabilityOutput, context);
assert.equal(executableGuard.diagnostics.issuesByCode.SEMANTIC_TARGET_MUTATION_UNSUPPORTED, 2);
assert.equal(executableGuard.diagnostics.issuesByCode.SEMANTIC_FAULT_INJECTION_UNSUPPORTED, 1);
for (const scenario of executableGuard.output.scenarios) {
  assert.equal(scenario.grounding.level, 'ASSUMED');
  assert.equal(scenario.confidence, 'LOW');
  assert.equal(scenario.automationHints.reviewRequired, true);
}
assert.match(executableGuard.output.scenarios[0].automationHints.reasons.join(' '), /path.*fixa|target mutation/i);
assert.match(executableGuard.output.scenarios[1].automationHints.reasons.join(' '), /HTTP Method.*fixa|target mutation/i);
assert.match(executableGuard.output.scenarios[2].automationHints.reasons.join(' '), /fault injection|falha interna/i);

const executableSpec = buildTestSpecificationV1({
  context,
  modelOutput: executableGuard.output,
  generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-18T00:07:19.616Z', contextFingerprint: 'c'.repeat(64) },
});
for (const scenario of executableSpec.scenarios) {
  assert.equal(scenario.automation.readiness, 'REVIEW_REQUIRED');
  assert.equal(scenario.spec.target.method, 'GET');
  assert.equal(scenario.spec.target.path, '/core-api/api-token-list');
}
assert.ok(executableSpec.scenarios[0].automation.blockers.some((reason) => /target mutation/i.test(reason)));
assert.ok(executableSpec.scenarios[2].automation.blockers.some((reason) => /fault injection/i.test(reason)));

const prompt = buildTestDesignPromptV1(context, { scenarioCount: 8 });
assert.equal(TEST_DESIGN_PROMPT_VERSION, 'qagent.test-design-prompt.v4');
assert.match(prompt.systemPrompt, /target mutation/i);
assert.match(prompt.systemPrompt, /fault injection/i);
assert.match(prompt.systemPrompt, /JSON_PATH_EXISTS prova SOMENTE/i);
assert.match(prompt.systemPrompt, /UUID, boolean, date\/date-time/i);
assert.match(prompt.systemPrompt, /contagem correta/i);

// Fix 3: scenario intent must be provable by the current assertion vocabulary.
const capabilityOutput = {
  title: 'Semantic assertion capability regression pack',
  objective: 'Reproduzir gaps entre intenção do cenário e capacidade real da DSL v1.',
  assumptions: [],
  scenarios: [
    baseScenario('COUNT_CAP_012', {
      title: 'Verificar contagem de tokens na resposta',
      objective: 'Confirmar que a contagem de tokens retornada na resposta é correta e corresponde ao número de itens.',
      category: 'DATA_VARIATION',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Schema possui count.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.count' },
      ],
    }),
    baseScenario('NONEMPTY_CAP_013', {
      title: 'Verificar se a lista de tokens não está vazia',
      objective: 'Assegurar que a lista de tokens retornada não está vazia quando existem tokens.',
      category: 'DATA_VARIATION',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Schema possui contents.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents' },
      ],
    }),
    baseScenario('UUID_CAP_014', {
      title: 'Verificar token com ID válido',
      objective: 'Confirmar que cada token possui um ID válido no formato UUID.',
      category: 'DATA_VARIATION',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Schema possui id.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents[*].id' },
      ],
    }),
    baseScenario('BOOL_CAP_015', {
      title: 'Verificar token com campo isDeleted',
      objective: 'Confirmar que o campo isDeleted está presente e é booleano.',
      category: 'DATA_VARIATION',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Schema possui isDeleted.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents[*].isDeleted' },
      ],
    }),
    baseScenario('DATE_CAP_016', {
      title: 'Verificar token com campo createdAt',
      objective: 'Confirmar que o campo createdAt está presente e é uma data válida.',
      category: 'DATA_VARIATION',
      confidence: 'LOW',
      grounding: { level: 'INFERRED', rationale: ['Schema possui createdAt.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents[*].createdAt' },
      ],
    }),
    baseScenario('UUID_SCHEMA_OK_017', {
      title: 'Validar contrato UUID do token',
      objective: 'Confirmar via contrato que o campo id possui formato UUID.',
      category: 'SCHEMA_CONTRACT',
      grounding: { level: 'OBSERVED', rationale: ['Schema estrutural observado.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents[*].id' },
        { type: 'SCHEMA', schemaRef: 'track_response_200' },
      ],
    }),
    baseScenario('BOOL_SCHEMA_OK_018', {
      title: 'Validar contrato boolean do token',
      objective: 'Confirmar via contrato que o campo isDeleted é booleano.',
      category: 'SCHEMA_CONTRACT',
      grounding: { level: 'OBSERVED', rationale: ['Schema estrutural observado.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents[*].isDeleted' },
        { type: 'SCHEMA', schemaRef: 'track_response_200' },
      ],
    }),
    baseScenario('DATE_SCHEMA_OK_019', {
      title: 'Validar contrato date-time do token',
      objective: 'Confirmar via contrato que o campo createdAt é uma data válida no formato date-time.',
      category: 'SCHEMA_CONTRACT',
      grounding: { level: 'OBSERVED', rationale: ['Schema estrutural observado.'], evidenceRefs: ['ev_200_a'], schemaRefs: ['track_response_200'] },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'JSON_PATH_EXISTS', path: '$.contents[*].createdAt' },
        { type: 'SCHEMA', schemaRef: 'track_response_200' },
      ],
    }),
  ],
};
assert.doesNotThrow(() => validateTestDesignModelOutputV1(capabilityOutput, context));
const capabilityGuard = applySemanticGroundingGuardV1(capabilityOutput, context);
assert.equal(capabilityGuard.diagnostics.issuesByCode.SEMANTIC_ASSERTION_CAPABILITY_GAP, 5);
for (const scenario of capabilityGuard.output.scenarios.slice(0, 5)) {
  assert.equal(scenario.automationHints.reviewRequired, true);
  assert.match(scenario.automationHints.reasons.join(' '), /DSL v1|assertion|SCHEMA/i);
}
for (const scenario of capabilityGuard.output.scenarios.slice(5)) {
  assert.equal(scenario.automationHints.reviewRequired, false);
}
const capabilitySpec = buildTestSpecificationV1({
  context,
  modelOutput: capabilityGuard.output,
  generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-18T00:35:08.870Z', contextFingerprint: 'd'.repeat(64) },
});
for (const scenario of capabilitySpec.scenarios.slice(0, 5)) assert.equal(scenario.automation.readiness, 'REVIEW_REQUIRED');
for (const scenario of capabilitySpec.scenarios.slice(5)) assert.equal(scenario.automation.readiness, 'NEEDS_ENVIRONMENT');

let generateCalls = 0;
const serviceResult = await generateCatalogTestDesignV1({
  env: { TEST_DESIGN_SCENARIO_COUNT: '8' },
  organizationId: context.organizationId,
  projectId: context.projectId,
  endpointId: context.endpoint.endpointId,
  aiEngine: {
    async generateJson() {
      generateCalls += 1;
      return { json: modelOutput, provider: 'openai', model: 'gpt-4o-mini', rawText: JSON.stringify(modelOutput) };
    },
    async repairJson() { throw new Error('semantic guard must not require AI repair'); },
  },
  contextBuilder: async () => ({ context, contextFingerprint: 'b'.repeat(64), diagnostics: { runtimeMapping: { status: 'UNMATCHED' } } }),
  resolveAiConfig: async () => ({ source: 'env', provider: 'openai', model: 'gpt-4o-mini', credentials: { apiKey: 'hidden' } }),
  now: () => new Date('2026-08-17T23:03:37.011Z'),
});
assert.equal(generateCalls, 1);
assert.equal(serviceResult.diagnostics.repairAttempts, 0);
assert.equal(serviceResult.diagnostics.semanticGuard.guardVersion, SEMANTIC_GROUNDING_GUARD_VERSION);
assert.ok(serviceResult.diagnostics.semanticGuard.changedScenarioCount >= 6);
assert.equal(serviceResult.specification.summary.byReadiness.NEEDS_ENVIRONMENT, 2);
assert.equal(serviceResult.specification.summary.byReadiness.NEEDS_DATA, 2);
assert.equal(serviceResult.specification.summary.byReadiness.REVIEW_REQUIRED, 4);
assert.equal(JSON.stringify(serviceResult).includes('hidden'), false);

console.log('Foundation 07.6.3-C Semantic Grounding Guard tests passed ✅');

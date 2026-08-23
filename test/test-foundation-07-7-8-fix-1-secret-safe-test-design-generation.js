import assert from 'node:assert/strict';
import { applySecretSafeTestDesignSanitizerV1, SECRET_SAFE_TEST_DESIGN_SANITIZER_VERSION } from '../src/intelligence/secretSafeTestDesignSanitizer.js';
import { generateCatalogTestDesignV1 } from '../src/intelligence/testDesignService.js';
import { buildTestDesignPromptV1, buildTestDesignRepairPromptV1, TEST_DESIGN_PROMPT_VERSION, TEST_DESIGN_REPAIR_PROMPT_VERSION } from '../src/intelligence/testDesignPrompt.js';
import { TestDesignContractError, validateTestDesignModelOutputV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

const context = {
  contractVersion: 'qagent.test-design.v1',
  organizationId: 'org_secret_safe',
  projectId: 'prj_secret_safe',
  endpoint: {
    endpointId: 'cep_profile_update',
    serviceId: 'svc_profile',
    serviceName: 'Profile API',
    classification: 'FIRST_PARTY_API',
    classificationConfidence: 99,
    method: 'POST',
    normalizedPath: '/v1/users/profile',
    discoveryConfidenceScore: 95,
    discoveryConfidenceLevel: 'HIGH',
    lifecycleState: 'DISCOVERED',
    observationCount: 5,
    sessionCount: 2,
    environmentCount: 1,
    successRatePct: 100,
    latencyAvgMs: 100,
    firstSeenAt: '2026-08-23T10:00:00.000Z',
    lastSeenAt: '2026-08-23T11:00:00.000Z',
  },
  schemas: [
    {
      trackId: 'req_profile', direction: 'REQUEST', statusCode: null,
      currentVersionId: 'cst_req_profile', currentSchemaHash: 'sch_req_profile',
      contentTypes: ['application/json'],
      schema: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          firstName: { type: 'string' },
          newPassword: { type: 'string' },
          newPasswordConfirmation: { type: 'string' },
        },
      },
      versions: [{ versionId: 'cst_req_profile', schemaHash: 'sch_req_profile', observationCount: 5, introducedAt: '2026-08-23T10:00:00.000Z' }],
    },
    {
      trackId: 'res_profile_200', direction: 'RESPONSE', statusCode: 200,
      currentVersionId: 'cst_res_profile_200', currentSchemaHash: 'sch_res_profile_200',
      contentTypes: ['application/json'],
      schema: { type: 'object', properties: { username: { type: 'string' }, firstName: { type: 'string' } } },
      versions: [{ versionId: 'cst_res_profile_200', schemaHash: 'sch_res_profile_200', observationCount: 5, introducedAt: '2026-08-23T10:00:00.000Z' }],
    },
  ],
  evidence: [
    {
      evidenceId: 'cev_profile_200', observedAt: '2026-08-23T11:00:00.000Z', environmentId: 'env_stg',
      outcome: 'HTTP_2XX', statusCode: 200, latencyMs: 100, sourceHost: 'api.example.test', sessionId: 'obs_1',
      requestSchemaVersionId: 'cst_req_profile', responseSchemaVersionId: 'cst_res_profile_200', authObserved: false, authScheme: null,
    },
  ],
  environments: [{ environmentId: 'env_stg', name: 'STG', observationCount: 5, successRatePct: 100, lastSeenAt: '2026-08-23T11:00:00.000Z' }],
  runtime: {
    apiServiceKey: 'profile-api',
    defaultAuthProfileRef: null,
    availableAuthProfileRefs: [],
    authObservation: { status: 'NONE', scheme: null, evidenceRefs: [] },
  },
};

function scenario(id) {
  return {
    scenarioId: id,
    title: 'Atualizar perfil com dados válidos',
    objective: 'Validar atualização do perfil sem persistir material sensível no Test Design.',
    category: 'HAPPY_PATH',
    priority: 'HIGH',
    confidence: 'HIGH',
    grounding: {
      level: 'OBSERVED', rationale: ['HTTP 200 e schemas foram observados.'],
      evidenceRefs: ['cev_profile_200'], schemaRefs: ['cst_req_profile', 'cst_res_profile_200'],
    },
    preconditions: [],
    authRequirement: 'NONE',
    request: {
      pathParams: {},
      query: {},
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-token' },
      body: {
        username: 'usuario_existente',
        firstName: 'Novo',
        newPassword: 'novaSenha',
        newPasswordConfirmation: 'novaSenha',
        nested: { clientSecret: 'fake-client-secret' },
      },
    },
    assertions: [
      { type: 'STATUS', expectedStatusCodes: [200] },
      { type: 'SCHEMA', schemaRef: 'cst_res_profile_200' },
      { type: 'JSON_PATH_EXISTS', path: '$.access_token' },
    ],
    extract: [
      { name: 'profileToken', source: 'JSON_PATH', selector: '$.access_token' },
      { name: 'contentType', source: 'HEADER', selector: 'Content-Type' },
    ],
    automationHints: { needsData: false, reviewRequired: false, reasons: [] },
  };
}

function output() {
  return {
    title: 'Perfil de usuário',
    objective: 'Validar atualização de perfil.',
    assumptions: [],
    scenarios: ['test_001', 'test_002', 'test_003', 'test_004'].map(scenario),
  };
}

assert.throws(
  () => validateTestDesignModelOutputV1(output(), context),
  (error) => error instanceof TestDesignContractError && error.code === 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN',
  'Strict contract must still reject unsanitized secret material',
);

const sanitized = applySecretSafeTestDesignSanitizerV1(output());
assert.equal(sanitized.diagnostics.sanitizerVersion, SECRET_SAFE_TEST_DESIGN_SANITIZER_VERSION);
assert.equal(sanitized.diagnostics.sanitizedScenarioCount, 4);
assert.ok(sanitized.diagnostics.removedMaterialCount >= 20);
assert.equal(sanitized.diagnostics.needsDataScenarioCount, 4);
assert.equal(sanitized.diagnostics.reviewRequiredScenarioCount, 4);
for (const item of sanitized.output.scenarios) {
  assert.equal(Object.hasOwn(item.request.body, 'newPassword'), false);
  assert.equal(Object.hasOwn(item.request.body, 'newPasswordConfirmation'), false);
  assert.equal(Object.hasOwn(item.request.headers, 'Authorization'), false);
  assert.equal(Object.hasOwn(item.request.body, 'nested'), true);
  assert.deepEqual(item.request.body.nested, {});
  assert.equal(item.automationHints.needsData, true);
  assert.equal(item.automationHints.reviewRequired, true);
  assert.equal(item.assertions.some((assertion) => assertion.path === '$.access_token'), false);
  assert.equal(item.extract.some((extract) => extract.selector === '$.access_token'), false);
  assert.equal(item.extract.some((extract) => extract.selector === 'Content-Type'), true);
}
assert.doesNotThrow(() => validateTestDesignModelOutputV1(sanitized.output, context));
const serializedSanitized = JSON.stringify(sanitized.output);
assert.equal(serializedSanitized.includes('novaSenha'), false);
assert.equal(serializedSanitized.includes('fake-token'), false);
assert.equal(serializedSanitized.includes('fake-client-secret'), false);

const prompt = buildTestDesignPromptV1(context, { scenarioCount: 4 });
assert.equal(TEST_DESIGN_PROMPT_VERSION, 'qagent.test-design-prompt.v6.2');
assert.match(prompt.systemPrompt, /NÃO podem aparecer no request/i);
assert.match(prompt.systemPrompt, /Nunca substitua um secret proibido/i);
assert.match(prompt.systemPrompt, /automationHints\.needsData=true/);
const repairPrompt = buildTestDesignRepairPromptV1(context, { scenarioCount: 4 });
assert.equal(TEST_DESIGN_REPAIR_PROMPT_VERSION, 'qagent.test-design-repair-prompt.v1.1');
assert.match(repairPrompt.systemPrompt, /Remova completamente campos sensíveis/i);
assert.match(repairPrompt.systemPrompt, /placeholder/i);

let repairCalls = 0;
const result = await generateCatalogTestDesignV1({
  env: { TEST_DESIGN_SCENARIO_COUNT: '4' },
  organizationId: context.organizationId,
  projectId: context.projectId,
  endpointId: context.endpoint.endpointId,
  aiEngine: {
    async generateJson() {
      return { json: output(), provider: 'openai', model: 'gpt-4o-mini', rawText: JSON.stringify(output()) };
    },
    async repairJson() {
      repairCalls += 1;
      return output();
    },
  },
  contextBuilder: async () => ({ context, contextFingerprint: 'b'.repeat(64), diagnostics: { runtimeMapping: { status: 'MATCHED' } } }),
  resolveAiConfig: async () => ({ source: 'env', provider: 'openai', model: 'gpt-4o-mini', credentials: { apiKey: 'not-returned' } }),
  now: () => new Date('2026-08-23T17:30:00.000Z'),
});

assert.equal(repairCalls, 0, 'Secret sanitizer must avoid wasting an AI repair for forbidden request material');
assert.equal(result.diagnostics.repairAttempts, 0);
assert.equal(result.diagnostics.secretSafeSanitizer.sanitizerVersion, SECRET_SAFE_TEST_DESIGN_SANITIZER_VERSION);
assert.equal(result.diagnostics.secretSafeSanitizer.sanitizedScenarioCount, 4);
assert.ok(result.diagnostics.secretSafeSanitizer.removedMaterialCount > 0);
assert.equal(result.specification.summary.byReadiness.REVIEW_REQUIRED, 4, 'Sensitive assertion/extract intent forces review');
for (const item of result.specification.scenarios) {
  assert.equal(Object.hasOwn(item.spec.request.body, 'newPassword'), false);
  assert.equal(Object.hasOwn(item.spec.request.body, 'newPasswordConfirmation'), false);
  assert.equal(Object.hasOwn(item.spec.request.headers, 'Authorization'), false);
  assert.equal(item.automation.blockers.some((blocker) => /Secret Guard/i.test(blocker)), true);
}
assert.doesNotThrow(() => validateTestSpecificationV1(result.specification, context));
const serializedResult = JSON.stringify(result);
assert.equal(serializedResult.includes('novaSenha'), false);
assert.equal(serializedResult.includes('fake-token'), false);
assert.equal(serializedResult.includes('fake-client-secret'), false);
assert.equal(serializedResult.includes('not-returned'), false);

console.log('Foundation 07.7.8 FIX-1 Secret-Safe Test Design Generation tests passed ✅');

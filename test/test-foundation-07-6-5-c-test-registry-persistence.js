import assert from 'node:assert/strict';
import { buildTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';
import {
  createGenerationRequestId,
  generateAndPersistCatalogTestDesignV1,
  persistGeneratedTestDesignV1,
} from '../src/intelligence/testDesignPersistence.js';
import { appendTestDesignVersion } from '../src/services/testRegistryClient.js';

const organizationId = 'org_registry_c';
const projectId = 'prj_registry_c';
const endpointId = 'cep_registry_c';
const fingerprint = 'a'.repeat(64);

function context() {
  return {
    contractVersion: 'qagent.test-design.v1',
    organizationId,
    projectId,
    endpoint: {
      endpointId,
      serviceId: 'svc_checkout',
      serviceName: 'Checkout API',
      classification: 'FIRST_PARTY_API',
      classificationConfidence: 98,
      method: 'GET',
      normalizedPath: '/orders/{id}',
      discoveryConfidenceScore: 95,
      discoveryConfidenceLevel: 'HIGH',
      lifecycleState: 'DISCOVERED',
      observationCount: 10,
      sessionCount: 2,
      environmentCount: 1,
      successRatePct: 100,
      latencyAvgMs: 80,
      firstSeenAt: '2026-08-19T10:00:00.000Z',
      lastSeenAt: '2026-08-20T10:00:00.000Z',
    },
    schemas: [],
    evidence: [],
    environments: [
      { environmentId: 'env_stg', name: 'STG', observationCount: 10, successRatePct: 100, lastSeenAt: '2026-08-20T10:00:00.000Z' },
    ],
    runtime: {
      apiServiceKey: 'checkout',
      defaultAuthProfileRef: null,
      availableAuthProfileRefs: [],
    },
  };
}

function modelOutput() {
  return {
    title: 'GET /orders/{id} — estratégia de testes',
    objective: 'Validar o endpoint observado.',
    assumptions: [],
    scenarios: [
      {
        scenarioId: 'scn_001',
        title: 'Consulta pedido',
        objective: 'Validar retorno do pedido.',
        category: 'HAPPY_PATH',
        priority: 'HIGH',
        confidence: 'MEDIUM',
        grounding: {
          level: 'INFERRED',
          rationale: ['Cenário derivado da identidade observada do endpoint.'],
          evidenceRefs: [],
          schemaRefs: [],
        },
        preconditions: [],
        authRequirement: 'NONE',
        request: {
          pathParams: { id: 'order-123' },
          query: {},
          headers: { Accept: 'application/json' },
          body: null,
        },
        assertions: [{ type: 'STATUS', expectedStatusCodes: [200] }],
        extract: [],
        automationHints: { needsData: false, reviewRequired: false, reasons: [] },
      },
    ],
  };
}

function generationResult() {
  const specification = buildTestSpecificationV1({
    context: context(),
    modelOutput: modelOutput(),
    generation: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      generatedAt: '2026-08-20T21:00:00.000Z',
      contextFingerprint: fingerprint,
    },
  });

  return {
    specification,
    contextFingerprint: fingerprint,
    diagnostics: {
      engineVersion: 'qagent.ai-test-design-engine.v1',
      promptVersion: 'qagent.test-design-prompt.v5',
      repairPromptVersion: 'qagent.test-design-repair-prompt.v1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      semanticGuard: { guardVersion: 'qagent.semantic-grounding-guard.v1.2', issueCount: 0 },
    },
  };
}

// ID must satisfy Registry tdg_* contract.
const generatedId = createGenerationRequestId(() => '12345678-1234-1234-1234-123456789abc');
assert.equal(generatedId, 'tdg_12345678-1234-1234-1234-123456789abc');
assert.match(generatedId, /^tdg_[A-Za-z0-9_-]{8,124}$/);

// Service Binding call sends authoritative tenant scope + only whitelisted metadata.
let capturedRequest;
const envWithBinding = {
  TEST_REGISTRY_TIMEOUT_MS: '10000',
  TEST_REGISTRY_PERSIST_RETRIES: '1',
  TEST_REGISTRY_SERVICE: {
    fetch: async (request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({
        status: 'ok',
        data: {
          created: true,
          idempotentReplay: false,
          testDesign: {
            id: 'td_root_1',
            versionId: 'tdv_version_1',
            version: 1,
            organizationId,
            projectId,
            endpointId,
            contextFingerprint: fingerprint,
            createdAt: '2026-08-20T21:00:01.000Z',
          },
        },
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  },
};

const appendResult = await appendTestDesignVersion({
  env: envWithBinding,
  organizationId,
  projectId,
  endpointId,
  generationRequestId: 'tdg_append_12345678',
  generationResult: generationResult(),
});
assert.equal(appendResult.testDesign.version, 1);
assert.equal(capturedRequest.url, 'https://qagent-test-registry.internal/v1/test-registry/test-designs/versions');
assert.equal(capturedRequest.headers.get('x-qagent-organization-id'), organizationId);
assert.equal(capturedRequest.headers.get('x-qagent-project-id'), projectId);
const capturedBody = JSON.parse(await capturedRequest.clone().text());
assert.equal(capturedBody.organizationId, organizationId);
assert.equal(capturedBody.projectId, projectId);
assert.equal(capturedBody.endpointId, endpointId);
assert.equal(capturedBody.contextFingerprint, fingerprint);
assert.equal(capturedBody.specification.specificationVersion, 'qagent.test-spec.v1');
assert.deepEqual(Object.keys(capturedBody.metadata).sort(), ['guardVersion','model','promptVersion','provider','repairPromptVersion'].sort());
assert.equal(Object.hasOwn(capturedBody, 'diagnostics'), false, 'raw diagnostics must not be persisted');
assert.equal(Object.hasOwn(capturedBody, 'prompt'), false);
assert.equal(Object.hasOwn(capturedBody, 'rawOutput'), false);

// A transport retry reuses the SAME generationRequestId, so Registry idempotency is effective.
const seenRequestIds = [];
let transportAttempts = 0;
const retried = await appendTestDesignVersion({
  env: { TEST_REGISTRY_PERSIST_RETRIES: '1' },
  organizationId,
  projectId,
  endpointId,
  generationRequestId: 'tdg_retry_12345678',
  generationResult: generationResult(),
  fetchImpl: async (request) => {
    transportAttempts += 1;
    const body = JSON.parse(await request.text());
    seenRequestIds.push(body.generationRequestId);
    if (transportAttempts === 1) throw new Error('connection reset after upstream commit uncertainty');
    return new Response(JSON.stringify({
      status: 'ok',
      data: {
        created: false,
        idempotentReplay: true,
        testDesign: { id: 'td_root_1', versionId: 'tdv_version_1', version: 1 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(transportAttempts, 2);
assert.deepEqual(seenRequestIds, ['tdg_retry_12345678', 'tdg_retry_12345678']);
assert.equal(retried.idempotentReplay, true);

// Persistence wrapper returns the persisted envelope expected by the existing POST.
const logs = [];
const persisted = await persistGeneratedTestDesignV1({
  env: { log: (event, fields) => logs.push({ event, fields }) },
  organizationId,
  projectId,
  endpointId,
  generationRequestId: 'tdg_persist_12345678',
  generationResult: generationResult(),
  registryAppend: async ({ generationRequestId }) => ({
    created: true,
    idempotentReplay: false,
    testDesign: { id: 'td_123', versionId: 'tdv_123', version: 1, generationRequestId },
  }),
});
assert.deepEqual(persisted.testDesign, { id: 'td_123', versionId: 'tdv_123', version: 1, persisted: true });
assert.equal(persisted.specification.specificationVersion, 'qagent.test-spec.v1');
assert.equal(persisted.contextFingerprint, fingerprint);
assert.equal(logs.some((item) => item.event === 'testDesign_persisted'), true);
assert.equal(JSON.stringify(logs).includes('specification'), false, 'logs must not contain full specification');

// Generation must complete before persistence is attempted.
const orchestrationOrder = [];
const orchestrated = await generateAndPersistCatalogTestDesignV1({
  env: {},
  organizationId,
  projectId,
  endpointId,
  accountId: 'acct_1',
  generationRequestIdFactory: () => 'tdg_orchestrated_12345678',
  generateDesign: async () => {
    orchestrationOrder.push('generate');
    return generationResult();
  },
  registryAppend: async ({ generationRequestId, generationResult: received }) => {
    orchestrationOrder.push('persist');
    assert.equal(generationRequestId, 'tdg_orchestrated_12345678');
    assert.equal(received.specification.specificationVersion, 'qagent.test-spec.v1');
    return { created: true, idempotentReplay: false, testDesign: { id: 'td_456', versionId: 'tdv_456', version: 2 } };
  },
});
assert.deepEqual(orchestrationOrder, ['generate', 'persist']);
assert.equal(orchestrated.testDesign.version, 2);

let persistCalledAfterGenerationFailure = false;
await assert.rejects(
  () => generateAndPersistCatalogTestDesignV1({
    env: {}, organizationId, projectId, endpointId,
    generateDesign: async () => { throw Object.assign(new Error('guard failed'), { code: 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN' }); },
    registryAppend: async () => { persistCalledAfterGenerationFailure = true; },
  }),
  (error) => error?.code === 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN',
);
assert.equal(persistCalledAfterGenerationFailure, false, 'Registry must never receive an artifact when generation/guards fail');

// Any persistence failure becomes the safe Gateway contract requested by 07.6.5-C.
await assert.rejects(
  () => persistGeneratedTestDesignV1({
    env: {}, organizationId, projectId, endpointId,
    generationRequestId: 'tdg_fail_12345678',
    generationResult: generationResult(),
    registryAppend: async () => { throw Object.assign(new Error('D1 unavailable'), { code: 'TEST_REGISTRY_DB_UNAVAILABLE', status: 503, retryable: true }); },
  }),
  (error) => {
    assert.equal(error?.status, 503);
    assert.equal(error?.code, 'TEST_DESIGN_PERSISTENCE_FAILED');
    assert.deepEqual(error?.publicDetails, { retryable: true });
    assert.equal(error?.message.includes('D1'), false, 'internal persistence detail must not leak in public message');
    return true;
  },
);

// Invalid Registry success envelopes are never treated as persisted=true.
await assert.rejects(
  () => appendTestDesignVersion({
    env: {}, organizationId, projectId, endpointId,
    generationRequestId: 'tdg_invalid_12345678',
    generationResult: generationResult(),
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ok', data: {} }), { status: 200 }),
  }),
  (error) => error?.code === 'TEST_REGISTRY_RESPONSE_INVALID',
);

console.log('Foundation 07.6.5-C Gateway Test Registry persistence tests passed ✅');

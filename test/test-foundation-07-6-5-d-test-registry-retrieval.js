import assert from 'node:assert/strict';
import { getConsoleTestDesign } from '../src/handlers/consoleIntelligence.js';
import { loadLatestPersistedTestDesignV1 } from '../src/intelligence/testDesignRetrieval.js';
import { getLatestTestDesign } from '../src/services/testRegistryClient.js';

const organizationId = 'org_registry_d';
const projectId = 'prj_registry_d';
const endpointId = 'cep_registry_d';
const fingerprint = 'b'.repeat(64);

function registryEnvelope({ exists = true } = {}) {
  if (!exists) {
    return { status: 'ok', data: { exists: false, testDesign: null, version: null } };
  }
  const specification = {
    contractVersion: 'qagent.test-design.v1',
    specificationVersion: 'qagent.test-spec.v1',
    source: { type: 'CATALOG_ENDPOINT', organizationId, projectId, endpointId },
    title: 'Persisted design',
    objective: 'Retrieve persisted artifact.',
    assumptions: [],
    summary: { scenarioCount: 1, readyCount: 1, byCategory: {}, byReadiness: {}, byGrounding: {} },
    scenarios: [{ scenarioId: 'test_001', automation: { readiness: 'READY', blockers: [] } }],
    generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-20T22:00:00.000Z', contextFingerprint: fingerprint },
  };
  return {
    status: 'ok',
    data: {
      exists: true,
      testDesign: {
        id: 'td_root_d', organizationId, projectId, endpointId, status: 'ACTIVE',
        latestVersion: 2, latestVersionId: 'tdv_d_2',
        createdAt: '2026-08-20T21:00:00.000Z', updatedAt: '2026-08-20T22:00:00.000Z',
      },
      version: {
        id: 'tdv_d_2', testDesignId: 'td_root_d', organizationId, projectId, endpointId,
        version: 2, generationRequestId: 'tdg_hidden_12345678', contextFingerprint: fingerprint,
        contractVersion: 'qagent.test-design.v1', specificationVersion: 'qagent.test-spec.v1',
        provider: 'openai', model: 'gpt-4o-mini', promptVersion: 'qagent.test-design-prompt.v5',
        repairPromptVersion: 'qagent.test-design-repair-prompt.v1', guardVersion: 'qagent.semantic-grounding-guard.v1.2',
        scenarioCount: 1, readyCount: 1, reviewRequiredCount: 0, specification,
        generationMetadata: { provider: 'openai' }, safeDiagnostics: null, createdAt: '2026-08-20T22:00:00.000Z',
      },
    },
  };
}

// Internal Service Binding retrieval sends authoritative tenant headers and exposes only the BFF contract.
let capturedRequest;
const latest = await getLatestTestDesign({
  env: {}, organizationId, projectId, endpointId,
  fetchImpl: async (request) => {
    capturedRequest = request;
    return new Response(JSON.stringify(registryEnvelope()), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(capturedRequest.method, 'GET');
assert.equal(capturedRequest.url, `https://qagent-test-registry.internal/v1/test-registry/projects/${projectId}/endpoints/${endpointId}/test-design/latest`);
assert.equal(capturedRequest.headers.get('x-qagent-organization-id'), organizationId);
assert.equal(capturedRequest.headers.get('x-qagent-project-id'), projectId);
assert.equal(latest.exists, true);
assert.deepEqual(Object.keys(latest.testDesign).sort(), ['contextFingerprint', 'createdAt', 'id', 'specification', 'version', 'versionId'].sort());
assert.equal(latest.testDesign.version, 2);
assert.equal(latest.testDesign.specification.specificationVersion, 'qagent.test-spec.v1');
assert.equal(Object.hasOwn(latest.testDesign, 'generationRequestId'), false);

// Endpoint without a persisted design is a normal 200/exists=false state.
const missing = await getLatestTestDesign({
  env: {}, organizationId, projectId, endpointId,
  fetchImpl: async () => new Response(JSON.stringify(registryEnvelope({ exists: false })), { status: 200 }),
});
assert.deepEqual(missing, { exists: false, testDesign: null });

// A cross-scope/corrupt Registry response is never forwarded to Console.
await assert.rejects(
  getLatestTestDesign({
    env: {}, organizationId, projectId, endpointId,
    fetchImpl: async () => {
      const body = registryEnvelope();
      body.data.version.projectId = 'prj_other';
      return new Response(JSON.stringify(body), { status: 200 });
    },
  }),
  (error) => error?.code === 'TEST_REGISTRY_RESPONSE_INVALID' && error?.status === 502,
);

// Retrieval wrapper logs only safe metadata and maps upstream failures to the public D error.
const logs = [];
const wrapped = await loadLatestPersistedTestDesignV1({
  env: { log: (event, fields) => logs.push({ event, fields }) },
  organizationId, projectId, endpointId,
  registryGetLatest: async () => latest,
});
assert.equal(wrapped.exists, true);
assert.equal(logs.some((item) => item.event === 'testDesign_latest_loaded'), true);
assert.equal(JSON.stringify(logs).includes('Persisted design'), false, 'logs must not contain the specification');

await assert.rejects(
  loadLatestPersistedTestDesignV1({
    env: {}, organizationId, projectId, endpointId,
    registryGetLatest: async () => {
      const error = new Error('upstream unavailable');
      error.code = 'TEST_REGISTRY_UPSTREAM_UNAVAILABLE';
      error.status = 503;
      error.retryable = true;
      throw error;
    },
  }),
  (error) => error?.code === 'TEST_DESIGN_RETRIEVAL_FAILED' && error?.status === 503 && error?.publicDetails?.retryable === true,
);

// Console handler authorizes tenant/project BEFORE touching Registry.
const order = [];
const handlerResult = await getConsoleTestDesign(
  new Request('https://api.apiqagent.com/v1/console/projects/prj_registry_d/intelligence/endpoints/cep_registry_d/test-design', {
    headers: { Authorization: 'Bearer fake' },
  }),
  {},
  { projectId, endpointId },
  {
    requireTenant: async () => { order.push('tenant'); return { organizationId, accountId: 'acct_1' }; },
    getProject: async (_env, org, project) => { order.push('project'); assert.equal(org, organizationId); assert.equal(project, projectId); },
    loadLatest: async ({ organizationId: org, projectId: project, endpointId: endpoint }) => {
      order.push('registry');
      assert.equal(org, organizationId); assert.equal(project, projectId); assert.equal(endpoint, endpointId);
      return latest;
    },
  },
);
assert.deepEqual(order, ['tenant', 'project', 'registry']);
assert.equal(handlerResult.status, 'ok');
assert.equal(handlerResult.data.testDesign.version, 2);

let registryTouched = false;
await assert.rejects(
  getConsoleTestDesign(
    new Request('https://api.apiqagent.com/v1/console/projects/prj_other/intelligence/endpoints/cep_registry_d/test-design'),
    {},
    { projectId: 'prj_other', endpointId },
    {
      requireTenant: async () => ({ organizationId }),
      getProject: async () => { const error = new Error('project denied'); error.status = 404; throw error; },
      loadLatest: async () => { registryTouched = true; return missing; },
    },
  ),
  (error) => error?.status === 404,
);
assert.equal(registryTouched, false, 'Registry must not be called when project authorization fails');

console.log('Foundation 07.6.5-D Test Registry retrieval tests passed ✅');

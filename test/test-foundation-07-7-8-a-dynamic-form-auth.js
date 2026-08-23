import assert from 'node:assert/strict';
import { normalizeAuthProfileConfig } from '../src/lib/authProfileConfig.js';
import { discoveredRuntimeServiceKey } from '../src/intelligence/discoveredRuntime.js';
import { materializeExecutionPlanV1 } from '../src/services/executionPlanMaterializerService.js';
import { postInternalRunnerAuthMaterial } from '../src/handlers/internalRunnerControl.js';
import { sha256Hex, RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION } from '../src/lib/runContracts.js';

const organizationId = 'org_0778a';
const projectId = 'prj_0778a';
const endpointId = 'cep_0778a_profile';
const environmentId = 'env_0778a_stg';
const origin = 'https://k51qryqov3.execute-api.ap-southeast-2.amazonaws.com';
const discoveredKey = discoveredRuntimeServiceKey(origin);
const authProfileRef = 'authp_0778a_dynamic_login';

const normalized = normalizeAuthProfileConfig('login_http_json', {
  targetMode: 'runtime_origin',
  path: '/prod/oauth/token',
  bodyEncoding: 'form',
  usernameField: 'username',
  passwordField: 'password',
  staticBody: { grant_type: 'password' },
  tokenSource: 'json',
  tokenJsonPath: 'access_token',
  targetHeader: 'Authorization',
  scheme: 'Bearer',
});
assert.equal(normalized.targetMode, 'runtime_origin');
assert.equal(normalized.apiServiceKey, null);
assert.equal(normalized.bodyEncoding, 'form');
assert.deepEqual(normalized.staticBody, { grant_type: 'password' });
assert.equal(normalized.tokenJsonPath, 'access_token');

assert.throws(
  () => normalizeAuthProfileConfig('login_http_json', {
    targetMode: 'runtime_origin', path: '/login', bodyEncoding: 'form', staticBody: { nested: { no: true } },
  }),
  (error) => error?.code === 'INVALID_AUTH_STATIC_FORM_FIELDS',
);

const endpointDetail = {
  endpointId,
  method: 'GET',
  normalizedPath: '/prod/users/profile',
  discoveryConfidenceLevel: 'HIGH',
  environmentCount: 1,
  environments: [{ environmentId }],
  bindings: [{ environmentId, scheme: 'https', host: 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com', port: null }],
};
const evidence = [{
  evidenceId: 'cev_0778a_200', environmentId, scheme: 'https',
  host: 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com', statusCode: 200,
  evidenceOutcomeClass: 'HTTP_2XX', authObserved: true, authScheme: 'BEARER',
}];
const specification = {
  contractVersion: 'qagent.test-design.v1',
  specificationVersion: 'qagent.test-spec.v1',
  source: { type: 'CATALOG_ENDPOINT', organizationId, projectId, endpointId },
  scenarios: [{
    scenarioId: 'test_001', title: 'Perfil autenticado', category: 'HAPPY_PATH', priority: 'HIGH', confidence: 'HIGH',
    grounding: { level: 'OBSERVED' }, automation: { readiness: 'READY', blockers: [] },
    spec: {
      dslVersion: 'qagent.api-test-dsl.v1', type: 'api',
      target: { catalogEndpointId: endpointId, apiServiceKey: discoveredKey, method: 'GET', path: '/prod/users/profile' },
      auth: { requirement: 'REQUIRED', authProfileRef },
      request: { pathParams: {}, query: {}, headers: {}, body: null }, assertions: [], extract: [],
    },
  }],
};
const artifact = {
  organizationId, projectId, endpointId,
  testDesignId: 'td_0778a', testDesignVersionId: 'tdv_0778a', version: 1,
  specificationVersion: 'qagent.test-spec.v1', contextFingerprint: 'f'.repeat(64), specification,
};
const runtimeConfig = {
  organizationId, projectId,
  environment: { environmentId, name: 'STG', slug: 'stg', environmentType: 'STG', isDefault: true },
  apiServices: {}, variables: {},
  authProfiles: {
    'buggy-login': {
      authProfileId: authProfileRef, name: 'Buggy Login', type: 'login_http_json', config: normalized, credentialsConfigured: true,
    },
  },
};

const materialized = await materializeExecutionPlanV1({
  organizationId, projectId, artifact, environmentId, confirmDiscoveredRuntime: true,
  runId: 'run_0778a', executionPlanId: 'xplan_0778a', runtimeSnapshotId: 'rts_0778a', createdAt: '2026-08-23T15:00:00.000Z',
  resolveRuntime: async () => runtimeConfig,
  loadEndpoint: async () => endpointDetail,
  loadEvidence: async () => evidence,
  loadSchemas: async () => ({ endpointId, tracks: [] }),
});

assert.equal(materialized.runtimeSnapshot.apiServices[discoveredKey].baseUrl, origin);
const frozenProfile = materialized.runtimeSnapshot.authProfiles[authProfileRef];
assert.equal(frozenProfile.config.targetMode, 'runtime_origin');
assert.equal(frozenProfile.config.apiServiceKey, null);
assert.deepEqual(frozenProfile.target, {
  source: 'SCENARIO_RUNTIME', apiServiceKey: discoveredKey, path: '/prod/oauth/token', method: 'POST',
});

// The Runner Control route returns the immutable auth target derived from the scenario runtime,
// while credentials are resolved JIT from the current Secret Vault binding.
const runId = 'run_0778a_control';
const attemptId = 'runatt_0778a_control';
const leaseToken = 'L'.repeat(43);
const runtimePlanHash = '8'.repeat(64);
const leaseTokenHash = await sha256Hex(leaseToken);
const req = new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/auth-material`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    contractVersion: RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION,
    attemptId, leaseToken, runtimePlanHash, authProfileRef,
  }),
});
const bundle = {
  run: { runId, organizationId, projectId, environmentId, status: 'QUEUED', executionPlanId: 'xplan', runtimeSnapshotId: 'rts' },
  executionPlan: { executionPlanId: 'xplan', runtimeSnapshotId: 'rts', plan: { scenarios: [{ scenarioId: 'test_001', spec: { auth: { requirement: 'REQUIRED', authProfileRef } } }] } },
  runtimeSnapshot: {
    runtimeSnapshotId: 'rts',
    snapshot: {
      apiServices: materialized.runtimeSnapshot.apiServices,
      authProfiles: materialized.runtimeSnapshot.authProfiles,
    },
  },
  latestAttempt: { attemptId, status: 'CLAIMED', runtimeReadinessStatus: 'READY', runtimePlanHash },
};
const response = await postInternalRunnerAuthMaterial(req, {}, { runId }, {
  verifyRequest: async () => true,
  getBundle: async () => bundle,
  getClaim: async () => ({ state: 'ACTIVE', currentAttemptId: attemptId, leaseTokenHash, leaseExpiresAt: '2099-01-01T00:00:00.000Z' }),
  resolveRuntimeAuth: async () => ({
    authProfileId: authProfileRef, profileKey: 'buggy-login', type: 'login_http_json', credentials: { username: 'qa', password: 'secret' },
  }),
  now: () => '2026-08-23T15:00:01.000Z',
});
assert.equal(response.data.target.source, 'SCENARIO_RUNTIME');
assert.equal(response.data.target.baseUrl, origin);
assert.equal(response.data.target.path, '/prod/oauth/token');
assert.equal(response.data.config.bodyEncoding, 'form');
assert.equal(response.data.credentials.username, 'qa');
assert.equal(JSON.stringify(response.data.target).includes('secret'), false);

console.log('Foundation 07.7.8-A Dynamic Form / OAuth Password gateway tests passed ✅');

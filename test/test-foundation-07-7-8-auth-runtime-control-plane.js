import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRunnerAuthMaterialRequestInput,
  normalizeRunnerAuthResolvedInput,
  normalizeRunnerRejectedInput,
  RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION,
  RUNNER_AUTH_MATERIAL_CONTRACT_VERSION,
  RUNNER_AUTH_RESOLVED_CONTRACT_VERSION,
  sha256Hex,
} from '../src/lib/runContracts.js';
import {
  postInternalRunnerAuthMaterial,
  postInternalRunnerAuthResolved,
} from '../src/handlers/internalRunnerControl.js';
import { getRunV1 } from '../src/services/runService.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const runId = 'run_0778_12345678';
const attemptId = 'runatt_0778_12345678';
const leaseToken = 'L'.repeat(43);
const runtimePlanHash = '8'.repeat(64);
const authProfileRef = 'authp_0778_profile123';
const environmentId = 'env_0778_stg12345';
const nowIso = '2026-08-23T02:00:00.000Z';
const futureIso = '2026-08-23T02:01:00.000Z';
const leaseTokenHash = await sha256Hex(leaseToken);

assert.equal(RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION, 'qagent.runner-auth-material-request.v1');
assert.equal(RUNNER_AUTH_MATERIAL_CONTRACT_VERSION, 'qagent.runner-auth-material.v1');
assert.equal(RUNNER_AUTH_RESOLVED_CONTRACT_VERSION, 'qagent.runner-auth-resolved.v1');

// Strict control contracts: no credential/token field can be smuggled into request or persisted summary.
{
  const normalized = normalizeRunnerAuthMaterialRequestInput({
    contractVersion: RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION,
    attemptId,
    leaseToken,
    runtimePlanHash,
    authProfileRef,
  });
  assert.equal(normalized.authProfileRef, authProfileRef);
  assert.throws(() => normalizeRunnerAuthMaterialRequestInput({
    contractVersion: RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION,
    attemptId, leaseToken, runtimePlanHash, authProfileRef,
    credentials: { apiKey: 'must-never-be-accepted' },
  }), (error) => error.code === 'RUNNER_AUTH_MATERIAL_CONTRACT_INVALID');
}

{
  const normalized = normalizeRunnerAuthResolvedInput({
    contractVersion: RUNNER_AUTH_RESOLVED_CONTRACT_VERSION,
    attemptId,
    leaseToken,
    runtimePlanHash,
    requiredScenarioCount: 2,
    resolvedProfileCount: 1,
    dynamicExchangeCount: 0,
    cacheHitCount: 1,
    durationMs: 5,
  });
  assert.equal(normalized.requiredScenarioCount, 2);
  assert.equal(normalized.cacheHitCount, 1);
  assert.throws(() => normalizeRunnerAuthResolvedInput({
    contractVersion: RUNNER_AUTH_RESOLVED_CONTRACT_VERSION,
    attemptId, leaseToken, runtimePlanHash,
    requiredScenarioCount: 1, resolvedProfileCount: 1, dynamicExchangeCount: 0, cacheHitCount: 0, durationMs: 1,
    accessToken: 'must-not-enter-control-plane',
  }), (error) => error.code === 'RUNNER_AUTH_RESOLVED_CONTRACT_INVALID');
}

// 07.7.8 adds AUTH as an explicit rejection phase.
{
  const rejected = normalizeRunnerRejectedInput({
    contractVersion: 'qagent.runner-rejected.v1', attemptId, leaseToken,
    errorCode: 'RUNNER_AUTH_UPSTREAM_REJECTED', phase: 'AUTH',
  });
  assert.equal(rejected.phase, 'AUTH');
}

function baseBundle({
  profileType = 'api_key',
  profileConfig = { placement: 'header', name: 'Authorization', prefix: '' },
  referenced = true,
  includeProfile = true,
  dynamicService = null,
} = {}) {
  const authProfiles = includeProfile ? {
    [authProfileRef]: {
      authProfileId: authProfileRef,
      profileKey: 'stg-auth',
      name: 'STG Auth',
      type: profileType,
      config: structuredClone(profileConfig),
      credentialsConfigured: true,
    },
  } : {};
  const apiServices = {
    'test-api': { apiServiceId: 'svc_test', serviceKey: 'test-api', name: 'Test API', baseUrl: 'https://api.example.com' },
  };
  if (dynamicService) apiServices[dynamicService.serviceKey] = dynamicService;
  return {
    run: {
      runId,
      organizationId: 'org_0778',
      projectId: 'prj_0778',
      environmentId,
      status: 'QUEUED',
      executionPlanId: 'xplan_0778_12345678',
      runtimeSnapshotId: 'rts_0778_12345678',
    },
    executionPlan: {
      executionPlanId: 'xplan_0778_12345678',
      runtimeSnapshotId: 'rts_0778_12345678',
      plan: {
        scenarios: [{
          scenarioId: 'test_001',
          spec: {
            auth: referenced
              ? { requirement: 'REQUIRED', authProfileRef }
              : { requirement: 'NONE', authProfileRef: null },
          },
        }],
      },
    },
    runtimeSnapshot: {
      runtimeSnapshotId: 'rts_0778_12345678',
      snapshot: { environment: { environmentId }, apiServices, authProfiles },
    },
    latestAttempt: {
      attemptId,
      status: 'CLAIMED',
      runtimeReadinessStatus: 'READY',
      runtimePlanHash,
    },
  };
}

function activeClaim() {
  return {
    state: 'ACTIVE',
    currentAttemptId: attemptId,
    leaseTokenHash,
    leaseExpiresAt: futureIso,
  };
}

function authMaterialRequest(ref = authProfileRef) {
  return new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/auth-material`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion: RUNNER_AUTH_MATERIAL_REQUEST_CONTRACT_VERSION,
      attemptId,
      leaseToken,
      runtimePlanHash,
      authProfileRef: ref,
    }),
  });
}

// JIT API-key material is returned only by the internal lease-bound route.
// Frozen non-secret config comes from the immutable Runtime Snapshot; only current bound credentials come from Secret Vault.
{
  const secret = 'Bearer gateway-jit-secret-0778';
  let resolverArgs = null;
  const response = await postInternalRunnerAuthMaterial(authMaterialRequest(), {}, { runId }, {
    verifyRequest: async () => true,
    getBundle: async () => baseBundle(),
    getClaim: async () => activeClaim(),
    resolveRuntimeAuth: async (_env, organizationId, projectId, envId, profileId) => {
      resolverArgs = { organizationId, projectId, envId, profileId };
      return {
        authProfileId: profileId,
        profileKey: 'stg-auth',
        type: 'api_key',
        // Deliberate current-config drift: handler must ignore this and honor frozen snapshot config.
        config: { placement: 'query', name: 'wrong-current-config' },
        credentials: { apiKey: secret },
      };
    },
    now: () => nowIso,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.data.contractVersion, RUNNER_AUTH_MATERIAL_CONTRACT_VERSION);
  assert.equal(response.data.authProfileRef, authProfileRef);
  assert.equal(response.data.type, 'api_key');
  assert.deepEqual(response.data.config, { placement: 'header', name: 'Authorization', prefix: '' });
  assert.deepEqual(response.data.credentials, { apiKey: secret });
  assert.equal(response.data.target, null);
  assert.deepEqual(resolverArgs, {
    organizationId: 'org_0778', projectId: 'prj_0778', envId: environmentId, profileId: authProfileRef,
  });
}

// The requested Auth Profile must be referenced by a REQUIRED scenario in the exact Execution Plan.
{
  let resolverCalled = false;
  await assert.rejects(
    () => postInternalRunnerAuthMaterial(authMaterialRequest(), {}, { runId }, {
      verifyRequest: async () => true,
      getBundle: async () => baseBundle({ referenced: false }),
      getClaim: async () => activeClaim(),
      resolveRuntimeAuth: async () => { resolverCalled = true; return null; },
      now: () => nowIso,
    }),
    (error) => error.code === 'RUNNER_CONTROL_AUTH_PROFILE_NOT_REFERENCED',
  );
  assert.equal(resolverCalled, false);
}

// Lease token is authoritative and checked as a hash; raw lease token is never returned/persisted.
{
  await assert.rejects(
    () => postInternalRunnerAuthMaterial(authMaterialRequest(), {}, { runId }, {
      verifyRequest: async () => true,
      getBundle: async () => baseBundle(),
      getClaim: async () => ({ ...activeClaim(), leaseTokenHash: '0'.repeat(64) }),
      resolveRuntimeAuth: async () => null,
      now: () => nowIso,
    }),
    (error) => error.code === 'RUNNER_CONTROL_LEASE_NOT_ACTIVE',
  );
}

// Missing decrypted credentials fail closed before any material is returned.
{
  await assert.rejects(
    () => postInternalRunnerAuthMaterial(authMaterialRequest(), {}, { runId }, {
      verifyRequest: async () => true,
      getBundle: async () => baseBundle({ profileType: 'api_key' }),
      getClaim: async () => activeClaim(),
      resolveRuntimeAuth: async () => ({
        authProfileId: authProfileRef, profileKey: 'stg-auth', type: 'api_key', config: {}, credentials: null,
      }),
      now: () => nowIso,
    }),
    (error) => error.code === 'RUNNER_CONTROL_AUTH_CREDENTIALS_UNAVAILABLE',
  );
}

// Profile type drift since snapshot is fail-closed, even if a current Secret can be resolved.
{
  await assert.rejects(
    () => postInternalRunnerAuthMaterial(authMaterialRequest(), {}, { runId }, {
      verifyRequest: async () => true,
      getBundle: async () => baseBundle({ profileType: 'api_key' }),
      getClaim: async () => activeClaim(),
      resolveRuntimeAuth: async () => ({
        authProfileId: authProfileRef, profileKey: 'stg-auth', type: 'basic',
        config: {}, credentials: { username: 'qa', password: 'secret' },
      }),
      now: () => nowIso,
    }),
    (error) => error.code === 'RUNNER_CONTROL_AUTH_PROFILE_DRIFT',
  );
}

// Dynamic auth target must be frozen in the Runtime Snapshot and is returned from that snapshot,
// not from mutable current runtime resolution.
{
  const secret = 'oauth-secret-0778';
  const dynamicConfig = {
    apiServiceKey: 'auth-api', path: '/oauth/token', method: 'POST', clientAuthentication: 'body',
    scope: 'read', audience: null, tokenJsonPath: 'access_token', expiresInJsonPath: 'expires_in',
    tokenTypeJsonPath: 'token_type', targetHeader: 'Authorization',
  };
  const bundle = baseBundle({
    profileType: 'oauth2_client_credentials',
    profileConfig: dynamicConfig,
    dynamicService: {
      apiServiceId: 'svc_auth_frozen', serviceKey: 'auth-api', name: 'Auth API', baseUrl: 'https://frozen-auth.example.com',
    },
  });
  const response = await postInternalRunnerAuthMaterial(authMaterialRequest(), {}, { runId }, {
    verifyRequest: async () => true,
    getBundle: async () => bundle,
    getClaim: async () => activeClaim(),
    resolveRuntimeAuth: async () => ({
      authProfileId: authProfileRef, profileKey: 'stg-auth', type: 'oauth2_client_credentials',
      config: { ...dynamicConfig, path: '/changed' },
      target: { baseUrl: 'https://mutable-current.example.com', path: '/changed', method: 'POST' },
      credentials: { clientId: 'client-0778', clientSecret: secret },
    }),
    now: () => nowIso,
  });
  assert.deepEqual(response.data.target, {
    apiServiceKey: 'auth-api', apiServiceId: 'svc_auth_frozen',
    baseUrl: 'https://frozen-auth.example.com', path: '/oauth/token', method: 'POST',
  });
  assert.equal(response.data.credentials.clientSecret, secret);
}

// Safe Auth Runtime summary persistence contains counters/timing only.
{
  let persisted = null;
  const req = new Request(`https://api.apiqagent.com/internal/v1/runner/runs/${runId}/auth-resolved`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contractVersion: RUNNER_AUTH_RESOLVED_CONTRACT_VERSION,
      attemptId,
      leaseToken,
      runtimePlanHash,
      requiredScenarioCount: 2,
      resolvedProfileCount: 1,
      dynamicExchangeCount: 0,
      cacheHitCount: 1,
      durationMs: 7,
    }),
  });
  const response = await postInternalRunnerAuthResolved(req, {}, { runId }, {
    verifyRequest: async () => true,
    getBundle: async () => baseBundle(),
    markAuthResolved: async (_env, values) => { persisted = values; return { updated: true }; },
    now: () => nowIso,
  });
  assert.equal(response.data.authRuntimeStatus, 'COMPLETED');
  assert.equal(response.data.requiredScenarioCount, 2);
  assert.equal(response.data.resolvedProfileCount, 1);
  assert.equal(response.data.cacheHitCount, 1);
  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes(leaseToken), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'credentials'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'accessToken'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'authorization'), false);
}

// Public Run envelope exposes safe auth counters only, never runtime credentials/config values.
{
  const secretSentinel = 'must-never-appear-public-0778';
  const envelope = await getRunV1({
    env: {}, organizationId: 'org_0778', projectId: 'prj_0778', runId,
    deps: {
      getRunBundle: async () => ({
        run: {
          runId, status: 'PASSED', projectId: 'prj_0778', testDesignId: 'td_0778', testDesignVersionId: 'tdv_0778_12345678',
          testDesignVersion: 1, endpointId: 'cep_0778', environmentId, executionPlanId: 'xplan_0778_12345678',
          runtimeSnapshotId: 'rts_0778_12345678', scenarioIds: ['test_001'], scenarioCount: 1,
          createdAt: nowIso, updatedAt: nowIso,
        },
        executionPlan: {
          contractVersion: 'qagent.execution-plan.v1', executionPlanId: 'xplan_0778_12345678', runtimeSnapshotId: 'rts_0778_12345678',
          planHash: 'a'.repeat(64), scenarioCount: 1, schemaSnapshotCount: 0, createdAt: nowIso,
        },
        runtimeSnapshot: {
          contractVersion: 'qagent.runtime-snapshot.v1', runtimeSnapshotId: 'rts_0778_12345678', snapshotHash: 'b'.repeat(64),
          resolutionSource: 'EXPLICIT_CONFIG', resolutionConfidence: 'CONFIRMED', requiresExecutionConfirmation: false,
          snapshot: {
            environment: { environmentId, name: 'STG', slug: 'stg', environmentType: 'STG' },
            apiServices: { 'test-api': { baseUrl: 'https://api.example.com' } },
            authProfiles: { [authProfileRef]: { type: 'api_key', config: { prefix: secretSentinel }, credentialsConfigured: true } },
          },
          createdAt: nowIso,
        },
        dispatch: { status: 'RECEIVED', dispatchAttemptCount: 1 },
        latestAttempt: {
          attemptId, attemptNumber: 1, status: 'RECEIVED', heartbeatCount: 2,
          runtimeReadinessStatus: 'READY', runtimePlanHash,
          authRuntimeStatus: 'COMPLETED', authRequiredScenarioCount: 1, authResolvedProfileCount: 1,
          authDynamicExchangeCount: 0, authCacheHitCount: 0, authDurationMs: 3, authResolvedAt: nowIso,
          httpExecutionStatus: 'COMPLETED', httpRequestCount: 1, httpResponseCount: 1, httpNetworkErrorCount: 0,
          httpTimeoutCount: 0, httpRedirectCount: 0, httpDurationMs: 10,
          httpResponse2xxCount: 1, httpResponse3xxCount: 0, httpResponse4xxCount: 0, httpResponse5xxCount: 0,
          assertionExecutionStatus: 'COMPLETED', assertionOutcome: 'PASSED', assertionScenarioCount: 1,
          assertionScenarioPassedCount: 1, assertionScenarioFailedCount: 0, assertionScenarioNotEvaluatedCount: 0,
          assertionCount: 1, assertionPassedCount: 1, assertionFailedCount: 0, assertionNotEvaluatedCount: 0, assertionDurationMs: 0,
        },
      }),
    },
  });
  assert.equal(envelope.executionAttempt.authRuntimeStatus, 'COMPLETED');
  assert.equal(envelope.executionAttempt.authRequiredScenarioCount, 1);
  assert.equal(envelope.executionAttempt.authResolvedProfileCount, 1);
  assert.equal(envelope.executionAttempt.authDynamicExchangeCount, 0);
  assert.equal(JSON.stringify(envelope).includes(secretSentinel), false);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope.executionAttempt, 'credentials'), false);
}

assert.deepEqual(
  resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/auth-material`),
  { name: 'internalRunnerRunAuthMaterialPost', params: { runId } },
);
assert.deepEqual(
  resolveGatewayRoute('POST', `/internal/v1/runner/runs/${runId}/auth-resolved`),
  { name: 'internalRunnerRunAuthResolvedPost', params: { runId } },
);

// Migration is summary-only: Secret Vault data/auth tokens must never be persisted in the Run Control Plane.
const migration = await readFile(new URL('../migrations/0012_foundation_07_7_8_auth_runtime.sql', import.meta.url), 'utf8');
assert.match(migration, /auth_runtime_status/i);
assert.match(migration, /auth_required_scenario_count/i);
assert.match(migration, /auth_resolved_profile_count/i);
assert.match(migration, /auth_dynamic_exchange_count/i);
const migrationSqlOnly = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
assert.doesNotMatch(migrationSqlOnly, /ADD\s+COLUMN\s+[^;]*(credential|access[_-]?token|refresh[_-]?token|authorization|api[_-]?key|password|client[_-]?secret)/i);

// Auth Material default resolver is credentials-only: it must not re-resolve mutable auth target/config at execution time.
const internalRunnerSource = await readFile(new URL('../src/handlers/internalRunnerControl.js', import.meta.url), 'utf8');
assert.match(internalRunnerSource, /resolveAuthProfileCredentialsJit/);
assert.doesNotMatch(internalRunnerSource, /import\s*\{\s*resolveAuthProfileRuntimePlan\s*\}/);

// Static source guard: dynamic Auth Profile target is frozen into runtimeSnapshot.apiServices at Run creation.
const materializerSource = await readFile(new URL('../src/services/executionPlanMaterializerService.js', import.meta.url), 'utf8');
assert.match(materializerSource, /oauth2_client_credentials/);
assert.match(materializerSource, /login_http_json/);
assert.match(materializerSource, /RUN_AUTH_API_SERVICE_ENVIRONMENT_BINDING_MISSING/);
assert.match(materializerSource, /apiServices\[authServiceKey\]/);

console.log('Foundation 07.7.8 Auth Runtime Gateway Control Plane tests passed ✅');

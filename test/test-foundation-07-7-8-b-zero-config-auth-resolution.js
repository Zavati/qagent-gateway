import assert from 'node:assert/strict';
import { buildCatalogTestDesignContextV1 } from '../src/intelligence/catalogContextBuilder.js';
import { applyObservedAuthSignalBridgeV1 } from '../src/intelligence/observedAuthSignalBridge.js';
import { applySemanticGroundingGuardV1 } from '../src/intelligence/semanticGroundingGuard.js';
import { buildTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

const organizationId = 'org_0778b';
const projectId = 'prj_0778b';
const endpointId = 'cep_buggy_current_user';
const environmentId = 'env_stg';
const otherEnvironmentId = 'env_dev';
const apiOriginHost = 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com';

const endpointDetail = {
  endpointId,
  serviceId: 'csvc_buggy',
  serviceName: apiOriginHost,
  classification: 'THIRD_PARTY',
  classificationConfidence: 95,
  method: 'GET',
  normalizedPath: '/prod/users/current',
  discoveryConfidenceScore: 98,
  discoveryConfidenceLevel: 'HIGH',
  lifecycleState: 'DISCOVERED',
  observationCount: 6,
  sessionCount: 1,
  environmentCount: 1,
  successRatePct: 100,
  latencyAvgMs: 240,
  firstSeenAt: '2026-08-23T10:00:00.000Z',
  lastSeenAt: '2026-08-23T10:05:00.000Z',
  environments: [{ environmentId, observationCount: 6, successRatePct: 100, lastSeenAt: '2026-08-23T10:05:00.000Z' }],
  bindings: [{ environmentId, scheme: 'https', host: apiOriginHost, hostname: apiOriginHost, port: null }],
};

const schemas = {
  endpointId,
  tracks: [{
    schemaTrackId: 'cst_current_user_200',
    direction: 'RESPONSE',
    statusCode: 200,
    currentSchemaVersionId: 'csv_current_user_200_v1',
    currentSchemaHash: 'hash_current_user_200_v1',
    versions: [{
      schemaVersionId: 'csv_current_user_200_v1',
      schemaHash: 'hash_current_user_200_v1',
      observationCount: 6,
      firstSeenAt: '2026-08-23T10:00:00.000Z',
      schema: { type: 'object', properties: { username: { type: 'string' } } },
      contentTypes: [{ contentType: 'application/json' }],
    }],
  }],
};

const bearerEvidence = [{
  evidenceId: 'cev_buggy_auth_200',
  environmentId,
  observationSessionId: 'obs_buggy',
  scheme: 'https',
  host: apiOriginHost,
  observedAt: '2026-08-23T10:05:00.000Z',
  statusCode: 200,
  evidenceOutcomeClass: 'HTTP_2XX',
  latencyMs: 240,
  responseSchemaVersionId: 'csv_current_user_200_v1',
  authObserved: true,
  authScheme: 'BEARER',
}];

function bearerProfile(id, name = 'Token Autenticado') {
  return {
    authProfileId: id,
    profileKey: id.replace(/^authp_/, '').toLowerCase(),
    name,
    type: 'api_key',
    enabled: true,
    status: 'active',
    config: { placement: 'header', name: 'Authorization', prefix: '' },
  };
}

function binding(authProfileId, envId = environmentId) {
  return {
    authProfileId,
    environmentId: envId,
    status: 'active',
    authProfileEnabled: true,
    credentialsConfigured: true,
  };
}

function controlPlane({ profiles = [bearerProfile('authp_token')], bindings = [binding('authp_token')] } = {}) {
  return {
    environments: [
      { environmentId, name: 'STG', status: 'active' },
      { environmentId: otherEnvironmentId, name: 'DEV', status: 'active' },
    ],
    apiServices: [],
    apiBindings: [],
    authProfiles: profiles,
    authBindings: bindings,
  };
}

const modelOutput = {
  title: 'Current user autenticado',
  objective: 'Validar consulta autenticada observada.',
  assumptions: [],
  scenarios: [{
    scenarioId: 'test_001',
    title: 'Consultar usuário atual',
    objective: 'Validar status 200.',
    category: 'HAPPY_PATH',
    priority: 'HIGH',
    confidence: 'HIGH',
    grounding: {
      level: 'OBSERVED',
      rationale: ['Status 200 observado.'],
      evidenceRefs: ['cev_buggy_auth_200'],
      schemaRefs: ['csv_current_user_200_v1'],
    },
    preconditions: [],
    authRequirement: 'NONE',
    request: { pathParams: {}, query: {}, headers: {}, body: null },
    assertions: [
      { type: 'STATUS', expectedStatusCodes: [200] },
      { type: 'SCHEMA', schemaRef: 'csv_current_user_200_v1' },
    ],
    extract: [],
    automationHints: { needsData: false, reviewRequired: false, reasons: [] },
  }],
};

async function build(cp = controlPlane()) {
  return buildCatalogTestDesignContextV1({
    organizationId,
    projectId,
    endpointId,
    catalogLoader: async () => ({ endpointDetail, schemas, evidence: bearerEvidence }),
    controlPlaneLoader: async () => cp,
  });
}

// Core 07.7.8-B gate: no API Service, discovered runtime, one compatible Bearer profile in observed Environment.
const matched = await build();
assert.equal(matched.diagnostics.builderVersion, 'qagent.catalog-context-builder.v1.4');
assert.equal(matched.diagnostics.runtimeMapping.status, 'DISCOVERED');
assert.equal(matched.diagnostics.runtimeMapping.runtimeSource, 'DISCOVERED_OBSERVATION');
assert.equal(matched.diagnostics.auth.environmentScopeSource, 'OBSERVED_ENVIRONMENTS');
assert.equal(matched.diagnostics.auth.resolutionStatus, 'AUTO_MATCHED');
assert.equal(matched.diagnostics.auth.resolutionSource, 'OBSERVED_AUTH_AND_ENVIRONMENT');
assert.equal(matched.diagnostics.auth.selectedAuthProfileRef, 'authp_token');
assert.equal(matched.diagnostics.auth.selectedProfileName, 'Token Autenticado');
assert.equal(matched.context.runtime.defaultAuthProfileRef, 'authp_token');
assert.deepEqual(matched.context.runtime.availableAuthProfileRefs, ['authp_token']);

const bridged = applyObservedAuthSignalBridgeV1(
  applySemanticGroundingGuardV1(modelOutput, matched.context).output,
  matched.context,
);
const spec = buildTestSpecificationV1({
  context: matched.context,
  modelOutput: bridged.output,
  generation: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    generatedAt: '2026-08-23T10:10:00.000Z',
    contextFingerprint: matched.contextFingerprint,
  },
});
assert.equal(spec.scenarios[0].automation.readiness, 'READY');
assert.equal(spec.scenarios[0].spec.auth.requirement, 'REQUIRED');
assert.equal(spec.scenarios[0].spec.auth.authProfileRef, 'authp_token');

// A credential configured only in another Environment must never be borrowed by discovered runtime.
const wrongEnvironment = await build(controlPlane({
  profiles: [bearerProfile('authp_wrong_env')],
  bindings: [binding('authp_wrong_env', otherEnvironmentId)],
}));
assert.equal(wrongEnvironment.diagnostics.auth.resolutionStatus, 'UNAVAILABLE');
assert.equal(wrongEnvironment.diagnostics.auth.compatibleProfileCount, 0);
assert.equal(wrongEnvironment.context.runtime.defaultAuthProfileRef, null);

// Two compatible profiles are ambiguous; never pick one arbitrarily.
const ambiguous = await build(controlPlane({
  profiles: [bearerProfile('authp_a', 'Bearer A'), bearerProfile('authp_b', 'Bearer B')],
  bindings: [binding('authp_a'), binding('authp_b')],
}));
assert.equal(ambiguous.diagnostics.auth.resolutionStatus, 'AMBIGUOUS');
assert.equal(ambiguous.diagnostics.auth.candidateProfileCount, 2);
assert.equal(ambiguous.context.runtime.defaultAuthProfileRef, null);
const ambiguousSpec = buildTestSpecificationV1({
  context: ambiguous.context,
  modelOutput: applyObservedAuthSignalBridgeV1(modelOutput, ambiguous.context).output,
  generation: {
    provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-23T10:10:00.000Z', contextFingerprint: ambiguous.contextFingerprint,
  },
});
assert.equal(ambiguousSpec.scenarios[0].automation.readiness, 'NEEDS_AUTH');
assert.equal(ambiguousSpec.scenarios[0].spec.auth.authProfileRef, null);

// No credential material may enter context/diagnostics/spec.
const serialized = JSON.stringify({ context: matched.context, diagnostics: matched.diagnostics, spec });
assert.equal(serialized.includes('Bearer ey'), false);
assert.equal(serialized.includes('secretId'), false);
assert.equal(serialized.includes('apiKey'), false);

console.log('Foundation 07.7.8-B Zero-Config Auth Resolution tests passed ✅');

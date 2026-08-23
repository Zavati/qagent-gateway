import assert from 'node:assert/strict';
import { buildCatalogTestDesignContextV1 } from '../src/intelligence/catalogContextBuilder.js';
import { applyObservedAuthSignalBridgeV1 } from '../src/intelligence/observedAuthSignalBridge.js';
import { applySemanticGroundingGuardV1 } from '../src/intelligence/semanticGroundingGuard.js';
import { buildTestSpecificationV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

const organizationId = 'org_0772a_fix2';
const projectId = 'prj_0772a_fix2';
const endpointId = 'cep_settings';
const leakedToken = 'Bearer SHOULD_NEVER_REACH_CONTEXT_OR_DIAGNOSTICS';

const endpointDetail = {
  endpointId,
  serviceId: 'csvc_sestsenat',
  serviceName: 'api-sestsenat.studionmx.com',
  classification: 'FIRST_PARTY_API',
  classificationConfidence: 99,
  method: 'GET',
  normalizedPath: '/api/myself/settings',
  discoveryConfidenceScore: 98,
  discoveryConfidenceLevel: 'HIGH',
  lifecycleState: 'DISCOVERED',
  observationCount: 10,
  sessionCount: 1,
  environmentCount: 1,
  successRatePct: 100,
  latencyAvgMs: 100,
  firstSeenAt: '2026-08-21T12:00:00.000Z',
  lastSeenAt: '2026-08-21T13:00:00.000Z',
  environments: [
    { environmentId: 'env_observed', observationCount: 10, successRatePct: 100, lastSeenAt: '2026-08-21T13:00:00.000Z' },
  ],
  bindings: [
    { environmentId: 'env_observed', scheme: 'https', host: 'api-sestsenat.studionmx.com', hostname: 'api-sestsenat.studionmx.com', port: null },
  ],
};

const schemas = {
  endpointId,
  tracks: [
    {
      schemaTrackId: 'cst_settings_200',
      direction: 'RESPONSE',
      statusCode: 200,
      currentSchemaVersionId: 'csv_settings_200_v1',
      currentSchemaHash: 'hash_settings_200_v1',
      versions: [
        {
          schemaVersionId: 'csv_settings_200_v1',
          schemaHash: 'hash_settings_200_v1',
          observationCount: 10,
          firstSeenAt: '2026-08-21T12:00:00.000Z',
          schema: { type: 'object', properties: { language: { type: 'string' } } },
          contentTypes: [{ contentType: 'application/json' }],
        },
      ],
    },
  ],
};

function evidence({ id = 'cev_auth_200', authObserved = true, authScheme = 'BEARER', statusCode = 200 } = {}) {
  return {
    evidenceId: id,
    environmentId: 'env_observed',
    observationSessionId: 'obs_auth',
    host: 'api-sestsenat.studionmx.com',
    observedAt: '2026-08-21T13:00:00.000Z',
    statusCode,
    evidenceOutcomeClass: statusCode >= 400 ? 'HTTP_4XX' : 'HTTP_2XX',
    latencyMs: 100,
    requestSchemaVersionId: null,
    responseSchemaVersionId: 'csv_settings_200_v1',
    authObserved,
    authScheme,
    authorization: leakedToken,
    rawAuthorization: leakedToken,
  };
}

function controlPlaneWithProfile(profile) {
  return {
    environments: [{ environmentId: 'env_stg', name: 'Homologação', status: 'active' }],
    apiServices: [{ apiServiceId: 'svc_sestsenat', serviceKey: 'sestsenat-api', name: 'SEST SENAT API', status: 'active' }],
    apiBindings: [{ apiServiceId: 'svc_sestsenat', environmentId: 'env_stg', baseUrl: 'https://api-sestsenat.studionmx.com', status: 'active' }],
    authProfiles: profile ? [profile] : [],
    authBindings: profile ? [{
      authProfileId: profile.authProfileId,
      environmentId: 'env_stg',
      status: 'active',
      authProfileEnabled: true,
      credentialsConfigured: true,
    }] : [],
  };
}

const bearerApiKeyProfile = {
  authProfileId: 'authp_sestsenat',
  profileKey: 'sest-senat-bearer',
  type: 'api_key',
  enabled: true,
  status: 'active',
  config: { placement: 'header', name: 'Authorization', prefix: '' },
};

const baseModelOutput = {
  title: 'Settings autenticado',
  objective: 'Validar o GET observado.',
  assumptions: [],
  scenarios: [
    {
      scenarioId: 'test_001',
      title: 'Consultar settings',
      objective: 'Validar status e schema observados.',
      category: 'HAPPY_PATH',
      priority: 'HIGH',
      confidence: 'HIGH',
      grounding: {
        level: 'OBSERVED',
        rationale: ['Status 200 observado.'],
        evidenceRefs: ['cev_auth_200'],
        schemaRefs: ['csv_settings_200_v1'],
      },
      preconditions: [],
      authRequirement: 'NONE',
      request: { pathParams: {}, query: {}, headers: {}, body: null },
      assertions: [
        { type: 'STATUS', expectedStatusCodes: [200] },
        { type: 'SCHEMA', schemaRef: 'csv_settings_200_v1' },
      ],
      extract: [],
      automationHints: { needsData: false, reviewRequired: false, reasons: [] },
    },
  ],
};

async function buildContext({ evidenceItems, profile = bearerApiKeyProfile } = {}) {
  return buildCatalogTestDesignContextV1({
    organizationId,
    projectId,
    endpointId,
    catalogLoader: async () => ({ endpointDetail, schemas, evidence: evidenceItems || [evidence()] }),
    controlPlaneLoader: async () => controlPlaneWithProfile(profile),
  });
}

// Bearer observed + compatible Authorization profile => system forces REQUIRED and READY.
const bearerContext = await buildContext({});
assert.equal(bearerContext.context.runtime.authObservation.status, 'REQUIRED');
assert.equal(bearerContext.context.runtime.authObservation.scheme, 'BEARER');
assert.deepEqual(bearerContext.context.runtime.authObservation.evidenceRefs, ['cev_auth_200']);
assert.deepEqual(bearerContext.context.runtime.availableAuthProfileRefs, ['authp_sestsenat']);
assert.equal(bearerContext.context.runtime.defaultAuthProfileRef, 'authp_sestsenat');
assert.equal(bearerContext.diagnostics.auth.observationStatus, 'REQUIRED');
assert.equal(bearerContext.diagnostics.auth.observedScheme, 'BEARER');
assert.equal(bearerContext.diagnostics.auth.compatibleProfileCount, 1);

const semantic = applySemanticGroundingGuardV1(baseModelOutput, bearerContext.context);
const bridged = applyObservedAuthSignalBridgeV1(semantic.output, bearerContext.context);
assert.equal(bridged.output.scenarios[0].authRequirement, 'REQUIRED');
assert.equal(bridged.diagnostics.forcedRequiredCount, 1);
assert.equal(bridged.diagnostics.changedScenarioCount, 1);

const specification = buildTestSpecificationV1({
  context: bearerContext.context,
  modelOutput: bridged.output,
  generation: {
    provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-21T14:30:00.000Z', contextFingerprint: bearerContext.contextFingerprint,
  },
});
assert.equal(specification.summary.readyCount, 1);
assert.equal(specification.scenarios[0].automation.readiness, 'READY');
assert.equal(specification.scenarios[0].spec.auth.requirement, 'REQUIRED');
assert.equal(specification.scenarios[0].spec.auth.authProfileRef, 'authp_sestsenat');
assert.equal(specification.scenarios[0].grounding.level, 'OBSERVED', 'Observed auth signal must prevent auth-only grounding downgrade');
assert.doesNotThrow(() => validateTestSpecificationV1(specification, bearerContext.context));

// No compatible profile => auth is still REQUIRED but readiness fails closed as NEEDS_AUTH.
const basicOnlyContext = await buildContext({
  profile: { authProfileId: 'authp_basic', profileKey: 'basic', type: 'basic', enabled: true, status: 'active', config: {} },
});
assert.equal(basicOnlyContext.context.runtime.authObservation.status, 'REQUIRED');
assert.deepEqual(basicOnlyContext.context.runtime.availableAuthProfileRefs, []);
assert.equal(basicOnlyContext.context.runtime.defaultAuthProfileRef, null);
const basicBridged = applyObservedAuthSignalBridgeV1(applySemanticGroundingGuardV1(baseModelOutput, basicOnlyContext.context).output, basicOnlyContext.context);
const basicSpec = buildTestSpecificationV1({
  context: basicOnlyContext.context,
  modelOutput: basicBridged.output,
  generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-21T14:30:00.000Z', contextFingerprint: basicOnlyContext.contextFingerprint },
});
assert.equal(basicSpec.scenarios[0].spec.auth.requirement, 'REQUIRED');
assert.equal(basicSpec.scenarios[0].spec.auth.authProfileRef, null);
assert.equal(basicSpec.scenarios[0].automation.readiness, 'NEEDS_AUTH');

// Authorization Bearer must not match an X-API-Key profile.
const xApiKeyContext = await buildContext({
  profile: { authProfileId: 'authp_xkey', profileKey: 'xkey', type: 'api_key', enabled: true, status: 'active', config: { placement: 'header', name: 'X-API-Key', prefix: '' } },
});
assert.deepEqual(xApiKeyContext.context.runtime.availableAuthProfileRefs, []);
assert.equal(xApiKeyContext.diagnostics.auth.compatibleProfileCount, 0);

// Explicit UNAUTHENTICATED scenario is preserved; the bridge never silently injects credentials into it.
const unauthModel = structuredClone(baseModelOutput);
unauthModel.scenarios[0].authRequirement = 'UNAUTHENTICATED';
const unauthBridge = applyObservedAuthSignalBridgeV1(unauthModel, bearerContext.context);
assert.equal(unauthBridge.output.scenarios[0].authRequirement, 'UNAUTHENTICATED');
assert.equal(unauthBridge.diagnostics.preservedUnauthenticatedCount, 1);

// Evolved policy (07.7.8-B FIX-1): auth + no-auth successful observations prove OPTIONAL/public-capable behavior.
const mixedContext = await buildContext({ evidenceItems: [
  evidence({ id: 'cev_auth_200', authObserved: true, authScheme: 'BEARER' }),
  evidence({ id: 'cev_noauth_200', authObserved: false, authScheme: null }),
] });
assert.equal(mixedContext.context.runtime.authObservation.status, 'OPTIONAL');
assert.equal(mixedContext.context.runtime.authObservation.scheme, 'BEARER');
const mixedBridge = applyObservedAuthSignalBridgeV1(baseModelOutput, mixedContext.context);
const mixedSpec = buildTestSpecificationV1({
  context: mixedContext.context,
  modelOutput: mixedBridge.output,
  generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-21T14:30:00.000Z', contextFingerprint: mixedContext.contextFingerprint },
});
assert.equal(mixedSpec.scenarios[0].automation.readiness, 'READY');
assert.equal(mixedSpec.scenarios[0].spec.auth.requirement, 'REQUIRED');
assert.equal(mixedSpec.scenarios[0].spec.auth.authProfileRef, 'authp_sestsenat');

// Safety: upstream credential-like fields are ignored by the Context Builder and never leak into diagnostics/spec.
const safeSerialization = JSON.stringify({
  context: bearerContext.context,
  diagnostics: bearerContext.diagnostics,
  bridge: bridged.diagnostics,
  specification,
});
assert.equal(safeSerialization.includes(leakedToken), false);
assert.equal(safeSerialization.includes('rawAuthorization'), false);
assert.equal(safeSerialization.includes('authorization'), false);

console.log('Foundation 07.7.2-A FIX-2 Observed Auth Signal Bridge tests passed ✅');

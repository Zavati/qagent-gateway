import assert from 'node:assert/strict';
import { buildCatalogTestDesignContextV1 } from '../src/intelligence/catalogContextBuilder.js';
import { applyObservedAuthSignalBridgeV1 } from '../src/intelligence/observedAuthSignalBridge.js';
import { applySemanticGroundingGuardV1 } from '../src/intelligence/semanticGroundingGuard.js';
import { buildTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

const organizationId = 'org_0778b_fix1';
const projectId = 'prj_0778b_fix1';
const endpointId = 'cep_buggy_dashboard';
const environmentId = 'env_stg';
const apiOriginHost = 'k51qryqov3.execute-api.ap-southeast-2.amazonaws.com';

const endpointDetail = {
  endpointId,
  serviceId: 'csvc_buggy',
  serviceName: apiOriginHost,
  classification: 'INTEGRATION',
  classificationConfidence: 85,
  method: 'GET',
  normalizedPath: '/prod/dashboard',
  discoveryConfidenceScore: 72,
  discoveryConfidenceLevel: 'MEDIUM',
  lifecycleState: 'DISCOVERED',
  observationCount: 3,
  sessionCount: 3,
  environmentCount: 1,
  successRatePct: 100,
  latencyAvgMs: 1653,
  firstSeenAt: '2026-08-21T22:32:14.000Z',
  lastSeenAt: '2026-08-23T10:46:30.000Z',
  environments: [{ environmentId, observationCount: 3, successRatePct: 100, lastSeenAt: '2026-08-23T10:46:30.000Z' }],
  bindings: [{ environmentId, scheme: 'https', host: apiOriginHost, hostname: apiOriginHost, port: null }],
};

const schemas = {
  endpointId,
  tracks: [{
    schemaTrackId: 'cst_dashboard_200', direction: 'RESPONSE', statusCode: 200,
    currentSchemaVersionId: 'csv_dashboard_200_v1', currentSchemaHash: 'hash_dashboard',
    versions: [{
      schemaVersionId: 'csv_dashboard_200_v1', schemaHash: 'hash_dashboard', observationCount: 3,
      firstSeenAt: '2026-08-21T22:32:14.000Z',
      schema: { type: 'object', properties: { make: { type: 'object' }, model: { type: 'object' } } },
      contentTypes: [{ contentType: 'application/json' }],
    }],
  }],
};

const optionalEvidence = [
  {
    evidenceId: 'cev_dashboard_public_200', environmentId, observationSessionId: 'obs_public',
    scheme: 'https', host: apiOriginHost, observedAt: '2026-08-23T10:46:30.000Z',
    statusCode: 200, evidenceOutcomeClass: 'HTTP_2XX', latencyMs: 1481,
    responseSchemaVersionId: 'csv_dashboard_200_v1', authObserved: false, authScheme: null,
  },
  {
    evidenceId: 'cev_dashboard_bearer_200', environmentId, observationSessionId: 'obs_auth',
    scheme: 'https', host: apiOriginHost, observedAt: '2026-08-23T09:07:10.000Z',
    statusCode: 200, evidenceOutcomeClass: 'HTTP_2XX', latencyMs: 2409,
    responseSchemaVersionId: 'csv_dashboard_200_v1', authObserved: true, authScheme: 'BEARER',
  },
];

function bearerProfile(id = 'authp_token') {
  return {
    authProfileId: id, profileKey: 'token-autenticado', name: 'Token Autenticado',
    type: 'api_key', enabled: true, status: 'active',
    config: { placement: 'header', name: 'Authorization', prefix: '' },
  };
}

function controlPlane(profiles = [bearerProfile()], bindings = [{
  authProfileId: 'authp_token', environmentId, status: 'active', authProfileEnabled: true, credentialsConfigured: true,
}]) {
  return {
    environments: [{ environmentId, name: 'STG', status: 'active' }],
    apiServices: [], apiBindings: [], authProfiles: profiles, authBindings: bindings,
  };
}

async function build(evidence = optionalEvidence, cp = controlPlane()) {
  return buildCatalogTestDesignContextV1({
    organizationId, projectId, endpointId,
    catalogLoader: async () => ({ endpointDetail, schemas, evidence }),
    controlPlaneLoader: async () => cp,
  });
}

function scenario({ id, refs, category = 'HAPPY_PATH', authRequirement = 'REQUIRED', statuses = [200], title = 'Obter dashboard com sucesso' }) {
  return {
    scenarioId: id, title, objective: title, category, priority: 'HIGH', confidence: 'HIGH',
    grounding: { level: 'OBSERVED', rationale: ['Status observado.'], evidenceRefs: refs, schemaRefs: ['csv_dashboard_200_v1'] },
    preconditions: [], authRequirement,
    request: { pathParams: {}, query: {}, headers: {}, body: null },
    assertions: [
      { type: 'STATUS', expectedStatusCodes: statuses },
      ...(statuses.includes(200) ? [{ type: 'SCHEMA', schemaRef: 'csv_dashboard_200_v1' }] : []),
    ],
    extract: [], automationHints: { needsData: false, reviewRequired: false, reasons: [] },
  };
}

function specFrom(contextResult, scenarios) {
  const model = { title: 'Dashboard', objective: 'Validar dashboard.', assumptions: [], scenarios };
  const guarded = applySemanticGroundingGuardV1(model, contextResult.context).output;
  const bridged = applyObservedAuthSignalBridgeV1(guarded, contextResult.context);
  const spec = buildTestSpecificationV1({
    context: contextResult.context, modelOutput: bridged.output,
    generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-23T13:00:00.000Z', contextFingerprint: contextResult.contextFingerprint },
  });
  return { spec, bridged };
}

// Public 2xx + authenticated 2xx means OPTIONAL, not unresolved MIXED.
const optional = await build();
assert.equal(optional.diagnostics.builderVersion, 'qagent.catalog-context-builder.v1.6');
assert.equal(optional.diagnostics.auth.observationStatus, 'OPTIONAL');
assert.equal(optional.diagnostics.auth.observedScheme, 'BEARER');
assert.equal(optional.diagnostics.auth.authenticatedSuccessCount, 1);
assert.equal(optional.diagnostics.auth.unauthenticatedSuccessCount, 1);
assert.equal(optional.diagnostics.auth.unauthenticatedAuthErrorCount, 0);
assert.equal(optional.diagnostics.auth.resolutionStatus, 'OPTIONAL_AUTO_MATCHED');
assert.equal(optional.diagnostics.auth.resolutionSource, 'OBSERVED_OPTIONAL_AUTH_AND_ENVIRONMENT');
assert.equal(optional.context.runtime.defaultAuthProfileRef, 'authp_token');

// A happy path grounded by public success must prefer NONE even when AI/profile says REQUIRED.
const publicResult = specFrom(optional, [scenario({ id: 'test_public', refs: ['cev_dashboard_public_200'], authRequirement: 'REQUIRED' })]);
assert.equal(publicResult.bridged.diagnostics.bridgeVersion, 'qagent.observed-auth-signal-bridge.v1.1');
assert.equal(publicResult.bridged.diagnostics.optionalPublicScenarioCount, 1);
assert.equal(publicResult.spec.scenarios[0].spec.auth.requirement, 'NONE');
assert.equal(publicResult.spec.scenarios[0].spec.auth.authProfileRef, null);
assert.equal(publicResult.spec.scenarios[0].automation.readiness, 'READY');
assert.equal(publicResult.spec.scenarios[0].automation.blockers.length, 0);

// A scenario grounded only by authenticated successful evidence can use the unique compatible profile.
const authenticatedResult = specFrom(optional, [scenario({ id: 'test_auth', refs: ['cev_dashboard_bearer_200'], authRequirement: 'NONE' })]);
assert.equal(authenticatedResult.bridged.diagnostics.optionalAuthenticatedScenarioCount, 1);
assert.equal(authenticatedResult.spec.scenarios[0].spec.auth.requirement, 'REQUIRED');
assert.equal(authenticatedResult.spec.scenarios[0].spec.auth.authProfileRef, 'authp_token');
assert.equal(authenticatedResult.spec.scenarios[0].automation.readiness, 'READY');

// Explicit unobserved 401 remains review; OPTIONAL must not fabricate auth rejection semantics.
const negativeModel = {
  title: 'Dashboard auth', objective: 'Auth negative.', assumptions: [],
  scenarios: [scenario({
    id: 'test_401', refs: ['cev_dashboard_public_200'], category: 'AUTHORIZATION',
    authRequirement: 'UNAUTHENTICATED', statuses: [401], title: 'Verificar resposta sem autenticação',
  })],
};
const negativeGuarded = applySemanticGroundingGuardV1(negativeModel, optional.context);
const negativeBridged = applyObservedAuthSignalBridgeV1(negativeGuarded.output, optional.context);
const negativeSpec = buildTestSpecificationV1({
  context: optional.context, modelOutput: negativeBridged.output,
  generation: { provider: 'openai', model: 'gpt-4o-mini', generatedAt: '2026-08-23T13:00:00.000Z', contextFingerprint: optional.contextFingerprint },
});
assert.equal(negativeSpec.scenarios[0].automation.readiness, 'REVIEW_REQUIRED');

// Auth success + unauthenticated 401/403 is stronger evidence of REQUIRED, not MIXED.
const requiredEvidence = [
  optionalEvidence[1],
  { ...optionalEvidence[0], evidenceId: 'cev_dashboard_public_401', statusCode: 401, evidenceOutcomeClass: 'HTTP_4XX' },
];
const required = await build(requiredEvidence);
assert.equal(required.diagnostics.auth.observationStatus, 'REQUIRED');
assert.equal(required.diagnostics.auth.unauthenticatedSuccessCount, 0);
assert.equal(required.diagnostics.auth.unauthenticatedAuthErrorCount, 1);
assert.equal(required.diagnostics.auth.resolutionStatus, 'AUTO_MATCHED');

// Truly unresolved mixed evidence remains fail-closed REVIEW_REQUIRED.
const unresolvedEvidence = [
  optionalEvidence[1],
  { ...optionalEvidence[0], evidenceId: 'cev_dashboard_public_unknown', statusCode: null, evidenceOutcomeClass: 'NO_STATUS' },
];
const unresolved = await build(unresolvedEvidence);
assert.equal(unresolved.diagnostics.auth.observationStatus, 'MIXED');
assert.equal(unresolved.diagnostics.auth.resolutionStatus, 'REVIEW_REQUIRED');
const unresolvedResult = specFrom(unresolved, [scenario({ id: 'test_mixed', refs: ['cev_dashboard_bearer_200'], authRequirement: 'REQUIRED' })]);
assert.equal(unresolvedResult.spec.scenarios[0].automation.readiness, 'REVIEW_REQUIRED');

// Optional public path must remain executable even when no Auth Profile exists.
const noProfile = await build(optionalEvidence, controlPlane([], []));
assert.equal(noProfile.diagnostics.auth.observationStatus, 'OPTIONAL');
assert.equal(noProfile.diagnostics.auth.resolutionStatus, 'OPTIONAL_NO_PROFILE');
const noProfilePublic = specFrom(noProfile, [scenario({ id: 'test_public_no_profile', refs: ['cev_dashboard_public_200'], authRequirement: 'REQUIRED' })]);
assert.equal(noProfilePublic.spec.scenarios[0].spec.auth.requirement, 'NONE');
assert.equal(noProfilePublic.spec.scenarios[0].automation.readiness, 'READY');

// No secret material in context/diagnostics/spec.
const serialized = JSON.stringify({ context: optional.context, diagnostics: optional.diagnostics, spec: publicResult.spec });
assert.equal(serialized.includes('Bearer ey'), false);
assert.equal(serialized.includes('secretId'), false);
assert.equal(serialized.includes('apiKey'), false);

console.log('Foundation 07.7.8-B FIX-1 Mixed Auth Evidence Resolution tests passed ✅');

import assert from 'node:assert/strict';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
import {
  buildCatalogTestDesignContextV1,
  CATALOG_CONTEXT_BUILDER_VERSION,
} from '../src/intelligence/catalogContextBuilder.js';
import { validateCatalogTestDesignContextV1 } from '../src/intelligence/testDesignContract.js';
import {
  getCatalogEndpointForTestDesign,
  getCatalogSchemasForTestDesign,
  getCatalogEvidenceForTestDesign,
} from '../src/intelligence/catalogKnowledgeClient.js';

const organizationId = 'org_0762';
const projectId = 'prj_0762';
const endpointId = 'cep_checkout_create';

const endpointDetail = {
  endpointId,
  serviceId: 'csvc_checkout',
  serviceName: 'checkout-api',
  classification: 'FIRST_PARTY_API',
  classificationConfidence: 96,
  method: 'POST',
  normalizedPath: '/core-api/orders',
  discoveryConfidenceScore: 91,
  discoveryConfidenceLevel: 'HIGH',
  lifecycleState: 'DISCOVERED',
  observationCount: 120,
  sessionCount: 8,
  environmentCount: 2,
  successRatePct: 94.2,
  latencyAvgMs: 183,
  firstSeenAt: '2026-08-16T10:00:00.000Z',
  lastSeenAt: '2026-08-17T10:00:00.000Z',
  environments: [
    { environmentId: 'env_dev', observationCount: 40, successRatePct: 95, lastSeenAt: '2026-08-17T09:00:00.000Z' },
    { environmentId: 'env_stg', observationCount: 80, successRatePct: 93.8, lastSeenAt: '2026-08-17T10:00:00.000Z' },
  ],
  bindings: [
    { environmentId: 'env_dev', scheme: 'https', host: 'api-dev.example.com', hostname: 'api-dev.example.com', port: null },
    { environmentId: 'env_stg', scheme: 'https', host: 'api-stg.example.com', hostname: 'api-stg.example.com', port: null },
  ],
};

const schemas = {
  endpointId,
  versionsPerTrack: 8,
  tracks: [
    {
      schemaTrackId: 'track_req',
      direction: 'REQUEST',
      statusCode: null,
      currentSchemaVersionId: 'sv_req_2',
      currentSchemaHash: 'hash_req_2',
      versions: [
        {
          schemaVersionId: 'sv_req_2', schemaHash: 'hash_req_2', observationCount: 80,
          firstSeenAt: '2026-08-17T08:00:00.000Z',
          schema: { type: 'object', properties: { cartId: { type: 'string' }, items: { type: 'array' } }, required: ['cartId'] },
          contentTypes: [{ contentType: 'application/json' }],
        },
        {
          schemaVersionId: 'sv_req_1', schemaHash: 'hash_req_1', observationCount: 40,
          firstSeenAt: '2026-08-16T10:00:00.000Z', schema: { type: 'object' }, contentTypes: [{ contentType: 'application/json' }],
        },
      ],
    },
    {
      schemaTrackId: 'track_res_201',
      direction: 'RESPONSE',
      statusCode: 201,
      currentSchemaVersionId: 'sv_res_201_1',
      currentSchemaHash: 'hash_res_201_1',
      versions: [
        {
          schemaVersionId: 'sv_res_201_1', schemaHash: 'hash_res_201_1', observationCount: 110,
          firstSeenAt: '2026-08-16T10:00:00.000Z',
          schema: { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string' } } },
          contentTypes: [{ contentType: 'application/json' }],
        },
      ],
    },
  ],
};

const evidence = Array.from({ length: 30 }, (_, index) => ({
  evidenceId: `ev_${String(index + 1).padStart(2, '0')}`,
  environmentId: index % 2 === 0 ? 'env_stg' : 'env_dev',
  observationSessionId: `obs_${index % 5}`,
  host: index % 2 === 0 ? 'api-stg.example.com' : 'api-dev.example.com',
  observedAt: new Date(Date.parse('2026-08-17T10:00:00.000Z') - index * 60_000).toISOString(),
  statusCode: index % 7 === 0 ? 400 : 201,
  evidenceOutcomeClass: index % 7 === 0 ? 'HTTP_4XX' : 'HTTP_2XX',
  latencyMs: 100 + index,
  requestSchemaVersionId: index < 15 ? 'sv_req_2' : 'sv_req_1',
  responseSchemaVersionId: index % 7 === 0 ? null : 'sv_res_201_1',
  // These Catalog fields must not leak into Test Design Context.
  batchId: `batch_${index}`,
  eventId: `event_${index}`,
  normalizedEventId: `norm_${index}`,
  requestContentType: 'application/json',
}));

const controlPlane = {
  environments: [
    { environmentId: 'env_dev', name: 'DEV', status: 'active' },
    { environmentId: 'env_stg', name: 'STG', status: 'active' },
  ],
  apiServices: [
    { apiServiceId: 'svc_checkout', serviceKey: 'checkout', name: 'Checkout', status: 'active' },
    { apiServiceId: 'svc_identity', serviceKey: 'identity', name: 'Identity', status: 'active' },
  ],
  apiBindings: [
    { apiServiceId: 'svc_checkout', environmentId: 'env_dev', baseUrl: 'https://api-dev.example.com' },
    { apiServiceId: 'svc_checkout', environmentId: 'env_stg', baseUrl: 'https://api-stg.example.com/' },
    { apiServiceId: 'svc_identity', environmentId: 'env_dev', baseUrl: 'https://identity-dev.example.com' },
    { apiServiceId: 'svc_identity', environmentId: 'env_stg', baseUrl: 'https://identity-stg.example.com' },
  ],
  authProfiles: [
    { authProfileId: 'authp_customer', type: 'basic', enabled: true, status: 'active' },
    { authProfileId: 'authp_partial', type: 'api_key', enabled: true, status: 'active' },
    { authProfileId: 'authp_none', type: 'none', enabled: true, status: 'active' },
  ],
  authBindings: [
    { authProfileId: 'authp_customer', environmentId: 'env_dev', status: 'active', authProfileEnabled: true, credentialsConfigured: true },
    { authProfileId: 'authp_customer', environmentId: 'env_stg', status: 'active', authProfileEnabled: true, credentialsConfigured: true },
    { authProfileId: 'authp_partial', environmentId: 'env_stg', status: 'active', authProfileEnabled: true, credentialsConfigured: true },
    { authProfileId: 'authp_none', environmentId: 'env_dev', status: 'active', authProfileEnabled: true, credentialsConfigured: false },
    { authProfileId: 'authp_none', environmentId: 'env_stg', status: 'active', authProfileEnabled: true, credentialsConfigured: false },
  ],
};

const catalogLoader = async () => ({ endpointDetail, schemas, evidence });
const controlPlaneLoader = async () => controlPlane;

const result = await buildCatalogTestDesignContextV1({
  organizationId,
  projectId,
  endpointId,
  catalogLoader,
  controlPlaneLoader,
});

assert.equal(result.diagnostics.builderVersion, CATALOG_CONTEXT_BUILDER_VERSION);
assert.match(result.contextFingerprint, /^[0-9a-f]{64}$/);
assert.equal(result.context.contractVersion, 'qagent.test-design.v1');
assert.equal(result.context.endpoint.endpointId, endpointId);
assert.equal(result.context.endpoint.method, 'POST');
assert.equal(result.context.runtime.apiServiceKey, 'checkout');
assert.deepEqual(result.context.runtime.availableAuthProfileRefs, ['authp_customer']);
assert.equal(result.context.runtime.defaultAuthProfileRef, 'authp_customer');
assert.equal(result.diagnostics.runtimeMapping.status, 'MATCHED');
assert.equal(result.context.environments.find((item) => item.environmentId === 'env_stg')?.name, 'STG');
assert.equal(result.context.schemas.length, 2);
assert.deepEqual(result.context.schemas[0].contentTypes, ['application/json']);
assert.equal(result.context.schemas[0].currentVersionId, 'sv_req_2');
assert.equal(result.context.schemas[0].schema.properties.cartId.type, 'string');
assert.equal(result.context.evidence.length, 24);
assert.equal(Object.hasOwn(result.context.evidence[0], 'batchId'), false);
assert.equal(Object.hasOwn(result.context.evidence[0], 'requestContentType'), false);
assert.doesNotThrow(() => validateCatalogTestDesignContextV1(result.context));

const deterministic = await buildCatalogTestDesignContextV1({ organizationId, projectId, endpointId, catalogLoader, controlPlaneLoader });
assert.equal(deterministic.contextFingerprint, result.contextFingerprint, 'same source context must produce same fingerprint');

const ambiguousControlPlane = structuredClone(controlPlane);
ambiguousControlPlane.apiServices.push({ apiServiceId: 'svc_duplicate', serviceKey: 'duplicate', status: 'active' });
ambiguousControlPlane.apiBindings.push(
  { apiServiceId: 'svc_duplicate', environmentId: 'env_dev', baseUrl: 'https://api-dev.example.com' },
  { apiServiceId: 'svc_duplicate', environmentId: 'env_stg', baseUrl: 'https://api-stg.example.com' },
);
const ambiguous = await buildCatalogTestDesignContextV1({
  organizationId, projectId, endpointId, catalogLoader,
  controlPlaneLoader: async () => ambiguousControlPlane,
});
assert.equal(ambiguous.context.runtime.apiServiceKey, null);
assert.equal(ambiguous.diagnostics.runtimeMapping.status, 'AMBIGUOUS');

const partialControlPlane = structuredClone(controlPlane);
partialControlPlane.apiBindings = partialControlPlane.apiBindings.filter((binding) => !(binding.apiServiceId === 'svc_checkout' && binding.environmentId === 'env_dev'));
const partial = await buildCatalogTestDesignContextV1({
  organizationId, projectId, endpointId, catalogLoader,
  controlPlaneLoader: async () => partialControlPlane,
});
assert.equal(partial.context.runtime.apiServiceKey, null);
assert.equal(partial.diagnostics.runtimeMapping.status, 'PARTIAL');

const tooWideSchema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`field_${index}`, { type: 'string' }])) };
const oversizedSchemas = structuredClone(schemas);
oversizedSchemas.tracks[0].versions[0].schema = tooWideSchema;
const omitted = await buildCatalogTestDesignContextV1({
  organizationId, projectId, endpointId,
  catalogLoader: async () => ({ endpointDetail, schemas: oversizedSchemas, evidence }),
  controlPlaneLoader,
});
assert.equal(Object.hasOwn(omitted.context.schemas[0], 'schema'), false, 'unsafe structural schema is omitted, never truncated into a false contract');
assert.equal(omitted.diagnostics.schemas.structuralSchemasOmitted, 1);

await assert.rejects(
  () => buildCatalogTestDesignContextV1({
    organizationId, projectId, endpointId,
    catalogLoader: async () => ({ endpointDetail: { ...endpointDetail, endpointId: 'cep_other' }, schemas, evidence }),
    controlPlaneLoader,
  }),
  (error) => error?.code === 'TEST_DESIGN_CONTEXT_ENDPOINT_MISMATCH',
);

const route = resolveGatewayRoute('GET', `/v1/console/projects/${projectId}/intelligence/endpoints/${endpointId}/test-design-context`);
assert.equal(route?.name, 'consoleIntelligenceTestDesignContextGet');
assert.deepEqual(route?.params, { projectId, endpointId });
assert.equal(resolveGatewayRoute('POST', `/v1/console/projects/${projectId}/intelligence/endpoints/${endpointId}/test-design-context`), null);

// Verify the internal knowledge client preserves the existing signed Service Binding boundary.
const secret = '0123456789abcdef0123456789abcdef';
const captured = [];
const env = {
  ENVIRONMENT: 'development',
  CATALOG_QUERY_BASE_URL: 'https://api.apiqagent.com',
  CATALOG_QUERY_HMAC_SECRET: secret,
  CATALOG_QUERY_SERVICE: {
    fetch: async (request) => {
      captured.push(request);
      const url = new URL(request.url);
      if (url.pathname.endsWith('/schemas')) {
        return new Response(JSON.stringify({ status: 'ok', data: schemas }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname.endsWith('/evidence')) {
        return new Response(JSON.stringify({ status: 'ok', data: evidence.slice(0, 3), page: { limit: 3, nextCursor: null, hasMore: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ status: 'ok', data: endpointDetail }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  },
};
const detailFromClient = await getCatalogEndpointForTestDesign({ env, organizationId, projectId, endpointId });
const schemasFromClient = await getCatalogSchemasForTestDesign({ env, organizationId, projectId, endpointId, versionsPerTrack: 8 });
const evidenceFromClient = await getCatalogEvidenceForTestDesign({ env, organizationId, projectId, endpointId, limit: 3 });
assert.equal(detailFromClient.endpointId, endpointId);
assert.equal(schemasFromClient.tracks.length, 2);
assert.equal(evidenceFromClient.length, 3);
assert.equal(captured.length, 3);
for (const request of captured) {
  assert.equal(request.headers.get('X-QAgent-Organization-Id'), organizationId);
  assert.equal(request.headers.get('X-QAgent-Project-Id'), projectId);
  assert.match(request.headers.get('X-QAgent-Query-Signature'), /^[0-9a-f]{64}$/);
}
assert.equal(new URL(captured[1].url).searchParams.get('versionsPerTrack'), '8');
assert.equal(new URL(captured[2].url).searchParams.get('limit'), '3');

console.log('Foundation 07.6.2 Catalog Context Builder tests passed ✅');

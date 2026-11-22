import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import { consoleUiTestDesign, internalUiTestDesign } from '../src/handlers/uiTestDesign.js';
import { requestUiDesignService, assertUiCompilation, canonicalUiJson, normalizeUiProfile, UI_DEFAULT_PROFILE,
  UI_COMPILER_VERSION, readUiText, uiError, uiId } from '../src/services/uiTestDesignClient.js';
import { buildTestGenerationInternalHeaders, verifyTestGenerationInternalRequest } from '../src/security/testGenerationInternalAuth.js';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';

const compilation = JSON.parse(readFileSync(new URL('./fixtures/ui-test-design-compilation.v1.json', import.meta.url), 'utf8'));
const scope = compilation.source.scope;
const env = { TEST_GENERATION_INTERNAL_HMAC_SECRET: 'test-generation-fixture-secret-32-bytes', UI_TEST_DESIGN_SECRET: 'ui-design-fixture-secret-at-least-32-bytes' };
const path = `/v1/console/projects/${scope.projectId}/environments/${scope.environmentId}/ui-test-design`;
function product(resource, method = 'GET', body, id = null, action = null, query = '') {
  return [new Request(`https://gateway.invalid${path}/${resource}${id ? '/' + id : ''}${action ? '/' + action : ''}${query}`, {
    method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  }), env, { ...scope, resource, id, action }];
}
function dependencies(overrides = {}) {
  return { tenant: async () => ({ organizationId: scope.organizationId, organizationRole: 'member', user: { userId: 'usr_fixture' }, accountId: 'acct_fixture' }),
    environment: async (_env, organizationId, projectId, environmentId) => {
      assert.deepEqual({ organizationId, projectId, environmentId }, scope); return { environmentId, status: 'active' };
    }, organization: async () => ({ status: 'active' }), ...overrides };
}
const callbackBody = (action = 'compile') => ({ ...scope, jobId: 'uitdj_fixture', jobItemId: 'uitdi_fixture', generationRequestId: 'uitdg_uitdi_fixture',
  ...(action === 'compile' ? { bundleVersionId: compilation.source.bundleVersionId, compilerVersion: UI_COMPILER_VERSION, profile: {} } : { compilation: structuredClone(compilation) }) });
async function internal(body, action = 'compile', signerScope = scope) {
  const url = `https://gateway.invalid/internal/v1/ui-test-design/${action}`, rawBody = JSON.stringify(body);
  const headers = await buildTestGenerationInternalHeaders({ env, method: 'POST', url, ...signerScope, rawBody });
  return [new Request(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: rawBody }), env, { action }];
}
const receipt = () => ({ status: 'persisted', domain: 'UI', testDesignId: 'uitd_fixture', testDesignVersionId: 'uitdv_fixture', version: 1, contentHash: compilation.specificationHash });
const storedVersion = () => ({ ...receipt(), source: compilation.source, compilation });

test('UI routes are method constrained and existing API generation routing is unchanged', () => {
  for (const [method, suffix, resource, id, action] of [['GET', 'sources', 'sources', null, null], ['POST', 'jobs', 'jobs', null, null],
    ['GET', 'jobs/uitdj_fixture/items', 'jobs', 'uitdj_fixture', 'items'], ['POST', 'jobs/uitdj_fixture/cancel', 'jobs', 'uitdj_fixture', 'cancel'],
    ['GET', 'designs/uitdv_fixture', 'designs', 'uitdv_fixture', null]]) {
    assert.deepEqual(resolveGatewayRoute(method, path + '/' + suffix), { name: 'consoleUiTestDesign', params: { projectId: scope.projectId, environmentId: scope.environmentId, resource, id, action } });
  }
  for (const [method, suffix] of [['POST', 'sources'], ['DELETE', 'jobs'], ['GET', 'jobs/a/cancel'], ['POST', 'designs/a']]) assert.equal(resolveGatewayRoute(method, path + '/' + suffix), null);
  assert.equal(resolveGatewayRoute('POST', '/internal/v1/ui-test-design/compile').name, 'internalUiTestDesign');
  assert.equal(resolveGatewayRoute('GET', '/internal/v1/ui-test-design/compile'), null);
  assert.equal(resolveGatewayRoute('POST', `/v1/console/projects/${scope.projectId}/test-design-generation-jobs`).name, 'consoleProjectTestDesignGenerationJobCreate');
});

test('Console source reads derive authority from session and validate environment', async () => {
  const calls = [], deps = dependencies({ request: async args => { calls.push(args); return { items: [], nextCursor: null }; } });
  const result = await consoleUiTestDesign(...product('sources', 'GET', undefined, null, null, '?organizationId=org_other&limit=50'), deps);
  assert.equal(result.status, 'ok'); assert.deepEqual(calls[0].scope, scope); assert.deepEqual(calls[0].body, { scope, limit: 50 });
  assert.equal(calls[0].service, 'ui');
});

test('batch admission is bounded, keeps operation identity, and never needs AI credentials', async () => {
  const calls = [], deps = dependencies({ request: async args => { calls.push(args); return { jobId: 'uitdj_fixture', reused: false }; } });
  const body = { operationId: 'uitdop_fixture', bundleVersionIds: [compilation.source.bundleVersionId] };
  await consoleUiTestDesign(...product('jobs', 'POST', body), deps);
  assert.equal(calls[0].service, 'orchestrator'); assert.deepEqual(calls[0].body.profile, UI_DEFAULT_PROFILE);
  assert.equal(calls[0].body.operationId, body.operationId); assert.equal(calls[0].body.createdBy, 'usr_fixture');
  for (const invalid of [{ ...body, organizationId: 'org_other' }, { ...body, bundleVersionIds: [] },
    { ...body, bundleVersionIds: Array.from({ length: 51 }, (_, i) => 'urbv_' + i) }, { ...body, bundleVersionIds: ['urbv_x', 'urbv_x'] },
    { ...body, profile: { provider: 'invented' } }]) {
    await assert.rejects(consoleUiTestDesign(...product('jobs', 'POST', invalid), deps), e => e.status === 400);
  }
  assert.equal(calls.length, 1);
});

test('viewer cannot create/cancel and inaccessible environment is rejected before upstream', async () => {
  let calls = 0; const deps = dependencies({ tenant: async () => ({ organizationId: scope.organizationId, organizationRole: 'viewer' }), request: async () => { calls++; } });
  await assert.rejects(consoleUiTestDesign(...product('jobs', 'POST', {}), deps), e => e.code === 'UI_TEST_DESIGN_READ_ONLY');
  await assert.rejects(consoleUiTestDesign(...product('jobs', 'POST', {}, 'uitdj_fixture', 'cancel'), deps), e => e.code === 'UI_TEST_DESIGN_READ_ONLY');
  await assert.rejects(consoleUiTestDesign(...product('sources'), dependencies({ environment: async () => { throw uiError('ENVIRONMENT_NOT_FOUND', 404); }, request: deps.request })), e => e.status === 404);
  assert.equal(calls, 0);
});

test('job and design reads preserve scope with only query fields accepted by each service', async () => {
  const calls = [], deps = dependencies({ request: async args => { calls.push(args); return args.service === 'registry' ? { domain: 'UI', scope, items: [], nextCursor: null } : { items: [] }; } });
  await consoleUiTestDesign(...product('jobs', 'GET', undefined, 'uitdj_fixture', 'items', '?limit=50&cursor=next'), deps);
  await consoleUiTestDesign(...product('designs'), deps);
  for (const call of calls) { const q = new URL(call.path, 'https://fixture.invalid').searchParams;
    assert.deepEqual(call.scope, scope); assert.equal(q.get('organizationId'), scope.organizationId); assert.equal(q.get('environmentId'), scope.environmentId);
    if (call.service === 'registry') { assert.equal(q.has('projectId'), false); assert.ok(call.path.includes('/projects/' + scope.projectId + '/')); }
    else assert.equal(q.get('projectId'), scope.projectId);
  }
  await assert.rejects(consoleUiTestDesign(...product('sources', 'GET', undefined, null, null, '?limit=51'), deps), e => e.code === 'UI_TEST_DESIGN_PAGINATION_INVALID');
});

test('Gateway signs UI requests with the distinct test-design principal and exact body digest', async () => {
  let seen;
  const ui = { ...env, UI_SERVICE: { fetch: async request => {
    seen = request; const raw = await request.text(), timestamp = request.headers.get('X-QAgent-Bundle-Time');
    const bodyHash = createHash('sha256').update(raw).digest('hex');
    const payload = `QAGENT_UI_BUNDLE_HTTP_V1\ntest-design\nPOST\n/internal/ui/v1/test-design/compile\n${timestamp}\n${bodyHash}`;
    assert.equal(request.headers.get('X-QAgent-Bundle-Signature'), createHmac('sha256', env.UI_TEST_DESIGN_SECRET).update(payload).digest('hex'));
    assert.equal(request.headers.get('X-QAgent-Bundle-Principal'), 'test-design');
    assert.equal(request.redirect, 'manual'); return Response.json(compilation);
  } } };
  const result = await requestUiDesignService({ env: ui, service: 'ui', scope, path: '/internal/ui/v1/test-design/compile', method: 'POST', body: { scope } });
  assert.equal(new URL(seen.url).host, 'qagent-ui.internal'); assert.deepEqual(result, compilation);
  await assert.rejects(requestUiDesignService({ env: {}, service: 'ui', scope, path: '/sources' }), e => e.code === 'UI_TEST_DESIGN_NOT_CONFIGURED');
});

test('Registry and Orchestrator requests retain the existing internal HMAC wire', async () => {
  const bound = { ...env, TEST_REGISTRY_SERVICE: { fetch: async request => {
    const rawBody = await request.text(), auth = await verifyTestGenerationInternalRequest(request, env, { rawBody });
    assert.equal(auth.organizationId, scope.organizationId); assert.equal(auth.projectId, scope.projectId); return Response.json(receipt());
  } }, TEST_GENERATION_ORCHESTRATOR_SERVICE: { fetch: async request => {
    await verifyTestGenerationInternalRequest(request, env, { rawBody: '' }); return Response.json({ status: 'ok', data: { jobId: 'uitdj_fixture' } });
  } } };
  assert.equal((await requestUiDesignService({ env: bound, service: 'registry', scope, path: '/v1/test-registry/ui-test-designs/versions', method: 'POST', body: {} })).status, 'persisted');
  assert.equal((await requestUiDesignService({ env: bound, service: 'orchestrator', scope, path: '/v1/test-design-generation/ui-jobs/a' })).jobId, 'uitdj_fixture');
});

test('callback authenticates raw bytes, then checks tenant, environment and deterministic compilation hash', async () => {
  const args = await internal(callbackBody()), calls = [];
  const result = await internalUiTestDesign(...args, dependencies({ request: async input => { calls.push(input); return compilation; } }));
  assert.deepEqual(result.data, compilation); assert.deepEqual(calls[0].body.profile, UI_DEFAULT_PROFILE);
  const crossed = await internal(callbackBody(), 'compile', { ...scope, organizationId: 'org_other' });
  await assert.rejects(internalUiTestDesign(...crossed, dependencies()), e => e.code === 'UI_TEST_DESIGN_SCOPE_MISMATCH');
  await assert.rejects(internalUiTestDesign(new Request(args[0].url, { method: 'POST', body: '{invalid' }), env, { action: 'compile' }, dependencies()), e => e.code === 'PROJECT_TEST_GENERATION_UNAUTHORIZED');
  const damaged = structuredClone(compilation); damaged.specification.entryUrl = 'https://changed.invalid';
  await assert.rejects(internalUiTestDesign(...await internal(callbackBody()), dependencies({ request: async () => damaged })), e => e.code === 'UI_TEST_DESIGN_HASH_MISMATCH');
});

test('publish rechecks source access and forwards the same immutable candidate and operation key', async () => {
  const calls = [], deps = dependencies({ source: async (...args) => { calls.push(['source', args]); return { source: compilation.source }; },
    request: async args => { calls.push(['publish', args]); return receipt(); } });
  const result = await internalUiTestDesign(...await internal(callbackBody('publish'), 'publish'), deps);
  assert.equal(result.data.status, 'persisted'); assert.equal(calls[0][0], 'source'); assert.equal(calls[1][0], 'publish');
  assert.deepEqual(calls[1][1].body.compilation, compilation); assert.equal(calls[1][1].body.generationRequestId, 'uitdg_uitdi_fixture');
  assert.equal(calls[0][1][3], compilation.source.manifestHash);
});

test('revoked or changed source prevents publication and full design reads', async () => {
  let writes = 0;
  await assert.rejects(internalUiTestDesign(...await internal(callbackBody('publish'), 'publish'), dependencies({
    source: async () => { throw uiError('UI_BUNDLE_ACCESS_REVOKED', 410); }, request: async () => { writes++; }
  })), e => e.code === 'UI_BUNDLE_ACCESS_REVOKED');
  await assert.rejects(internalUiTestDesign(...await internal(callbackBody('publish'), 'publish'), dependencies({
    source: async () => ({ source: { ...compilation.source, sourceHash: 'f'.repeat(64) } }), request: async () => { writes++; }
  })), e => e.code === 'UI_TEST_DESIGN_SOURCE_MISMATCH');
  await assert.rejects(consoleUiTestDesign(...product('designs', 'GET', undefined, 'uitdv_fixture'), dependencies({
    request: async () => storedVersion(), source: async () => { throw uiError('UI_BUNDLE_ACCESS_REVOKED', 410); }
  })), e => e.code === 'UI_BUNDLE_ACCESS_REVOKED');
  assert.equal(writes, 0);
});

test('full design read validates hash and source receipt and bad registry receipt cannot report success', async () => {
  const read = await consoleUiTestDesign(...product('designs', 'GET', undefined, 'uitdv_fixture'), dependencies({ request: async () => storedVersion(), source: async () => ({ source: compilation.source }) }));
  assert.deepEqual(read.data.compilation, compilation);
  await assert.rejects(internalUiTestDesign(...await internal(callbackBody('publish'), 'publish'), dependencies({ source: async () => ({ source: compilation.source }), request: async () => ({ ...receipt(), contentHash: 'a'.repeat(64) }) })), e => e.code === 'UI_TEST_DESIGN_REGISTRY_RECEIPT_INVALID');
});

test('exact read rejects another valid version or metadata hash and list rejects a crossed source', async () => {
  for (const change of [{ testDesignVersionId: 'uitdv_another' }, { contentHash: 'f'.repeat(64) }, { domain: 'API' }, { version: 0 }]) {
    await assert.rejects(consoleUiTestDesign(...product('designs', 'GET', undefined, 'uitdv_fixture'), dependencies({ request: async () => ({ ...storedVersion(), ...change }) })), e => e.code === 'UI_TEST_DESIGN_REGISTRY_RECEIPT_INVALID');
  }
  await assert.rejects(consoleUiTestDesign(...product('designs'), dependencies({ request: async () => ({ domain: 'UI', scope, nextCursor: null,
    items: [{ ...storedVersion(), source: { ...compilation.source, scope: { ...scope, environmentId: 'env_crossed' } } }] }) })), e => e.code === 'UI_TEST_DESIGN_SCOPE_MISMATCH');
  assert.equal(uiId('u'.repeat(180)).length, 180); assert.throws(() => uiId('u'.repeat(181))); assert.throws(() => uiId('_bad'));
});

test('bounded streams, invalid UTF8 and canonical JSON reject malformed evidence', async () => {
  await assert.rejects(readUiText(new Response('abcde'), 4), e => e.status === 413);
  await assert.rejects(readUiText(new Response(new Uint8Array([255]))), e => e.code === 'UI_TEST_DESIGN_JSON_INVALID');
  assert.throws(() => canonicalUiJson(new Array(1)), /JSON_INVALID/);
  assert.throws(() => canonicalUiJson({ x: '\ud800' }), /JSON_INVALID/);
  assert.throws(() => canonicalUiJson(JSON.parse('{"__proto__":{}}')), /JSON_INVALID/);
  assert.deepEqual(normalizeUiProfile({}), UI_DEFAULT_PROFILE);
  const candidate = structuredClone(compilation); candidate.executionPerformed = true;
  await assert.rejects(assertUiCompilation(candidate, scope), e => e.code === 'UI_TEST_DESIGN_COMPILATION_INVALID');
  const unknown = { ...compilation, specification: null, specificationHash: null, outcome: 'NO_DESIGN' };
  assert.equal((await assertUiCompilation(unknown, scope)).outcome, 'NO_DESIGN');
});

test('upstream errors remain bounded codes and timeout is retryable without exposing bodies', async () => {
  const base = { env: { ...env, UI_SERVICE: { fetch: async () => Response.json({ code: 'UI_BUNDLE_ACCESS_REVOKED', message: 'private body' }, { status: 410 }) } }, service: 'ui', scope,
    path: '/internal/ui/v1/test-design/source', method: 'POST', body: {} };
  await assert.rejects(requestUiDesignService(base), e => e.code === 'UI_BUNDLE_ACCESS_REVOKED' && e.status === 410 && !e.message.includes('private'));
  const timeout = { ...env, UI_SERVICE: { fetch: request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) } };
  await assert.rejects(requestUiDesignService({ ...base, env: timeout, timeoutMs: 5 }), e => e.code === 'UI_TEST_DESIGN_UPSTREAM_TIMEOUT' && e.retryable);
});

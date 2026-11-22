import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { getOrganizationById } from '../repositories/organizationRepository.js';
import { verifyTestGenerationInternalRequest } from '../security/testGenerationInternalAuth.js';
import { UI_COMPILER_VERSION, uiCompilerVersion, uiError, uiId, uiObject, normalizeUiProfile, readUiText, parseUiJson,
  assertUiSource, assertUiCompilation, assertUiVersionReceipt, assertUiDesignPage, assertUiEvidencePage, requestUiDesignService, uiScopeQuery, uiSourceRequest } from '../services/uiTestDesignClient.js';

const depsFor = deps => ({ tenant: requireConsoleTenant, environment: getProjectEnvironment, organization: getOrganizationById,
  verify: verifyTestGenerationInternalRequest, request: requestUiDesignService, source: uiSourceRequest, ...deps });
function pagination(url) {
  const cursor = url.searchParams.get('cursor'), raw = url.searchParams.get('limit') || '20';
  if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 50 || (cursor && cursor.length > 4096)) throw uiError('UI_TEST_DESIGN_PAGINATION_INVALID');
  return { ...(cursor ? { cursor } : {}), limit: Number(raw) };
}
function requireSameSource(actual, expected, scope) {
  assertUiSource(actual, scope, expected.bundleVersionId);
  if (['captureId', 'sourceHash', 'manifestHash'].some(key => actual[key] !== expected[key])) throw uiError('UI_TEST_DESIGN_SOURCE_MISMATCH', 409);
}
async function consoleScope(req, env, params, deps, writing = false) {
  const tenant = await deps.tenant(req, env);
  if (writing && !['owner', 'admin', 'member'].includes(tenant.organizationRole)) throw uiError('UI_TEST_DESIGN_READ_ONLY', 403);
  const scope = { organizationId: uiId(tenant.organizationId), projectId: uiId(params.projectId), environmentId: uiId(params.environmentId) };
  await deps.environment(env, scope.organizationId, scope.projectId, scope.environmentId);
  return { tenant, scope };
}
/** Product routes derive tenant authority from the Console session, never from a request body. */
export async function consoleUiTestDesign(req, env, params, injected = {}) {
  const deps = depsFor(injected), { resource, id = null, action = null } = params;
  const writing = req.method === 'POST';
  const { tenant, scope } = await consoleScope(req, env, params, deps, writing);
  const url = new URL(req.url), project = encodeURIComponent(scope.projectId);
  let data;
  if (resource === 'sources' && req.method === 'GET') {
    const page = pagination(url), captureId = url.searchParams.get('captureId'); if (captureId) uiId(captureId);
    data = await deps.request({ env, service: 'ui', scope, path: '/internal/ui/v1/test-design/sources', method: 'POST',
      body: { scope, ...page, ...(captureId ? { captureId } : {}) } });
  } else if (resource === 'jobs' && !id && writing) {
    const input = uiObject(parseUiJson(await readUiText(req, 32768)), ['operationId', 'bundleVersionIds', 'compilerVersion', 'profile'], ['operationId', 'bundleVersionIds']);
    const operationId = uiId(input.operationId, 'UI_TEST_DESIGN_OPERATION_INVALID');
    if (!Array.isArray(input.bundleVersionIds) || input.bundleVersionIds.length < 1 || input.bundleVersionIds.length > 50) throw uiError('UI_TEST_DESIGN_SOURCE_LIMIT');
    const bundleVersionIds = input.bundleVersionIds.map(value => uiId(value, 'UI_TEST_DESIGN_SOURCE_INVALID'));
    if (new Set(bundleVersionIds).size !== bundleVersionIds.length) throw uiError('UI_TEST_DESIGN_DUPLICATE_SOURCE');
    const compilerVersion = uiCompilerVersion(input.compilerVersion);
    data = await deps.request({ env, service: 'orchestrator', scope, path: `/v1/test-design-generation/projects/${project}/ui-jobs`, method: 'POST',
      body: { ...scope, operationId, bundleVersionIds, compilerVersion, profile: normalizeUiProfile(input.profile, compilerVersion), createdBy: tenant.user?.userId || null, createdByAccountId: tenant.accountId || null } });
  } else if (resource === 'jobs' && req.method === 'GET') {
    if (id) uiId(id);
    const suffix = id ? `/ui-jobs/${encodeURIComponent(id)}${action === 'items' ? '/items' : ''}` : `/projects/${project}/ui-jobs`;
    data = await deps.request({ env, service: 'orchestrator', scope, path: `/v1/test-design-generation${suffix}?${uiScopeQuery(scope, pagination(url))}` });
  } else if (resource === 'jobs' && id && action === 'cancel' && writing) {
    uiId(id);
    uiObject(parseUiJson(await readUiText(req, 1024)), []);
    data = await deps.request({ env, service: 'orchestrator', scope, path: `/v1/test-design-generation/ui-jobs/${encodeURIComponent(id)}/cancel`, method: 'POST', body: scope });
  } else if (resource === 'designs' && !id && req.method === 'GET') {
    const query = uiScopeQuery({ organizationId: scope.organizationId, environmentId: scope.environmentId }, pagination(url));
    data = assertUiDesignPage(await deps.request({ env, service: 'registry', scope, path: `/v1/test-registry/projects/${project}/ui-test-designs?${query}` }), scope);
  } else if (resource === 'designs' && id && req.method === 'GET') {
    if (action !== null && action !== 'evidence') throw uiError('UI_TEST_DESIGN_ROUTE_NOT_FOUND', 404);
    uiId(id);
    data = await deps.request({ env, service: 'registry', scope, path: `/v1/test-registry/ui-test-designs/versions/${encodeURIComponent(id)}?${uiScopeQuery(scope)}` });
    await assertUiCompilation(data?.compilation, scope);
    assertUiVersionReceipt(data, data.compilation.specificationHash);
    if (data.testDesignVersionId !== id || data.compilation.outcome !== 'COMPILED') throw uiError('UI_TEST_DESIGN_REGISTRY_RECEIPT_INVALID', 502);
    const source = data.compilation.source;
    requireSameSource(data.source, source, scope);
    // A persisted design is not authority to keep reading a revoked observation.
    const receipt = await deps.source(env, scope, source.bundleVersionId, source.manifestHash);
    requireSameSource(receipt?.source, source, scope);
    if (action === 'evidence') {
      if (data.compilation.specification.contractVersion !== 'qagent.ui-test-design.v2') throw uiError('UI_TEST_DESIGN_PLAN_UNSUPPORTED', 422);
      const page = pagination(url), section = url.searchParams.get('section'), artifactId = url.searchParams.get('artifactId');
      if (!['ACTIONS', 'CHECKPOINTS', 'INTERACTIONS', 'FIXTURES', 'DOCUMENTS', 'RESOURCES', 'STATE_RESOURCES', 'ARTIFACTS', 'SOURCE_METADATA', 'ARTIFACT_CONTENT'].includes(section)
        || [...url.searchParams.keys()].some(key => !['section', 'cursor', 'limit', 'artifactId'].includes(key))
        || ['section', 'cursor', 'limit', 'artifactId'].some(key => url.searchParams.getAll(key).length > 1)
        || (section === 'ARTIFACT_CONTENT' ? !artifactId : artifactId !== null)) throw uiError('UI_TEST_DESIGN_PAGINATION_INVALID');
      if (artifactId) uiId(artifactId, 'UI_TEST_DESIGN_ARTIFACT_REF_INVALID');
      const compilation = data.compilation;
      data = assertUiEvidencePage(await deps.request({ env, service: 'ui', scope, path: '/internal/ui/v1/test-design/plan-page', method: 'POST',
        body: { scope, specification: compilation.specification, specificationHash: compilation.specificationHash, section, ...page, ...(artifactId ? { artifactId } : {}) } }), compilation, section, artifactId);
    }
  } else throw uiError('UI_TEST_DESIGN_ROUTE_NOT_FOUND', 404);
  return { status: 'ok', data };
}

/** The existing asynchronous Orchestrator calls compilation and publication separately. */
export async function internalUiTestDesign(req, env, { action }, injected = {}) {
  const deps = depsFor(injected), rawBody = await readUiText(req);
  const auth = await deps.verify(req, env, { rawBody });
  const input = uiObject(parseUiJson(rawBody), action === 'compile'
    ? ['organizationId', 'projectId', 'environmentId', 'jobId', 'jobItemId', 'generationRequestId', 'bundleVersionId', 'compilerVersion', 'profile']
    : ['organizationId', 'projectId', 'environmentId', 'jobId', 'jobItemId', 'generationRequestId', 'compilation'],
  ['organizationId', 'projectId', 'environmentId', 'jobId', 'jobItemId', 'generationRequestId']);
  const scope = { organizationId: uiId(input.organizationId), projectId: uiId(input.projectId), environmentId: uiId(input.environmentId) };
  if (auth.organizationId !== scope.organizationId || auth.projectId !== scope.projectId) throw uiError('UI_TEST_DESIGN_SCOPE_MISMATCH', 403);
  uiId(input.jobId); uiId(input.jobItemId);
  if (input.generationRequestId !== `uitdg_${input.jobItemId}`) throw uiError('UI_TEST_DESIGN_OPERATION_INVALID');
  uiId(input.generationRequestId);
  const organization = await deps.organization(env, scope.organizationId);
  if (!organization || organization.status !== 'active') throw uiError('ORGANIZATION_UNAVAILABLE', 403);
  await deps.environment(env, scope.organizationId, scope.projectId, scope.environmentId);
  if (action === 'compile') {
    uiId(input.bundleVersionId);
    const compilerVersion = uiCompilerVersion(input.compilerVersion ?? null), profile = normalizeUiProfile(input.profile, compilerVersion);
    const compilation = await deps.request({ env, service: 'ui', scope, path: '/internal/ui/v1/test-design/compile', method: 'POST', timeoutMs: 120000,
      body: { scope, bundleVersionId: input.bundleVersionId, compilerVersion, profile } });
    await assertUiCompilation(compilation, scope, input.bundleVersionId, { compilerVersion, profile });
    return { status: 'ok', data: compilation };
  }
  if (action === 'publish') {
    const compilation = await assertUiCompilation(input.compilation, scope);
    if (compilation.outcome !== 'COMPILED') throw uiError('UI_TEST_DESIGN_NO_DESIGN');
    const source = compilation.source, receipt = await deps.source(env, scope, source.bundleVersionId, source.manifestHash);
    requireSameSource(receipt?.source, source, scope);
    const result = await deps.request({ env, service: 'registry', scope, path: '/v1/test-registry/ui-test-designs/versions', method: 'POST',
      body: { ...scope, generationRequestId: input.generationRequestId, compilation } });
    assertUiVersionReceipt(result, compilation.specificationHash);
    if (!['persisted', 'reused'].includes(result.status)) throw uiError('UI_TEST_DESIGN_REGISTRY_RECEIPT_INVALID', 502);
    return { status: 'ok', data: result };
  }
  throw uiError('UI_TEST_DESIGN_ROUTE_NOT_FOUND', 404);
}

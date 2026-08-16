import { corsHeaders } from '../lib/http.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { proxyCatalogQuery } from '../services/catalogQueryProxyService.js';

function catalogResponse(req, env, result) {
  const headers = new Headers(corsHeaders(req, env));
  headers.set('Content-Type', result.contentType || 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'private, no-store');
  if (result.queryApiVersion) headers.set('X-QAgent-Catalog-Query-Version', result.queryApiVersion);
  return new Response(result.bodyText, { status: result.status, headers });
}

async function proxyForProject(req, env, { projectId, upstreamPath }) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);
  const result = await proxyCatalogQuery({
    env,
    organizationId: tenant.organizationId,
    projectId,
    upstreamPath,
    incomingUrl: new URL(req.url),
  });
  return catalogResponse(req, env, result);
}

export function getConsoleCatalogSummary(req, env, { projectId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/projects/${encodeURIComponent(projectId)}/summary` });
}
export function listConsoleCatalogServices(req, env, { projectId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/projects/${encodeURIComponent(projectId)}/services` });
}
export function listConsoleCatalogEndpoints(req, env, { projectId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/projects/${encodeURIComponent(projectId)}/endpoints` });
}
export function getConsoleCatalogEndpoint(req, env, { projectId, endpointId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/endpoints/${encodeURIComponent(endpointId)}` });
}
export function listConsoleCatalogEndpointEvidence(req, env, { projectId, endpointId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/endpoints/${encodeURIComponent(endpointId)}/evidence` });
}
export function getConsoleCatalogEndpointSchemas(req, env, { projectId, endpointId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/endpoints/${encodeURIComponent(endpointId)}/schemas` });
}
export function listConsoleCatalogEndpointLifecycleHistory(req, env, { projectId, endpointId }) {
  return proxyForProject(req, env, { projectId, upstreamPath: `/v1/catalog/endpoints/${encodeURIComponent(endpointId)}/lifecycle-history` });
}

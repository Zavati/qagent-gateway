import { buildTestGenerationInternalHeaders } from '../security/testGenerationInternalAuth.js';

const INTERNAL_BASE = 'https://qagent-test-generation-orchestrator.internal';

export class TestGenerationOrchestratorClientError extends Error {
  constructor(message, { code = 'PROJECT_TEST_DESIGN_GENERATION_UPSTREAM_FAILED', status = 503, retryable = true, publicDetails = null, cause = null } = {}) {
    super(message); this.name = 'TestGenerationOrchestratorClientError'; this.code = code; this.status = status; this.retryable = retryable;
    if (publicDetails) this.publicDetails = publicDetails;
    if (cause) this.cause = cause;
  }
}
function safeJson(text) { try { return text ? JSON.parse(text) : null; } catch { return null; } }
async function requestOrchestrator({ env, organizationId, projectId = '', path, method = 'GET', body = null, fetchImpl = null }) {
  const binding = env?.TEST_GENERATION_ORCHESTRATOR_SERVICE;
  if (!fetchImpl && (!binding || typeof binding.fetch !== 'function')) throw new TestGenerationOrchestratorClientError('Project Test Generation Orchestrator service binding is not configured.', { code: 'PROJECT_TEST_GENERATION_NOT_CONFIGURED', status: 503, retryable: true });
  const url = `${INTERNAL_BASE}${path}`;
  const rawBody = body == null ? '' : JSON.stringify(body);
  const authHeaders = await buildTestGenerationInternalHeaders({ env, method, url, organizationId, projectId, rawBody });
  const request = new Request(url, { method, headers: { ...authHeaders, accept: 'application/json', ...(rawBody ? { 'content-type': 'application/json' } : {}) }, ...(rawBody ? { body: rawBody } : {}) });
  let response;
  try { response = fetchImpl ? await fetchImpl(request) : await binding.fetch(request); }
  catch (error) { throw new TestGenerationOrchestratorClientError('Project Test Generation Orchestrator is temporarily unavailable.', { code: 'PROJECT_TEST_DESIGN_GENERATION_UPSTREAM_UNAVAILABLE', status: 503, retryable: true, cause: error }); }
  const payload = safeJson(await response.text());
  if (!response.ok) {
    throw new TestGenerationOrchestratorClientError(String(payload?.message || 'Project Test Design Generation request failed.'), {
      code: String(payload?.code || 'PROJECT_TEST_DESIGN_GENERATION_UPSTREAM_FAILED'),
      status: response.status,
      retryable: payload?.retryable === true || response.status === 429 || response.status >= 500,
      publicDetails: payload?.details && typeof payload.details === 'object' ? payload.details : null,
    });
  }
  if (payload?.status !== 'ok' || payload?.data == null) throw new TestGenerationOrchestratorClientError('Project Test Generation Orchestrator returned an invalid response.', { code: 'PROJECT_TEST_DESIGN_GENERATION_RESPONSE_INVALID', status: 502, retryable: true });
  return payload.data;
}
export function createProjectTestDesignGenerationJob({ env, organizationId, projectId, scope, createdBy, createdByAccountId, fetchImpl = null }) {
  return requestOrchestrator({ env, organizationId, projectId, method: 'POST', path: `/v1/test-design-generation/projects/${encodeURIComponent(projectId)}/jobs`, body: { scope, createdBy: createdBy || null, createdByAccountId: createdByAccountId || null }, fetchImpl });
}
export function getProjectTestDesignGenerationJob({ env, organizationId, jobId, fetchImpl = null }) {
  return requestOrchestrator({ env, organizationId, path: `/v1/test-design-generation/jobs/${encodeURIComponent(jobId)}`, fetchImpl });
}
export function listProjectTestDesignGenerationJobItems({ env, organizationId, jobId, fetchImpl = null }) {
  return requestOrchestrator({ env, organizationId, path: `/v1/test-design-generation/jobs/${encodeURIComponent(jobId)}/items`, fetchImpl });
}
export function listProjectTestDesignGenerationJobs({ env, organizationId, projectId, limit = 20, fetchImpl = null }) {
  return requestOrchestrator({ env, organizationId, projectId, path: `/v1/test-design-generation/projects/${encodeURIComponent(projectId)}/jobs?limit=${encodeURIComponent(String(limit))}`, fetchImpl });
}

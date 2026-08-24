const INTERNAL_BASE_URL = 'https://qagent-test-results.internal';
const DEFAULT_TIMEOUT_MS = 10000;

export class ResultsReadClientError extends Error {
  constructor(message, { code = 'RESULTS_READ_UPSTREAM_FAILED', status = 503, retryable = true, upstreamStatus = null, upstreamCode = null, cause = null } = {}) {
    super(message);
    this.name = 'ResultsReadClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
    if (cause) this.cause = cause;
  }
}

function timeoutMs(env) {
  const parsed = Number(env?.RESULTS_READ_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(30000, Math.max(1000, parsed)) : DEFAULT_TIMEOUT_MS;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function encodeQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

function validateEnvelope(body) {
  if (body?.status !== 'ok' || !body?.data || body.data.contractVersion !== 'qagent.execution-results-read.v1') {
    throw new ResultsReadClientError('Results Plane retornou contrato inválido.', { code: 'RESULTS_READ_RESPONSE_INVALID', status: 502 });
  }
  return body.data;
}

async function fetchResults({ env, organizationId, projectId, path, query = {}, fetchImpl = null }) {
  const binding = env?.RESULTS_SERVICE;
  if (!fetchImpl && (!binding || typeof binding.fetch !== 'function')) {
    throw new ResultsReadClientError('Results service binding is not configured.', { code: 'RESULTS_SERVICE_NOT_CONFIGURED', status: 503 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(env));
  const request = new Request(`${INTERNAL_BASE_URL}${path}${encodeQuery(query)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-QAgent-Organization-Id': organizationId,
      'X-QAgent-Project-Id': projectId,
    },
    signal: controller.signal,
  });
  let response;
  try {
    response = fetchImpl ? await fetchImpl(request) : await binding.fetch(request);
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    throw new ResultsReadClientError(isTimeout ? 'Results Plane timeout.' : 'Results Plane indisponível.', {
      code: isTimeout ? 'RESULTS_READ_UPSTREAM_TIMEOUT' : 'RESULTS_READ_UPSTREAM_UNAVAILABLE',
      status: isTimeout ? 504 : 503,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
  const body = safeJson(await response.text());
  if (!response.ok) {
    const upstreamCode = typeof body?.code === 'string' ? body.code : null;
    if (response.status === 404 && upstreamCode === 'RESULT_SET_NOT_FOUND') {
      throw new ResultsReadClientError('Result Set não encontrado.', { code: 'RESULT_SET_NOT_FOUND', status: 404, retryable: false, upstreamStatus: 404, upstreamCode });
    }
    throw new ResultsReadClientError('Results Plane rejeitou a leitura.', {
      code: 'RESULTS_READ_UPSTREAM_REJECTED',
      status: response.status >= 500 ? 503 : 502,
      retryable: response.status >= 500 || response.status === 429,
      upstreamStatus: response.status,
      upstreamCode,
    });
  }
  return validateEnvelope(body);
}

export function getResultsProjectSummary({ env, organizationId, projectId, days = 30, environmentId = null, fetchImpl = null }) {
  return fetchResults({ env, organizationId, projectId, path: `/internal/v1/projects/${encodeURIComponent(projectId)}/summary`, query: { days, environmentId }, fetchImpl });
}

export function listResultsProjectResultSets({ env, organizationId, projectId, limit = 30, cursor = null, outcome = null, endpointId = null, environmentId = null, fetchImpl = null }) {
  return fetchResults({ env, organizationId, projectId, path: `/internal/v1/projects/${encodeURIComponent(projectId)}/result-sets`, query: { limit, cursor, outcome, endpointId, environmentId }, fetchImpl });
}

export function getResultsProjectResultSet({ env, organizationId, projectId, resultSetId, fetchImpl = null }) {
  return fetchResults({ env, organizationId, projectId, path: `/internal/v1/projects/${encodeURIComponent(projectId)}/result-sets/${encodeURIComponent(resultSetId)}`, fetchImpl });
}

export function getResultsEndpointLatest({ env, organizationId, projectId, endpointId, environmentId = null, fetchImpl = null }) {
  return fetchResults({ env, organizationId, projectId, path: `/internal/v1/projects/${encodeURIComponent(projectId)}/endpoints/${encodeURIComponent(endpointId)}/latest`, query: { environmentId }, fetchImpl });
}

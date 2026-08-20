const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const MAX_RETRIES = 2;
const INTERNAL_BASE_URL = 'https://qagent-test-registry.internal';

export class TestRegistryClientError extends Error {
  constructor(message, {
    code = 'TEST_REGISTRY_UPSTREAM_FAILED',
    status = 503,
    retryable = true,
    upstreamStatus = null,
    upstreamCode = null,
    detail = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = 'TestRegistryClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
    if (detail) this._detail = detail;
    if (cause) this.cause = cause;
  }
}

function parseBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function resolveTimeoutMs(env) {
  return parseBoundedInt(env?.TEST_REGISTRY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

function resolveRetries(env) {
  return parseBoundedInt(env?.TEST_REGISTRY_PERSIST_RETRIES, DEFAULT_RETRIES, 0, MAX_RETRIES);
}

function safeParseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function retryableUpstreamResponse(response, body) {
  if (response.status >= 500) return true;
  if (response.status === 429) return true;
  return response.status === 409 && body?.retryable === true;
}

function buildAppendPayload({
  organizationId,
  projectId,
  endpointId,
  generationRequestId,
  generationResult,
}) {
  const specification = generationResult?.specification;
  const diagnostics = generationResult?.diagnostics || {};

  return {
    organizationId,
    projectId,
    endpointId,
    generationRequestId,
    contextFingerprint: generationResult?.contextFingerprint,
    specification,
    metadata: {
      provider: diagnostics.provider || specification?.generation?.provider || null,
      model: diagnostics.model || specification?.generation?.model || null,
      promptVersion: diagnostics.promptVersion || null,
      repairPromptVersion: diagnostics.repairPromptVersion || null,
      guardVersion: diagnostics.semanticGuard?.guardVersion || null,
    },
  };
}

function validateSuccessEnvelope(body) {
  const testDesign = body?.data?.testDesign;
  if (
    body?.status !== 'ok'
    || !testDesign
    || typeof testDesign.id !== 'string'
    || typeof testDesign.versionId !== 'string'
    || !Number.isInteger(testDesign.version)
    || testDesign.version < 1
  ) {
    throw new TestRegistryClientError('Test Registry returned an invalid persistence response.', {
      code: 'TEST_REGISTRY_RESPONSE_INVALID',
      status: 502,
      retryable: true,
    });
  }
  return body.data;
}

export async function appendTestDesignVersion({
  env,
  organizationId,
  projectId,
  endpointId,
  generationRequestId,
  generationResult,
  fetchImpl = null,
} = {}) {
  const binding = env?.TEST_REGISTRY_SERVICE;
  if (!fetchImpl && (!binding || typeof binding.fetch !== 'function')) {
    throw new TestRegistryClientError('Test Registry service binding is not configured.', {
      code: 'TEST_REGISTRY_NOT_CONFIGURED',
      status: 503,
      retryable: true,
    });
  }

  const payload = buildAppendPayload({
    organizationId,
    projectId,
    endpointId,
    generationRequestId,
    generationResult,
  });
  const serializedBody = JSON.stringify(payload);
  const timeoutMs = resolveTimeoutMs(env);
  const maxAttempts = resolveRetries(env) + 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const request = new Request(`${INTERNAL_BASE_URL}/v1/test-registry/test-designs/versions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'X-QAgent-Organization-Id': organizationId,
        'X-QAgent-Project-Id': projectId,
      },
      body: serializedBody,
      signal: controller.signal,
    });

    let response;
    try {
      response = fetchImpl ? await fetchImpl(request) : await binding.fetch(request);
    } catch (error) {
      const isTimeout = error?.name === 'AbortError';
      lastError = new TestRegistryClientError(
        isTimeout ? 'Test Registry persistence timed out.' : 'Test Registry service is unavailable.',
        {
          code: isTimeout ? 'TEST_REGISTRY_UPSTREAM_TIMEOUT' : 'TEST_REGISTRY_UPSTREAM_UNAVAILABLE',
          status: isTimeout ? 504 : 503,
          retryable: true,
          detail: { attempt, maxAttempts, timeoutMs },
          cause: error,
        },
      );
      if (attempt < maxAttempts) continue;
      throw lastError;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const body = safeParseJson(text);
    if (response.ok) return validateSuccessEnvelope(body);

    const retryable = retryableUpstreamResponse(response, body);
    lastError = new TestRegistryClientError('Test Registry rejected Test Design persistence.', {
      code: 'TEST_REGISTRY_UPSTREAM_REJECTED',
      status: 503,
      retryable,
      upstreamStatus: response.status,
      upstreamCode: typeof body?.code === 'string' ? body.code : null,
      detail: {
        attempt,
        maxAttempts,
        upstreamStatus: response.status,
        upstreamCode: typeof body?.code === 'string' ? body.code : null,
      },
    });

    if (retryable && attempt < maxAttempts) continue;
    throw lastError;
  }

  throw lastError || new TestRegistryClientError('Test Registry persistence failed.');
}

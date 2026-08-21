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


function validateLatestSuccessEnvelope(body, { organizationId, projectId, endpointId }) {
  if (body?.status !== 'ok' || !body?.data || typeof body.data.exists !== 'boolean') {
    throw new TestRegistryClientError('Test Registry returned an invalid retrieval response.', {
      code: 'TEST_REGISTRY_RESPONSE_INVALID',
      status: 502,
      retryable: true,
    });
  }

  if (body.data.exists === false) {
    return { exists: false, testDesign: null };
  }

  const root = body.data.testDesign;
  const version = body.data.version;
  const specification = version?.specification;
  const source = specification?.source;

  const valid = Boolean(
    root
    && version
    && typeof root.id === 'string'
    && typeof version.id === 'string'
    && version.testDesignId === root.id
    && Number.isInteger(version.version)
    && version.version >= 1
    && root.latestVersion === version.version
    && root.latestVersionId === version.id
    && root.organizationId === organizationId
    && root.projectId === projectId
    && root.endpointId === endpointId
    && version.organizationId === organizationId
    && version.projectId === projectId
    && version.endpointId === endpointId
    && typeof version.contextFingerprint === 'string'
    && version.contextFingerprint.length > 0
    && typeof version.createdAt === 'string'
    && specification
    && typeof specification === 'object'
    && !Array.isArray(specification)
    && specification.contractVersion === 'qagent.test-design.v1'
    && specification.specificationVersion === 'qagent.test-spec.v1'
    && source?.organizationId === organizationId
    && source?.projectId === projectId
    && source?.endpointId === endpointId
  );

  if (!valid) {
    throw new TestRegistryClientError('Test Registry returned an invalid or cross-scope Test Design.', {
      code: 'TEST_REGISTRY_RESPONSE_INVALID',
      status: 502,
      retryable: true,
    });
  }

  return {
    exists: true,
    testDesign: {
      id: root.id,
      versionId: version.id,
      version: version.version,
      createdAt: version.createdAt,
      contextFingerprint: version.contextFingerprint,
      specification,
    },
  };
}

export async function getLatestTestDesign({
  env,
  organizationId,
  projectId,
  endpointId,
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

  const timeoutMs = resolveTimeoutMs(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const path = `/v1/test-registry/projects/${encodeURIComponent(projectId)}/endpoints/${encodeURIComponent(endpointId)}/test-design/latest`;
  const request = new Request(`${INTERNAL_BASE_URL}${path}`, {
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
    throw new TestRegistryClientError(
      isTimeout ? 'Test Registry retrieval timed out.' : 'Test Registry service is unavailable.',
      {
        code: isTimeout ? 'TEST_REGISTRY_UPSTREAM_TIMEOUT' : 'TEST_REGISTRY_UPSTREAM_UNAVAILABLE',
        status: isTimeout ? 504 : 503,
        retryable: true,
        detail: { timeoutMs },
        cause: error,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const body = safeParseJson(text);
  if (!response.ok) {
    throw new TestRegistryClientError('Test Registry rejected Test Design retrieval.', {
      code: 'TEST_REGISTRY_UPSTREAM_REJECTED',
      status: response.status >= 500 ? 503 : 502,
      retryable: response.status >= 500 || response.status === 429,
      upstreamStatus: response.status,
      upstreamCode: typeof body?.code === 'string' ? body.code : null,
      detail: {
        upstreamStatus: response.status,
        upstreamCode: typeof body?.code === 'string' ? body.code : null,
      },
    });
  }

  return validateLatestSuccessEnvelope(body, { organizationId, projectId, endpointId });
}


function validateRunnerArtifactEnvelope(body, { organizationId, projectId, testDesignVersionId }) {
  const data = body?.data;
  const artifact = data?.artifact;
  const specification = artifact?.specification;
  const source = specification?.source;

  const valid = Boolean(
    body?.status === 'ok'
    && data?.contractVersion === 'qagent.runner-test-artifact.v1'
    && artifact
    && artifact.testDesignVersionId === testDesignVersionId
    && typeof artifact.testDesignId === 'string'
    && Number.isInteger(artifact.version)
    && artifact.version >= 1
    && artifact.organizationId === organizationId
    && artifact.projectId === projectId
    && typeof artifact.endpointId === 'string'
    && typeof artifact.contextFingerprint === 'string'
    && artifact.contextFingerprint.length > 0
    && artifact.specificationVersion === 'qagent.test-spec.v1'
    && typeof artifact.createdAt === 'string'
    && specification
    && typeof specification === 'object'
    && !Array.isArray(specification)
    && specification.contractVersion === 'qagent.test-design.v1'
    && specification.specificationVersion === 'qagent.test-spec.v1'
    && source?.organizationId === organizationId
    && source?.projectId === projectId
    && source?.endpointId === artifact.endpointId
  );

  if (!valid) {
    throw new TestRegistryClientError('Test Registry returned an invalid Runner artifact.', {
      code: 'TEST_REGISTRY_RUNNER_ARTIFACT_INVALID',
      status: 502,
      retryable: false,
    });
  }

  return artifact;
}

export async function getRunnerTestArtifact({
  env,
  organizationId,
  projectId,
  testDesignVersionId,
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

  const timeoutMs = resolveTimeoutMs(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const path = `/v1/test-registry/runner/test-design-versions/${encodeURIComponent(testDesignVersionId)}`;
  const request = new Request(`${INTERNAL_BASE_URL}${path}`, {
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
    throw new TestRegistryClientError(
      isTimeout ? 'Test Registry Runner artifact retrieval timed out.' : 'Test Registry service is unavailable.',
      {
        code: isTimeout ? 'TEST_REGISTRY_UPSTREAM_TIMEOUT' : 'TEST_REGISTRY_UPSTREAM_UNAVAILABLE',
        status: isTimeout ? 504 : 503,
        retryable: true,
        detail: { timeoutMs },
        cause: error,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const body = safeParseJson(text);
  if (!response.ok) {
    const upstreamCode = typeof body?.code === 'string' ? body.code : null;
    if (response.status === 404 && upstreamCode === 'TEST_DESIGN_VERSION_NOT_FOUND') {
      throw new TestRegistryClientError('Test Design version not found.', {
        code: 'TEST_DESIGN_VERSION_NOT_FOUND',
        status: 404,
        retryable: false,
        upstreamStatus: response.status,
        upstreamCode,
      });
    }
    throw new TestRegistryClientError('Test Registry rejected Runner artifact retrieval.', {
      code: 'TEST_REGISTRY_UPSTREAM_REJECTED',
      status: response.status >= 500 ? 503 : 502,
      retryable: response.status >= 500 || response.status === 429,
      upstreamStatus: response.status,
      upstreamCode,
    });
  }

  return validateRunnerArtifactEnvelope(body, { organizationId, projectId, testDesignVersionId });
}

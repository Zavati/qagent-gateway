import { getLatestTestDesign } from '../services/testRegistryClient.js';

export const TEST_DESIGN_RETRIEVAL_VERSION = 'qagent.test-design-retrieval.v1';

function logger(env) {
  if (typeof env?.log === 'function') return env.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

function wrapRetrievalFailure(error) {
  const wrapped = new Error('O Test Design persistido não pôde ser recuperado do Test Registry.');
  wrapped.status = 503;
  wrapped.code = 'TEST_DESIGN_RETRIEVAL_FAILED';
  wrapped.retryable = true;
  wrapped.publicDetails = { retryable: true };
  wrapped._detail = {
    upstreamStatus: error?.upstreamStatus ?? error?.status ?? null,
    upstreamCode: error?.upstreamCode ?? error?.code ?? null,
    upstreamRetryable: error?.retryable ?? null,
  };
  if (error) wrapped.cause = error;
  return wrapped;
}

export async function loadLatestPersistedTestDesignV1({
  env,
  organizationId,
  projectId,
  endpointId,
  registryGetLatest = getLatestTestDesign,
} = {}) {
  const log = logger(env);
  try {
    const result = await registryGetLatest({ env, organizationId, projectId, endpointId });
    log('testDesign_latest_loaded', {
      retrievalVersion: TEST_DESIGN_RETRIEVAL_VERSION,
      organizationId,
      projectId,
      endpointId,
      exists: result.exists,
      testDesignId: result.testDesign?.id ?? null,
      testDesignVersionId: result.testDesign?.versionId ?? null,
      version: result.testDesign?.version ?? null,
      contextFingerprint: result.testDesign?.contextFingerprint ?? null,
    });
    return result;
  } catch (error) {
    log('testDesign_retrieval_failed', {
      retrievalVersion: TEST_DESIGN_RETRIEVAL_VERSION,
      organizationId,
      projectId,
      endpointId,
      upstreamStatus: error?.upstreamStatus ?? error?.status ?? null,
      upstreamCode: error?.upstreamCode ?? error?.code ?? null,
      retryable: error?.retryable ?? null,
    });
    throw wrapRetrievalFailure(error);
  }
}

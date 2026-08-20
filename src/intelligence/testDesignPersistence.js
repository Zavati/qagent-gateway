import { appendTestDesignVersion } from '../services/testRegistryClient.js';
import { generateCatalogTestDesignV1 } from './testDesignService.js';

export const TEST_DESIGN_PERSISTENCE_VERSION = 'qagent.test-design-persistence.v1';

function logger(env) {
  if (typeof env?.log === 'function') return env.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

export function createGenerationRequestId(randomUUID = () => crypto.randomUUID()) {
  const uuid = String(randomUUID()).replace(/[^A-Za-z0-9_-]/g, '');
  if (uuid.length < 8) throw new Error('Could not create generationRequestId.');
  return `tdg_${uuid}`;
}

function wrapPersistenceFailure(error) {
  const wrapped = new Error('O Test Design foi gerado, mas não pôde ser persistido no Test Registry.');
  wrapped.status = 503;
  wrapped.code = 'TEST_DESIGN_PERSISTENCE_FAILED';
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

export async function persistGeneratedTestDesignV1({
  env,
  organizationId,
  projectId,
  endpointId,
  generationResult,
  generationRequestId = createGenerationRequestId(),
  registryAppend = appendTestDesignVersion,
} = {}) {
  const log = logger(env);

  try {
    const persisted = await registryAppend({
      env,
      organizationId,
      projectId,
      endpointId,
      generationRequestId,
      generationResult,
    });

    const registryTestDesign = persisted.testDesign;
    log('testDesign_persisted', {
      persistenceVersion: TEST_DESIGN_PERSISTENCE_VERSION,
      testDesignId: registryTestDesign.id,
      testDesignVersionId: registryTestDesign.versionId,
      version: registryTestDesign.version,
      organizationId,
      projectId,
      endpointId,
      contextFingerprint: generationResult.contextFingerprint,
      scenarioCount: generationResult.specification?.summary?.scenarioCount ?? null,
      generationRequestId,
      idempotentReplay: persisted.idempotentReplay === true,
    });

    return {
      testDesign: {
        id: registryTestDesign.id,
        versionId: registryTestDesign.versionId,
        version: registryTestDesign.version,
        persisted: true,
      },
      specification: generationResult.specification,
      contextFingerprint: generationResult.contextFingerprint,
      diagnostics: generationResult.diagnostics,
    };
  } catch (error) {
    log('testDesign_persistence_failed', {
      persistenceVersion: TEST_DESIGN_PERSISTENCE_VERSION,
      organizationId,
      projectId,
      endpointId,
      contextFingerprint: generationResult?.contextFingerprint || null,
      generationRequestId,
      upstreamStatus: error?.upstreamStatus ?? error?.status ?? null,
      upstreamCode: error?.upstreamCode ?? error?.code ?? null,
      retryable: error?.retryable ?? null,
    });
    throw wrapPersistenceFailure(error);
  }
}

export async function generateAndPersistCatalogTestDesignV1({
  env,
  organizationId,
  projectId,
  endpointId,
  accountId = null,
  generateDesign = generateCatalogTestDesignV1,
  registryAppend = appendTestDesignVersion,
  generationRequestIdFactory = createGenerationRequestId,
} = {}) {
  const generationResult = await generateDesign({
    env,
    organizationId,
    projectId,
    endpointId,
    accountId,
  });

  return persistGeneratedTestDesignV1({
    env,
    organizationId,
    projectId,
    endpointId,
    generationResult,
    generationRequestId: generationRequestIdFactory(),
    registryAppend,
  });
}

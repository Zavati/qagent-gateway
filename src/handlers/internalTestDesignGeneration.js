import { generateAndPersistCatalogTestDesignV1 } from '../intelligence/testDesignPersistence.js';
import { verifyTestGenerationInternalRequest } from '../security/testGenerationInternalAuth.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getOrganizationById } from '../repositories/organizationRepository.js';

function parseInput(rawBody) {
  let input; try { input = rawBody ? JSON.parse(rawBody) : {}; } catch { const error = new Error('Invalid internal JSON body.'); error.status = 400; error.code = 'INVALID_JSON'; throw error; }
  return input;
}
export async function postInternalEndpointTestDesignGeneration(req, env, { endpointId }, deps = {}) {
  const rawBody = await req.text();
  const auth = await (deps.verifyRequest || verifyTestGenerationInternalRequest)(req, env, { rawBody });
  const input = parseInput(rawBody);
  const organizationId = String(input.organizationId || '').trim();
  const projectId = String(input.projectId || '').trim();
  const bodyEndpointId = String(input.endpointId || '').trim();
  const jobId = String(input?.initiator?.jobId || '').trim();
  const jobItemId = String(input?.initiator?.jobItemId || '').trim();
  const generationRequestId = String(input.generationRequestId || '').trim();
  if (input?.initiator?.type !== 'PROJECT_GENERATION_JOB' || !organizationId || !projectId || !endpointId || bodyEndpointId !== endpointId || !jobId || !jobItemId) {
    const error = new Error('Project generation request scope is invalid.'); error.status = 400; error.code = 'INVALID_PROJECT_SCOPE'; throw error;
  }
  if (auth.organizationId !== organizationId || auth.projectId !== projectId) {
    const error = new Error('Project generation request scope is invalid.'); error.status = 403; error.code = 'JOB_NOT_ACCESSIBLE'; throw error;
  }
  if (generationRequestId !== `tdg_${jobItemId}` || !/^tdg_tdjobi_[A-Za-z0-9_-]{8,120}$/.test(generationRequestId)) {
    const error = new Error('Project generation idempotency key is invalid.'); error.status = 400; error.code = 'INVALID_GENERATION_REQUEST_ID'; throw error;
  }
  await (deps.getProject || getOrganizationProject)(env, organizationId, projectId);
  const organization = await (deps.getOrganization || getOrganizationById)(env, organizationId);
  if (!organization || organization.status !== 'active') {
    const error = new Error('Organization is unavailable for Project Test Design Generation.'); error.status = 403; error.code = 'JOB_NOT_ACCESSIBLE'; throw error;
  }
  const accountId = organization.legacyCustomerId || input.accountId || null;
  if (input.accountId && organization.legacyCustomerId && input.accountId !== organization.legacyCustomerId) {
    const error = new Error('Project generation account scope is invalid.'); error.status = 403; error.code = 'JOB_NOT_ACCESSIBLE'; throw error;
  }
  const result = await (deps.generate || generateAndPersistCatalogTestDesignV1)({ env, organizationId, projectId, endpointId, accountId, generationRequestId });
  return {
    status: 'ok',
    data: {
      testDesignId: result.testDesign.id,
      testDesignVersionId: result.testDesign.versionId,
      testDesignVersion: result.testDesign.version,
      persisted: result.testDesign.persisted === true,
    },
  };
}

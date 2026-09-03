import assert from 'node:assert/strict';
import { generateAndPersistCatalogTestDesignV1 } from '../src/intelligence/testDesignPersistence.js';
import { postInternalEndpointTestDesignGeneration } from '../src/handlers/internalTestDesignGeneration.js';

const specification = {
  contractVersion: 'qagent.test-design.v1',
  specificationVersion: 'qagent.test-spec.v1',
  source: { organizationId: 'org_1', projectId: 'prj_1', endpointId: 'cep_1' },
};
let appended = null;
const generated = await generateAndPersistCatalogTestDesignV1({
  env: {}, organizationId: 'org_1', projectId: 'prj_1', endpointId: 'cep_1', accountId: 'acct_1',
  generationRequestId: 'tdg_tdjobi_12345678',
  generateDesign: async () => ({ specification, contextFingerprint: 'ctx_1', diagnostics: {} }),
  registryAppend: async (input) => {
    appended = input;
    return { idempotentReplay: false, testDesign: { id: 'td_1', versionId: 'tdv_1', version: 1 } };
  },
});
assert.equal(appended.generationRequestId, 'tdg_tdjobi_12345678');
assert.equal(generated.testDesign.version, 1);

let internalInput = null;
const request = new Request('https://gateway.internal/internal/v1/test-design-generation/endpoints/cep_1/generate', {
  method: 'POST',
  body: JSON.stringify({
    organizationId: 'org_1', projectId: 'prj_1', endpointId: 'cep_1', accountId: 'acct_1',
    generationRequestId: 'tdg_tdjobi_12345678',
    initiator: { type: 'PROJECT_GENERATION_JOB', jobId: 'tdjob_12345678', jobItemId: 'tdjobi_12345678' },
  }),
});
const response = await postInternalEndpointTestDesignGeneration(request, {}, { endpointId: 'cep_1' }, {
  verifyRequest: async () => ({ organizationId: 'org_1', projectId: 'prj_1' }),
  getProject: async () => ({ projectId: 'prj_1' }),
  getOrganization: async () => ({ organizationId: 'org_1', legacyCustomerId: 'acct_1', status: 'active' }),
  generate: async (input) => {
    internalInput = input;
    return { testDesign: { id: 'td_2', versionId: 'tdv_2', version: 4, persisted: true } };
  },
});
assert.equal(internalInput.generationRequestId, 'tdg_tdjobi_12345678');
assert.equal(internalInput.accountId, 'acct_1');
assert.deepEqual(response.data, { testDesignId: 'td_2', testDesignVersionId: 'tdv_2', testDesignVersion: 4, persisted: true });

console.log('07.8-B shared generation boundary tests passed ✅');

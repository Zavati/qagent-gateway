import assert from 'node:assert/strict';
import { resolveGatewayRoute, dispatchGatewayRoute } from '../src/routing/gatewayRouter.js';

function expectRoute(method, path, name, params = {}) {
  assert.deepEqual(resolveGatewayRoute(method, path), { name, params });
}

expectRoute('GET', '/health', 'health');
expectRoute('POST', '/health', 'health');
expectRoute('POST', '/v1/auth/login', 'authLogin');
expectRoute('POST', '/v1/plugin/session', 'pluginSessionCreate');
expectRoute('POST', '/v1/plugin/observation-grants', 'pluginObservationGrantCreate');
expectRoute('POST', '/v1/generate-tests', 'generateTests');
expectRoute('POST', '/v1/autofill', 'autofill');
expectRoute('GET', '/v1/console/ai-providers', 'consoleAiProvidersGet');
expectRoute('GET', '/v1/console/ai-config', 'consoleAiConfigGet');
expectRoute('PUT', '/v1/console/ai-config', 'consoleAiConfigPut');
expectRoute('DELETE', '/v1/console/ai-config', 'consoleAiConfigDelete');
expectRoute('GET', '/v1/console/organization', 'consoleOrganizationGet');
expectRoute('PATCH', '/v1/console/organization', 'consoleOrganizationPatch');
expectRoute('GET', '/v1/console/projects', 'consoleProjectsList');
expectRoute('POST', '/v1/console/projects', 'consoleProjectsCreate');
expectRoute('GET', '/v1/console/projects/prj_123', 'consoleProjectGet', { projectId: 'prj_123' });
expectRoute('PATCH', '/v1/console/projects/prj_123', 'consoleProjectPatch', { projectId: 'prj_123' });
expectRoute('DELETE', '/v1/console/projects/prj_123', 'consoleProjectDelete', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/secrets', 'consoleSecretsList', { projectId: 'prj_123' });
expectRoute('POST', '/v1/console/projects/prj_123/secrets', 'consoleSecretsCreate', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/secrets/sec_789', 'consoleSecretGet', { projectId: 'prj_123', secretId: 'sec_789' });
expectRoute('PATCH', '/v1/console/projects/prj_123/secrets/sec_789', 'consoleSecretPatch', { projectId: 'prj_123', secretId: 'sec_789' });
expectRoute('PUT', '/v1/console/projects/prj_123/secrets/sec_789/value', 'consoleSecretValuePut', { projectId: 'prj_123', secretId: 'sec_789' });
expectRoute('DELETE', '/v1/console/projects/prj_123/secrets/sec_789', 'consoleSecretDelete', { projectId: 'prj_123', secretId: 'sec_789' });
expectRoute('GET', '/v1/console/projects/prj_123/auth-profiles', 'consoleAuthProfilesList', { projectId: 'prj_123' });
expectRoute('POST', '/v1/console/projects/prj_123/auth-profiles', 'consoleAuthProfilesCreate', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/auth-profiles/authp_789', 'consoleAuthProfileGet', { projectId: 'prj_123', authProfileId: 'authp_789' });
expectRoute('PATCH', '/v1/console/projects/prj_123/auth-profiles/authp_789', 'consoleAuthProfilePatch', { projectId: 'prj_123', authProfileId: 'authp_789' });
expectRoute('DELETE', '/v1/console/projects/prj_123/auth-profiles/authp_789', 'consoleAuthProfileDelete', { projectId: 'prj_123', authProfileId: 'authp_789' });
expectRoute('GET', '/v1/console/projects/prj_123/auth-profiles/authp_789/environments', 'consoleAuthProfileEnvironmentBindingsList', { projectId: 'prj_123', authProfileId: 'authp_789' });
expectRoute('GET', '/v1/console/projects/prj_123/auth-profiles/authp_789/environments/env_456', 'consoleAuthProfileEnvironmentBindingGet', { projectId: 'prj_123', authProfileId: 'authp_789', environmentId: 'env_456' });
expectRoute('PUT', '/v1/console/projects/prj_123/auth-profiles/authp_789/environments/env_456', 'consoleAuthProfileEnvironmentBindingPut', { projectId: 'prj_123', authProfileId: 'authp_789', environmentId: 'env_456' });
expectRoute('DELETE', '/v1/console/projects/prj_123/auth-profiles/authp_789/environments/env_456', 'consoleAuthProfileEnvironmentBindingDelete', { projectId: 'prj_123', authProfileId: 'authp_789', environmentId: 'env_456' });
expectRoute('GET', '/v1/console/projects/prj_123/environments', 'consoleEnvironmentsList', { projectId: 'prj_123' });
expectRoute('POST', '/v1/console/projects/prj_123/environments', 'consoleEnvironmentsCreate', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456', 'consoleEnvironmentGet', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('PATCH', '/v1/console/projects/prj_123/environments/env_456', 'consoleEnvironmentPatch', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('DELETE', '/v1/console/projects/prj_123/environments/env_456', 'consoleEnvironmentDelete', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/summary', 'consoleCatalogSummary', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/services', 'consoleCatalogServicesList', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/endpoints', 'consoleCatalogEndpointsList', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/endpoints/cep_789', 'consoleCatalogEndpointGet', { projectId: 'prj_123', endpointId: 'cep_789' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/endpoints/cep_789/evidence', 'consoleCatalogEndpointEvidenceList', { projectId: 'prj_123', endpointId: 'cep_789' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/endpoints/cep_789/schemas', 'consoleCatalogEndpointSchemasGet', { projectId: 'prj_123', endpointId: 'cep_789' });
expectRoute('GET', '/v1/console/projects/prj_123/catalog/endpoints/cep_789/lifecycle-history', 'consoleCatalogEndpointLifecycleHistoryList', { projectId: 'prj_123', endpointId: 'cep_789' });
expectRoute('GET', '/v1/console/projects/prj_123/api-services', 'consoleApiServicesList', { projectId: 'prj_123' });
expectRoute('POST', '/v1/console/projects/prj_123/api-services', 'consoleApiServicesCreate', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/api-services/svc_789', 'consoleApiServiceGet', { projectId: 'prj_123', apiServiceId: 'svc_789' });
expectRoute('PATCH', '/v1/console/projects/prj_123/api-services/svc_789', 'consoleApiServicePatch', { projectId: 'prj_123', apiServiceId: 'svc_789' });
expectRoute('DELETE', '/v1/console/projects/prj_123/api-services/svc_789', 'consoleApiServiceDelete', { projectId: 'prj_123', apiServiceId: 'svc_789' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456/api-services', 'consoleEnvironmentApiBindingsList', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456/api-services/svc_789', 'consoleEnvironmentApiBindingGet', { projectId: 'prj_123', environmentId: 'env_456', apiServiceId: 'svc_789' });
expectRoute('PUT', '/v1/console/projects/prj_123/environments/env_456/api-services/svc_789', 'consoleEnvironmentApiBindingPut', { projectId: 'prj_123', environmentId: 'env_456', apiServiceId: 'svc_789' });
expectRoute('DELETE', '/v1/console/projects/prj_123/environments/env_456/api-services/svc_789', 'consoleEnvironmentApiBindingDelete', { projectId: 'prj_123', environmentId: 'env_456', apiServiceId: 'svc_789' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456/variables', 'consoleEnvironmentVariablesList', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('POST', '/v1/console/projects/prj_123/environments/env_456/variables', 'consoleEnvironmentVariablesCreate', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456/variables/var_abc', 'consoleEnvironmentVariableGet', { projectId: 'prj_123', environmentId: 'env_456', variableId: 'var_abc' });
expectRoute('PATCH', '/v1/console/projects/prj_123/environments/env_456/variables/var_abc', 'consoleEnvironmentVariablePatch', { projectId: 'prj_123', environmentId: 'env_456', variableId: 'var_abc' });
expectRoute('DELETE', '/v1/console/projects/prj_123/environments/env_456/variables/var_abc', 'consoleEnvironmentVariableDelete', { projectId: 'prj_123', environmentId: 'env_456', variableId: 'var_abc' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456/runtime-config', 'consoleEnvironmentRuntimeConfigGet', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('GET', '/debug/payment-event/stripe/evt_123', 'debugPaymentEvent', {
  provider: 'stripe',
  eventId: 'evt_123',
});
expectRoute('GET', '/debug/payment-event/invalid', 'invalidDebugPaymentEvent');
assert.equal(resolveGatewayRoute('GET', '/v1/auth/login'), null);
assert.equal(resolveGatewayRoute('GET', '/does-not-exist'), null);

const called = [];
const response = await dispatchGatewayRoute(
  new Request('http://localhost/v1/license', { method: 'GET' }),
  { marker: 'env' },
  { marker: 'ctx' },
  {
    getLicense(req, env, ctx, params) {
      called.push({ method: req.method, env: env.marker, ctx: ctx.marker, params });
      return new Response('ok');
    },
  }
);

assert.equal(await response.text(), 'ok');
assert.deepEqual(called, [{ method: 'GET', env: 'env', ctx: 'ctx', params: {} }]);

const notFound = await dispatchGatewayRoute(
  new Request('http://localhost/nope', { method: 'GET' }),
  {},
  {},
  {}
);
assert.equal(notFound, null);

console.log('gateway router tests passed ✅');

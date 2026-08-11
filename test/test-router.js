import assert from 'node:assert/strict';
import { resolveGatewayRoute, dispatchGatewayRoute } from '../src/routing/gatewayRouter.js';

function expectRoute(method, path, name, params = {}) {
  assert.deepEqual(resolveGatewayRoute(method, path), { name, params });
}

expectRoute('GET', '/health', 'health');
expectRoute('POST', '/health', 'health');
expectRoute('POST', '/v1/auth/login', 'authLogin');
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
expectRoute('GET', '/v1/console/projects/prj_123/environments', 'consoleEnvironmentsList', { projectId: 'prj_123' });
expectRoute('POST', '/v1/console/projects/prj_123/environments', 'consoleEnvironmentsCreate', { projectId: 'prj_123' });
expectRoute('GET', '/v1/console/projects/prj_123/environments/env_456', 'consoleEnvironmentGet', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('PATCH', '/v1/console/projects/prj_123/environments/env_456', 'consoleEnvironmentPatch', { projectId: 'prj_123', environmentId: 'env_456' });
expectRoute('DELETE', '/v1/console/projects/prj_123/environments/env_456', 'consoleEnvironmentDelete', { projectId: 'prj_123', environmentId: 'env_456' });
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

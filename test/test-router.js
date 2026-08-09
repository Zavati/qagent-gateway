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

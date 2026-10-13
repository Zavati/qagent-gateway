import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveGatewayRoute } from '../src/routing/gatewayRouter.js';
test('A05 UI route is additive and method-specific', () => { assert.deepEqual(resolveGatewayRoute('POST', '/v1/plugin/ui-capture-grants'), { name: 'pluginUiCaptureGrantCreate', params: {} }); assert.equal(resolveGatewayRoute('GET', '/v1/plugin/ui-capture-grants'), null); });
test('A05 legacy exact routes retain their contracts', () => { for (const [path, name] of [['/v1/plugin/observation-grants', 'pluginObservationGrantCreate'], ['/v1/plugin/session', 'pluginSessionCreate'], ['/v1/generate-tests', 'generateTests'], ['/v1/autofill', 'autofill']])
    assert.equal(resolveGatewayRoute('POST', path).name, name); });

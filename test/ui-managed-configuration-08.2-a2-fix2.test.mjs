import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUiCaptureConfiguration, UI_CAPTURE_POLICY_VARIABLE } from '../src/ui/uiCaptureConfigurationService.js';
import { postPluginUiCaptureGrant } from '../src/handlers/pluginUiCaptureGrant.js';
import { hashAccessToken } from '../src/lib/keyService.js';
const environment = { organizationId: 'org_control', projectId: 'prj_control', environmentId: 'env_control', status: 'active', webBaseUrl: 'https://app.example.test', environmentType: 'STG' };
const opts = (extra = {}) => ({ projectId: 'prj_control', environment, ...extra });
const variable = value => ({ variableKey: UI_CAPTURE_POLICY_VARIABLE, valueType: 'JSON', variableValue: JSON.stringify(value), status: 'active' });
const bad = fn => assert.throws(fn, { code: 'UI_ENVIRONMENT_POLICY_INVALID' });
test('FIX2 inherits same-origin API Service paths, no duplicate operator input', () => {
    const value = buildUiCaptureConfiguration(opts({ bindings: [{ baseUrl: 'https://app.example.test/web/index.php/api/' }] }));
    assert.deepEqual(value.policy.networkPaths, ['/web/index.php/api/']);
    assert.equal(value.networkScopeSource, 'API_BINDINGS'); assert.equal(value.policy.startMode, 'CURRENT_DOCUMENT');
    for (const k of ['publicTextSelectors', 'valueSelectors', 'screenshotSelectors']) assert.deepEqual(value.policy[k], []);
});
test('FIX2 falls back only to configured web URL scope, not hardcoded OrangeHRM/BEES', () => {
    const value = buildUiCaptureConfiguration(opts({ environment: { ...environment, webBaseUrl: 'https://app.example.test/control' } }));
    assert.deepEqual(value.policy.networkPaths, ['/control']); assert.equal(value.networkScopeSource, 'WEB_BASE_URL');
});
test('FIX2 never widens the A2 consumer origin to external API bindings', () => {
    const value = buildUiCaptureConfiguration(opts({ bindings: [{ baseUrl: 'https://external.example.test/api/' }, { baseUrl: 'https://app.example.test/business/' }] }));
    assert.deepEqual(value.policy.networkPaths, ['/business/']); assert.equal(value.origin, 'https://app.example.test');
});
test('FIX2 central override uses existing Environment Variables, never returns the other variables', () => {
    const value = buildUiCaptureConfiguration(opts({ variables: [variable({ networkPaths: ['/data/'], publicTextSelectors: ['#public'], valueSelectors: ['#search'], screenshotSelectors: ['#public'], maskSelectors: ['#private'], sourceBuildRef: 'build_control' }), { variableKey: 'OTHER', variableValue: 'do-not-export' }] }));
    assert.equal(value.policySource, 'ENVIRONMENT_VARIABLE'); assert.deepEqual(value.policy.screenshotSelectors, ['#public']);
    assert.equal(value.sourceBuildRef, 'build_control'); assert.equal(JSON.stringify(value).includes('do-not-export'), false);
});
test('FIX2 central disable fails before a grant can be issued', () => {
    assert.throws(() => buildUiCaptureConfiguration(opts({ variables: [variable({ enabled: false })] })), { code: 'UI_ENVIRONMENT_CAPTURE_DISABLED' });
});
for (const [name, value] of [
    ['header', { businessHeaderNames: ['authorization'] }], ['external path', { networkPaths: ['//outside.test/'] }],
    ['query', { networkPaths: ['/api/?token=abc'] }], ['traversal', { networkPaths: ['/api/../'] }],
    ['empty path scope', { networkPaths: [] }], ['unknown key', { username: 'unexpected' }],
    ['build reference', { sourceBuildRef: 'https://secret.test/token' }], ['mode', { startMode: 'anything' }],
    ['selector', { screenshotSelectors: ['<body>'] }], ['private selector literal', { valueSelectors: ['[value="person@example.test"]'] }],
    ['null selector list', { screenshotSelectors: null }], ['null header list', { businessHeaderNames: null }], ['null start mode', { startMode: null }]
]) test(`FIX2 invalid policy refuses ${name}`, () => bad(() => buildUiCaptureConfiguration(opts({ variables: [variable(value)] }))));
test('FIX2 duplicate/invalid stored policy does not choose an arbitrary one', () => {
    bad(() => buildUiCaptureConfiguration(opts({ variables: [variable({}), variable({})] })));
    bad(() => buildUiCaptureConfiguration(opts({ variables: [{ ...variable({}), valueType: 'STRING' }] })));
    bad(() => buildUiCaptureConfiguration(opts({ variables: [{ ...variable({}), variableValue: '{bad' }] })));
});

const capabilities = { contractVersion: 'qagent.ui-capabilities.v1', revision: '08.2-A.2.r1', contracts: ['qagent.ui-capture.v1', 'qagent.ui-capture-events.v1', 'qagent.ui-artifact.v1'], readEnabled: true, captureEnabled: true, captureDataOrigins: ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED'], artifactContentTypes: ['application/json', 'image/png'], capabilities: ['OBSERVED_CAPTURE', 'MASKED_SCREENSHOTS'], limits: { artifactBytes: 1048576, artifactsPerCapture: 128, captureArtifactBytes: 67108864, eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000, captureEventBytes: 8388608, controlBytes: 32768, sessionSeconds: 900 } };
async function fixture(variables = []) {
    const qps = 'qps_' + 'S'.repeat(48), keyHash = 'sha256:' + 'a'.repeat(64), hashed = await hashAccessToken(qps), calls = [];
    const kv = new Map([[`plugin_session:${hashed}`, JSON.stringify({ organizationId: 'org_control', keyHash, pluginSessionId: 'psn_control', expiresAt: new Date(Date.now() + 3600000).toISOString() })], [`license:${keyHash}`, JSON.stringify({ status: 'active', plan: 'pro', expiresAt: new Date(Date.now() + 86400000).toISOString() })]]);
    const db = { prepare(sql) { return { bind(...params) { return {
        first: async () => {
            calls.push({ sql, params });
            if (params[0] !== 'org_control') return null;
            if (/FROM\s+projects/i.test(sql)) return params[1] === 'prj_control' ? { projectId: 'prj_control', organizationId: 'org_control', status: 'active' } : null;
            if (/FROM\s+environments/i.test(sql)) return params[1] === 'prj_control' && params[2] === 'env_control' ? environment : null;
            if (/FROM\s+organizations/i.test(sql)) return { organizationId: 'org_control', status: 'active' };
            return null;
        },
        all: async () => {
            calls.push({ sql, params });
            assert.deepEqual(params, ['org_control', 'prj_control', 'env_control']);
            if (/environment_variables/i.test(sql)) return { results: variables };
            if (/environment_api_bindings/i.test(sql)) return { results: [{ baseUrl: 'https://app.example.test/api/' }] };
            throw new Error('Unexpected query');
        }
    }; } }; } };
    const env = { QAGENT_DB: db, QAGENT_KV: { get: async k => kv.get(k) }, UI_CAPTURE_ENABLED: 'true', OBSERVATION_GRANT_SECRET: 'synthetic-only-secret-012345678901234567890', OBSERVATION_SERVICE: { fetch: async () => Response.json(capabilities) } };
    const request = (extra = {}) => new Request('https://gateway.example.test/v1/plugin/ui-capture-grants', { method: 'POST', headers: { authorization: 'Bearer ' + qps, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'prj_control', environmentId: 'env_control', purpose: 'UI_CAPTURE', contractRevision: '08.2-A.2.r1', configurationMode: 'ENVIRONMENT', ...extra }) });
    return { env, request, calls };
}
test('FIX2 actual grant handler returns scoped config using existing session and environment', async () => {
    const f = await fixture(); const value = await postPluginUiCaptureGrant(f.request(), f.env);
    assert.ok(value.grant.token.startsWith('qug_v1.')); assert.equal(value.captureConfiguration.environmentId, 'env_control');
    assert.deepEqual(value.captureConfiguration.policy.networkPaths, ['/api/']);
});
test('FIX2 old A2 client receives no new configuration and no new environment queries', async () => {
    const f = await fixture(); const value = await postPluginUiCaptureGrant(f.request({ configurationMode: undefined }), f.env);
    assert.equal(value.captureConfiguration, undefined); assert.equal(f.calls.some(c => /environment_variables/i.test(c.sql)), false);
});
test('FIX2 supplied policy or other organization cannot become inherited authority', async () => {
    const f = await fixture();
    await assert.rejects(() => postPluginUiCaptureGrant(f.request({ policy: {} }), f.env), { code: 'UI_INPUT_INVALID' });
    await assert.rejects(() => postPluginUiCaptureGrant(f.request({ organizationId: 'org_other' }), f.env), { code: 'UI_INPUT_INVALID' });
});
test('FIX2 configuration mode is not allowed for read authority or A1 synthetic revision', async () => {
    const f = await fixture();
    for (const extra of [{ purpose: 'UI_ARTIFACT_READ' }, { contractRevision: '08.2-A.1.r1' }]) await assert.rejects(() => postPluginUiCaptureGrant(f.request(extra), f.env), { code: 'UI_CONFIGURATION_MODE_UNSUPPORTED' });
});
test('FIX2 global disable and environment disable both refuse automatic UI; API route untouched', async () => {
    const f = await fixture(); await assert.rejects(() => postPluginUiCaptureGrant(f.request(), { ...f.env, UI_CAPTURE_ENABLED: 'false' }), { code: 'UI_CAPTURE_DISABLED' });
    const disabled = await fixture([variable({ enabled: false })]); await assert.rejects(() => postPluginUiCaptureGrant(disabled.request(), disabled.env), { code: 'UI_ENVIRONMENT_CAPTURE_DISABLED' });
});

test('FULL_TEST centrally widens functional evidence without authorizing credentials', () => {
    const value = buildUiCaptureConfiguration(opts({ variables: [variable({ mode: 'FULL_TEST', networkPaths: ['/api/'] })] }));
    assert.equal(value.policy.mode, 'FULL_TEST');
    assert.deepEqual(value.policy.publicTextSelectors, ['body']);
    assert.equal(value.policy.valueSelectors.length, 1);
    assert.deepEqual(value.policy.screenshotSelectors, ['body']);
    assert.ok(value.policy.maskSelectors.some(x => x.includes('password')));
    assert.throws(() => buildUiCaptureConfiguration(opts({ variables: [variable({ mode: 'UNSAFE_OFF' })] })), { code: 'UI_ENVIRONMENT_POLICY_INVALID' });
});

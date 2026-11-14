import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postPluginUiCaptureGrant } from '../src/handlers/pluginUiCaptureGrant.js';
import { buildUiCaptureConfiguration, UI_CAPTURE_POLICY_VARIABLE } from '../src/ui/uiCaptureConfigurationService.js';
import { uiCapturePolicyHash } from '../src/ui/uiCapturePolicyBinding.js';
import { getObservationUiCapabilities } from '../src/ui/observationUiCapabilitiesClient.js';
import { UI_PAGE_ENVIRONMENT_REVISION, validateUiGrantClaims, verifyUiCaptureGrantToken } from '../src/ui/uiCaptureGrantToken.js';
import { gatewayPageFixture, pageCapabilities, PC3_ENVIRONMENT, PC3_REVISION } from './helpers/uiPageObservedFixture.mjs';

const revision = UI_PAGE_ENVIRONMENT_REVISION;
const managedCapabilities = (patch = {}) => pageCapabilities({ revision, captureDataOrigins: ['OBSERVED_ENVIRONMENT_MANAGED'],
    capabilities: pageCapabilities().capabilities.filter(x => x !== 'MASKED_SCREENSHOTS').concat('ENVIRONMENT_MANAGED_TEST_DATA'), ...patch });
const fixture = options => gatewayPageFixture({ capabilities: managedCapabilities(), ...options });
const issue = (f, patch = {}) => postPluginUiCaptureGrant(f.request({ contractRevision: revision, ...patch }), f.env);

test('PC3 r2 signs the environment-managed FULL_TEST profile for persisted DEV and STG', async () => {
    for (const environmentType of ['DEV', 'STG']) {
        const f = await fixture({ environment: { environmentType }, policy: { mode: 'FULL_TEST', networkPaths: ['/api/'],
            businessHeaderNames: ['authorization', 'cookie', 'x-api-key', 'x-csrf-token'], maskSelectors: ['[data-private]'] } });
        const result = await issue(f), policy = result.captureConfiguration.policy;
        const claims = await verifyUiCaptureGrantToken(f.env, result.grant.token);
        assert.equal(claims.contractRevision, revision);
        assert.equal(policy.mode, 'FULL_TEST');
        assert.equal(policy.dataProtection, 'ENVIRONMENT_MANAGED');
        assert.deepEqual(policy.maskSelectors, []);
        assert.deepEqual(policy.publicTextSelectors, ['body']);
        assert.deepEqual(policy.valueSelectors, ['input:not([type="file"]),textarea,select']);
        assert.deepEqual(policy.screenshotSelectors, ['body']);
        assert.deepEqual(policy.businessHeaderNames, ['authorization', 'cookie', 'x-api-key', 'x-csrf-token']);
        assert.deepEqual(policy.networkPaths, ['/api/']);
        assert.equal(claims.capturePolicyHash, await uiCapturePolicyHash(policy));
        assert.equal(claims.organizationId, 'org_control');
        assert.deepEqual(claims.origins, ['https://app.example.test']);
        assert.deepEqual(claims.capabilities, ['ui:capture:create']);
        assert.equal(new URL(f.capabilityRequests[0].url).searchParams.get('revision'), revision);
    }
});

test('PC3 r2 uses the persisted environment type, never a DEV/STG name or host', async () => {
    for (const environmentType of ['QA', 'PROD', 'CUSTOM', '', undefined]) {
        const f = await fixture({ environment: { environmentType, name: 'DEV', webBaseUrl: 'https://stg.example.test' } });
        await assert.rejects(() => issue(f), { code: 'UI_CONFIGURATION_MODE_UNSUPPORTED', status: 409 });
        assert.equal(f.capabilityRequests.length, 0);
    }
});

test('PC3 r2 cannot enable PROTECTED/default environments or caller-defined configuration', async () => {
    for (const policy of [null, { mode: 'PROTECTED' }]) {
        const f = await fixture({ policy });
        await assert.rejects(() => issue(f), { code: 'UI_CONFIGURATION_MODE_UNSUPPORTED' });
    }
    const f = await fixture();
    for (const patch of [{ environmentType: 'DEV' }, { dataProtection: 'ENVIRONMENT_MANAGED' }, { policy: { mode: 'FULL_TEST' } },
        { organizationId: 'org_other' }, { capturePolicyHash: '0'.repeat(64) }])
        await assert.rejects(() => issue(f, patch), { code: 'UI_INPUT_INVALID' });
    for (const configurationMode of [undefined, 'LOCAL'])
        await assert.rejects(() => issue(f, { configurationMode }), { code: 'UI_CONFIGURATION_MODE_UNSUPPORTED' });
});

test('PC3 r2 preserves global/environment disable, entitlement and structural scope limits', async () => {
    const disabled = await fixture({ env: { UI_CAPTURE_ENABLED: 'false' } });
    await assert.rejects(() => issue(disabled), { code: 'UI_CAPTURE_DISABLED' });
    const localDisabled = await fixture({ policy: { mode: 'FULL_TEST', enabled: false } });
    await assert.rejects(() => issue(localDisabled), { code: 'UI_ENVIRONMENT_CAPTURE_DISABLED' });
    const expired = await fixture({ license: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    await assert.rejects(() => issue(expired));
    assert.equal(expired.capabilityRequests.length, 0);
    for (const setting of [{ networkPaths: ['//outside.example.test'] }, { networkPaths: ['/../api'] },
        { businessHeaderNames: ['authorization\r\ninjected'] }, { businessHeaderNames: Array(17).fill('authorization') },
        { maskSelectors: 'body' }, { publicTextSelectors: ['<script>'] }]) {
        const f = await fixture({ policy: { mode: 'FULL_TEST', ...setting } });
        await assert.rejects(() => issue(f), { code: 'UI_ENVIRONMENT_POLICY_INVALID' });
    }
});

test('PC3 r2 policy authority includes dataProtection and cannot be removed or forged', async () => {
    const f = await fixture(), result = await issue(f);
    const claims = await verifyUiCaptureGrantToken(f.env, result.grant.token);
    const { capturePolicyHash, ...missing } = claims;
    assert.throws(() => validateUiGrantClaims(missing), { code: 'UI_GRANT_INVALID' });
    assert.throws(() => validateUiGrantClaims({ ...claims, capturePolicyHash: 'bad' }), { code: 'UI_GRANT_INVALID' });
    const { dataProtection, ...oldPolicy } = result.captureConfiguration.policy;
    assert.notEqual(capturePolicyHash, await uiCapturePolicyHash(oldPolicy));
    const parts = result.grant.token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...claims, capturePolicyHash: await uiCapturePolicyHash(oldPolicy) })).toString('base64url');
    await assert.rejects(() => verifyUiCaptureGrantToken(f.env, parts.join('.')), { code: 'UI_GRANT_INVALID' });
});

test('PC3 r2 requires explicit managed origin/capability, inert storage and durable ingestion', async () => {
    const caps = managedCapabilities();
    const get = patch => getObservationUiCapabilities({ OBSERVATION_SERVICE: { fetch: async () => Response.json(managedCapabilities(patch)) } }, 'UI_CAPTURE', revision);
    assert.equal((await get({})).capabilities.includes('MASKED_SCREENSHOTS'), false);
    for (const patch of [{ captureDataOrigins: ['OBSERVED_SANITIZED'] }, { captureEnabled: false },
        { capabilities: caps.capabilities.filter(x => x !== 'ENVIRONMENT_MANAGED_TEST_DATA') },
        { capabilities: caps.capabilities.filter(x => x !== 'PRIVATE_INERT_STORAGE') },
        { ingestion: { ...caps.ingestion, enabled: false } }])
        await assert.rejects(() => get(patch), { code: 'UI_CAPTURE_UNAVAILABLE' });
    await assert.rejects(() => get({ revision: PC3_REVISION }), { code: 'UI_SERVICE_CAPABILITY_MISMATCH' });
});

test('historical A2/r1 configuration and grants do not inherit the r2 profile', async () => {
    const variables = [{ variableKey: UI_CAPTURE_POLICY_VARIABLE, valueType: 'JSON', variableValue: JSON.stringify({ mode: 'FULL_TEST' }) }];
    const input = { projectId: PC3_ENVIRONMENT.projectId, environment: PC3_ENVIRONMENT, variables };
    const existing = buildUiCaptureConfiguration(input);
    for (const contractRevision of ['08.2-A.2.r1', PC3_REVISION]) {
        const old = buildUiCaptureConfiguration({ ...input, contractRevision });
        assert.deepEqual(old, existing);
        assert.equal(old.policy.dataProtection, undefined);
        assert.ok(old.policy.maskSelectors.includes('input[type="password"]'));
        assert.ok(old.policy.valueSelectors[0].includes(':not([type="hidden"])'));
    }
    const r1 = await gatewayPageFixture(), result = await postPluginUiCaptureGrant(r1.request(), r1.env);
    assert.equal(result.captureConfiguration.policy.dataProtection, undefined);
    const headers = await gatewayPageFixture({ policy: { mode: 'FULL_TEST', businessHeaderNames: ['authorization'] } });
    await assert.rejects(() => postPluginUiCaptureGrant(headers.request(), headers.env), { code: 'UI_ENVIRONMENT_POLICY_INVALID' });
});

test('PC3 r2 historical read remains independent of current capture policy/type/enablement', async () => {
    const f = await fixture({ environment: { environmentType: 'PROD' }, policy: null, env: { UI_CAPTURE_ENABLED: 'false' },
        capabilities: managedCapabilities({ captureEnabled: false, captureDataOrigins: [], capabilities: [], ingestion: { enabled: false } }) });
    const result = await issue(f, { purpose: 'UI_ARTIFACT_READ', configurationMode: undefined });
    const claims = await verifyUiCaptureGrantToken(f.env, result.grant.token);
    assert.equal(claims.contractRevision, revision);
    assert.equal(claims.capturePolicyHash, undefined);
    assert.deepEqual(claims.capabilities, ['ui:artifact:read']);
    assert.equal(result.captureConfiguration, undefined);
    assert.equal(f.calls.some(c => /environment_variables/i.test(c.sql)), false);
});

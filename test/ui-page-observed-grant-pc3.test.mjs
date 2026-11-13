import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { postPluginUiCaptureGrant } from '../src/handlers/pluginUiCaptureGrant.js';
import { canonicalUiCapturePolicy, uiCapturePolicyHash } from '../src/ui/uiCapturePolicyBinding.js';
import { getObservationUiCapabilities } from '../src/ui/observationUiCapabilitiesClient.js';
import { validateUiGrantClaims, verifyUiCaptureGrantToken } from '../src/ui/uiCaptureGrantToken.js';
import { gatewayPageFixture, pageCapabilities, PC3_REVISION } from './helpers/uiPageObservedFixture.mjs';

const queryCapabilities = caps => getObservationUiCapabilities({ OBSERVATION_SERVICE: { fetch: async () => Response.json(caps) } }, 'UI_CAPTURE', PC3_REVISION);

test('PC3 actual handler binds the existing session, environment policy and origin in a signed grant', async () => {
    const f = await gatewayPageFixture();
    const result = await postPluginUiCaptureGrant(f.request(), f.env);
    const claims = await verifyUiCaptureGrantToken(f.env, result.grant.token);
    assert.equal(claims.contractRevision, PC3_REVISION);
    assert.equal(claims.purpose, 'UI_CAPTURE');
    assert.equal(claims.organizationId, 'org_control');
    assert.equal(claims.projectId, 'prj_control');
    assert.equal(claims.environmentId, 'env_control');
    assert.equal(claims.pluginSessionId, 'psn_control');
    assert.deepEqual(claims.origins, ['https://app.example.test']);
    assert.equal(result.captureConfiguration.policy.mode, 'FULL_TEST');
    assert.equal(claims.capturePolicyHash, await uiCapturePolicyHash(result.captureConfiguration.policy));
    assert.deepEqual(claims.capabilities, ['ui:capture:create']);
    assert.equal(new URL(f.capabilityRequests[0].url).searchParams.get('revision'), PC3_REVISION);
    assert.equal(f.capabilityRequests[0].redirect, 'manual');
    assert.equal(f.capabilityRequests.length, 1);
});

test('PC3 policy digest agrees with a fixed canonical UTF-16 JSON vector', async () => {
    const input = { z: ['b', 'a'], a: { mode: 'FULL_TEST', mask: ['#private'], n: -0 } };
    const expected = '{"a":{"mask":["#private"],"mode":"FULL_TEST","n":0},"z":["b","a"]}';
    assert.equal(canonicalUiCapturePolicy(input), expected);
    assert.equal(await uiCapturePolicyHash(input), createHash('sha256').update(expected).digest('hex'));
    assert.equal(await uiCapturePolicyHash({ a: input.a, z: input.z }), await uiCapturePolicyHash(input));
    assert.notEqual(await uiCapturePolicyHash({ ...input, z: ['a', 'b'] }), await uiCapturePolicyHash(input));
    for (const bad of [{ x: '\ud800' }, { x: NaN }, { x: undefined }, { x: new Array(2) }, JSON.parse('{"__proto__":{}}')])
        assert.throws(() => canonicalUiCapturePolicy(bad), { code: 'UI_ENVIRONMENT_POLICY_INVALID' });
});

test('PC3 grants require a policy hash and reject signature tampering', async () => {
    const f = await gatewayPageFixture(), result = await postPluginUiCaptureGrant(f.request(), f.env);
    const claims = await verifyUiCaptureGrantToken(f.env, result.grant.token);
    const { capturePolicyHash, ...missing } = claims;
    assert.throws(() => validateUiGrantClaims(missing), { code: 'UI_GRANT_INVALID' });
    assert.throws(() => validateUiGrantClaims({ ...claims, capturePolicyHash: 'invalid' }), { code: 'UI_GRANT_INVALID' });
    const parts = result.grant.token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...claims, capturePolicyHash: '0'.repeat(64) })).toString('base64url');
    await assert.rejects(() => verifyUiCaptureGrantToken(f.env, parts.join('.')), { code: 'UI_GRANT_INVALID' });
});

test('PC3 cannot be selected without server-managed configuration', async () => {
    const f = await gatewayPageFixture();
    for (const configurationMode of [undefined, 'LOCAL'])
        await assert.rejects(() => postPluginUiCaptureGrant(f.request({ configurationMode }), f.env), { code: 'UI_CONFIGURATION_MODE_UNSUPPORTED' });
});

test('PC3 leaves PROTECTED/default environments eligible for explicit A2 fallback', async () => {
    for (const policy of [null, { mode: 'PROTECTED', networkPaths: ['/api/'] }]) {
        const f = await gatewayPageFixture({ policy });
        await assert.rejects(() => postPluginUiCaptureGrant(f.request(), f.env), { code: 'UI_CONFIGURATION_MODE_UNSUPPORTED', status: 409 });
    }
});

test('PC3 cannot widen policy, tenant or purpose through caller-supplied fields', async () => {
    const f = await gatewayPageFixture();
    for (const patch of [{ policy: { mode: 'FULL_TEST' } }, { capturePolicyHash: '0'.repeat(64) }, { organizationId: 'org_other' }, { origins: ['https://outside.example.test'] }])
        await assert.rejects(() => postPluginUiCaptureGrant(f.request(patch), f.env), { code: 'UI_INPUT_INVALID' });
    await assert.rejects(() => postPluginUiCaptureGrant(f.request({ purpose: 'UI_CAPTURE_SESSION' }), f.env), { code: 'UI_PURPOSE_REQUIRED' });
});

test('PC3 retains global/environment disable, license and hard-denied header gates', async () => {
    const disabled = await gatewayPageFixture({ env: { UI_CAPTURE_ENABLED: 'false' } });
    await assert.rejects(() => postPluginUiCaptureGrant(disabled.request(), disabled.env), { code: 'UI_CAPTURE_DISABLED' });
    assert.equal(disabled.capabilityRequests.length, 0);
    const localDisabled = await gatewayPageFixture({ policy: { mode: 'FULL_TEST', enabled: false } });
    await assert.rejects(() => postPluginUiCaptureGrant(localDisabled.request(), localDisabled.env), { code: 'UI_ENVIRONMENT_CAPTURE_DISABLED' });
    const expired = await gatewayPageFixture({ license: { expiresAt: new Date(Date.now() - 1000).toISOString() } });
    await assert.rejects(() => postPluginUiCaptureGrant(expired.request(), expired.env));
    assert.equal(expired.capabilityRequests.length, 0);
    const secretHeader = await gatewayPageFixture({ policy: { mode: 'FULL_TEST', businessHeaderNames: ['authorization'] } });
    await assert.rejects(() => postPluginUiCaptureGrant(secretHeader.request(), secretHeader.env), { code: 'UI_ENVIRONMENT_POLICY_INVALID' });
});

test('PC3 requires observed evidence support and durable async ingestion before issuing a write grant', async () => {
    const caps = pageCapabilities();
    for (const patch of [
        { captureEnabled: false }, { captureDataOrigins: ['SYNTHETIC_CONTROL'] },
        { artifactKinds: caps.artifactKinds.filter(x => x !== 'HTTP_RESPONSE_BODY') },
        { artifactContentTypes: ['application/json'] },
        { capabilities: caps.capabilities.filter(x => x !== 'PRIVATE_INERT_STORAGE') },
        { ingestion: { ...caps.ingestion, enabled: false } },
        { ingestion: { ...caps.ingestion, durability: 'BUFFERED_IN_MEMORY' } },
        { ingestion: { ...caps.ingestion, receiptVersion: 'future' } },
    ]) await assert.rejects(() => queryCapabilities(pageCapabilities(patch)), { code: 'UI_CAPTURE_UNAVAILABLE' });
});

test('PC3 refuses a synthetic/legacy revision or incomplete v2 contract', async () => {
    const caps = pageCapabilities();
    for (const patch of [
        { revision: '08.2-PC.2.r1' }, { revision: '08.2-A.2.r1' }, { status: 'degraded' },
        { contracts: caps.contracts.filter(x => x !== 'qagent.ui-checkpoint.v2') },
    ]) await assert.rejects(() => queryCapabilities(pageCapabilities(patch)), { code: 'UI_SERVICE_CAPABILITY_MISMATCH' });
});

test('PC3 accepts reduced server limits and refuses limits outside the negotiated contract', async () => {
    const caps = pageCapabilities();
    const reduced = { ...caps.limits, artifactBytes: 2097152, captureArtifactBytes: 33554432, artifactsPerCapture: 128 };
    assert.deepEqual((await queryCapabilities(pageCapabilities({ limits: reduced }))).limits, reduced);
    for (const change of [{ artifactBytes: 16777217 }, { artifactsPerCapture: 513 }, { captureArtifactBytes: 0 }, { artifactBytes: 3.5 }, { batchEvents: 101 }, { captureArtifactBytes: 1000 }])
        await assert.rejects(() => queryCapabilities(pageCapabilities({ limits: { ...caps.limits, ...change } })), { code: 'UI_SERVICE_CAPABILITY_MISMATCH' });
});

test('PC3 read grants remain available with capture disabled and contain no write policy authority', async () => {
    const f = await gatewayPageFixture({ env: { UI_CAPTURE_ENABLED: 'false' }, policy: null, capabilities: pageCapabilities({ captureEnabled: false, captureDataOrigins: [], ingestion: { enabled: false } }) });
    const result = await postPluginUiCaptureGrant(f.request({ purpose: 'UI_ARTIFACT_READ', configurationMode: undefined }), f.env);
    const claims = await verifyUiCaptureGrantToken(f.env, result.grant.token);
    assert.deepEqual(claims.capabilities, ['ui:artifact:read']);
    assert.equal(claims.capturePolicyHash, undefined);
    assert.equal(result.captureConfiguration, undefined);
    assert.equal(f.calls.some(c => /environment_variables/i.test(c.sql)), false);
    await assert.rejects(() => queryCapabilities(pageCapabilities({ readEnabled: false })), { code: 'UI_STORAGE_OR_SCHEMA_UNAVAILABLE' });
});

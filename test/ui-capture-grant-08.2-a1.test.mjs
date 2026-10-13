import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postPluginUiCaptureGrant } from '../src/handlers/pluginUiCaptureGrant.js';
import { verifyUiCaptureGrantToken } from '../src/ui/uiCaptureGrantToken.js';
import { postPluginObservationGrant } from '../src/handlers/pluginObservationGrant.js';
import { hashAccessToken } from '../src/lib/keyService.js';
import { verifyObservationGrantToken } from '../src/security/observationGrantToken.js';
class MemoryKv {
    constructor(entries = {}) {
        this.entries = new Map(Object.entries(entries));
    }
    async get(key) {
        return this.entries.get(key) ?? null;
    }
    async put(key, value) {
        this.entries.set(key, value);
    }
}
class MemoryD1 {
    constructor({ organizations = [], projects = [], environments = [] } = {}) {
        this.organizations = organizations;
        this.projects = projects;
        this.environments = environments;
    }
    prepare(sql) {
        const db = this;
        return {
            bind(...params) {
                return {
                    async first() {
                        if (/FROM\s+organizations/i.test(sql) && /organization_id\s*=\s*\?/i.test(sql)) {
                            const [organizationId] = params;
                            return db.organizations.find((row) => row.organizationId === organizationId) || null;
                        }
                        if (/FROM\s+projects/i.test(sql) && /project_id\s*=\s*\?/i.test(sql)) {
                            const [organizationId, projectId] = params;
                            return db.projects.find((row) => (row.organizationId === organizationId
                                && row.projectId === projectId
                                && (sql.includes("status = 'active'") ? row.status === 'active' : true))) || null;
                        }
                        if (/FROM\s+environments/i.test(sql) && /environment_id\s*=\s*\?/i.test(sql)) {
                            const [organizationId, projectId, environmentId] = params;
                            return db.environments.find((row) => (row.organizationId === organizationId
                                && row.projectId === projectId
                                && row.environmentId === environmentId
                                && (sql.includes("status = 'active'") ? row.status === 'active' : true))) || null;
                        }
                        return null;
                    },
                };
            },
        };
    }
}
const GRANT_SECRET = 'test-observation-grant-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const organizationId = 'org_acme-123';
const projectId = 'prj_checkout-123';
const environmentId = 'env_stg-123';
const otherProjectId = 'prj_other-456';
const otherEnvironmentId = 'env_other-456';
const qps = `qps_${'S'.repeat(48)}`;
const qpsHash = await hashAccessToken(qps);
const keyHash = `sha256:${'a'.repeat(64)}`;
const pluginSessionId = 'psn_12345678-1234-1234-1234-123456789abc';
function makeEnv(overrides = {}) {
    const now = Date.now();
    return {
        QAGENT_KV: new MemoryKv({
            [`plugin_session:${qpsHash}`]: JSON.stringify({
                tokenHash: qpsHash,
                pluginSessionId,
                keyHash,
                customerId: 'cus_acme',
                organizationId,
                issuedAt: new Date(now - 10000).toISOString(),
                expiresAt: new Date(now + 10 * 60000).toISOString(),
                pluginVersion: '2.0.4',
            }),
            [`license:${keyHash}`]: JSON.stringify({
                licenseId: 'lic_acme',
                customerId: 'cus_acme',
                status: 'active',
                plan: 'pro',
                expiresAt: new Date(now + 24 * 60 * 60000).toISOString(),
            }),
        }),
        QAGENT_DB: new MemoryD1({
            organizations: [{
                    organizationId,
                    legacyCustomerId: 'cus_acme',
                    name: 'Acme',
                    status: 'active',
                }],
            projects: [
                { projectId, organizationId, name: 'Checkout', slug: 'checkout', status: 'active' },
                { projectId: otherProjectId, organizationId, name: 'Other', slug: 'other', status: 'active' },
            ],
            environments: [
                {
                    environmentId,
                    organizationId,
                    projectId,
                    name: 'STG',
                    slug: 'stg',
                    environmentType: 'STG',
                    webBaseUrl: 'https://app.example.test',
                    status: 'active',
                    isDefault: 1,
                },
                {
                    environmentId: otherEnvironmentId,
                    organizationId,
                    projectId: otherProjectId,
                    name: 'DEV',
                    slug: 'dev',
                    environmentType: 'DEV',
                    status: 'active',
                    isDefault: 1,
                },
            ],
        }),
        OBSERVATION_GRANT_SECRET: GRANT_SECRET,
        OBSERVATION_GRANT_TTL_SECONDS: '120',
        UI_CAPTURE_ENABLED: 'true',
        OBSERVATION_SERVICE: { fetch: async () => new Response(JSON.stringify(capabilities()), { headers: { 'Content-Type': 'application/json' } }) },
        ...overrides,
    };
}
function request(body, token = qps) {
    return new Request('https://api.apiqagent.com/v1/plugin/observation-grants', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}
async function expectFailure(req, env, status, code) {
    try {
        await postPluginObservationGrant(req, env);
        assert.fail(`Expected ${code} failure`);
    }
    catch (error) {
        assert.equal(error.status, status);
        assert.equal(error.code, code);
    }
}
function capabilities() {
    return { contractVersion: 'qagent.ui-capabilities.v1', revision: '08.2-A.1.r1', captureEnabled: true, readEnabled: true,
        contracts: ['qagent.ui-capture.v1', 'qagent.ui-capture-events.v1', 'qagent.ui-artifact.v1'], captureDataOrigins: ['SYNTHETIC_CONTROL'], artifactContentTypes: ['application/json'],
        limits: { artifactBytes: 1048576, artifactsPerCapture: 128, captureArtifactBytes: 67108864, eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000, captureEventBytes: 8388608, controlBytes: 32768, sessionSeconds: 900 } };
}
const input = () => ({ projectId, environmentId, purpose: 'UI_CAPTURE', contractRevision: '08.2-A.1.r1' });
test('A01 valid Plugin session resolves server scope and domain-separated grant', async () => {
    const e = makeEnv();
    const r = await postPluginUiCaptureGrant(request(input()), e);
    const p = await verifyUiCaptureGrantToken(e, r.grant.token);
    assert.equal(p.organizationId, organizationId);
    assert.equal(p.purpose, 'UI_CAPTURE');
    assert.deepEqual(p.origins, ['https://app.example.test']);
    assert.deepEqual(p.capabilities, ['ui:capture:create']);
    assert.equal(p.aud, 'qagent-observation-ui');
    assert.ok(p.authorityExpiresAt <= Math.floor(Date.now() / 1000) + 600);
    assert.equal((await verifyObservationGrantToken(e, r.grant.token)).ok, false);
});
test('A02 body tenant, mismatched environment and extra origins refused', async () => {
    for (const change of [{ organizationId: 'org_other' }, { origins: ['https://other.test'] }, { environmentId: otherEnvironmentId }])
        await assert.rejects(() => postPluginUiCaptureGrant(request({ ...input(), ...change }), makeEnv()));
});
test('A01 API grant cannot authenticate at new grant endpoint', async () => { const e = makeEnv(); const api = await postPluginObservationGrant(request({ projectId, environmentId }), e); await assert.rejects(() => postPluginUiCaptureGrant(request(input(), api.grant.token), e)); });
test('A01 capture flag defaults off; API-only grant remains available', async () => {
    const e = makeEnv({ UI_CAPTURE_ENABLED: undefined });
    await assert.rejects(() => postPluginUiCaptureGrant(request(input()), e), { code: 'UI_CAPTURE_DISABLED' });
    assert.equal((await postPluginObservationGrant(request({ projectId, environmentId }), e)).status, 'ok');
});
test('A02 fresh read-only authority remains possible with capture off', async () => { const e = makeEnv({ UI_CAPTURE_ENABLED: 'false' }); const r = await postPluginUiCaptureGrant(request({ ...input(), purpose: 'UI_ARTIFACT_READ' }), e); assert.equal((await verifyUiCaptureGrantToken(e, r.grant.token)).purpose, 'UI_ARTIFACT_READ'); });
test('A01 expired license refuses UI grant', async () => { const e = makeEnv(); await e.QAGENT_KV.put(`license:${keyHash}`, JSON.stringify({ status: 'active', plan: 'pro', expiresAt: new Date(Date.now() - 1000).toISOString() })); await assert.rejects(() => postPluginUiCaptureGrant(request(input()), e), { code: 'UI_AUTHORITY_EXPIRED' }); });
test('A05 incompatible consumer or absent storage refuses grant', async () => {
    for (const c of [{ ...capabilities(), revision: 'future' }, { ...capabilities(), readEnabled: false }, { ...capabilities(), limits: {} }]) {
        const e = makeEnv({ OBSERVATION_SERVICE: { fetch: async () => new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } }) } });
        await assert.rejects(() => postPluginUiCaptureGrant(request(input()), e));
    }
});

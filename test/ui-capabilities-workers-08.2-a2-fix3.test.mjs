import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getObservationUiCapabilities } from '../src/ui/observationUiCapabilitiesClient.js';
import { UI_REVISION, UI_OBSERVED_REVISION } from '../src/ui/uiCaptureGrantToken.js';

// Node supports redirect:error. This focused compatibility double models only
// workerd's Request redirect validation; it is NOT the Workers runtime.
// Source: cloudflare/workerd, src/workerd/api/http.c++, Request::tryParseRedirect.
const NativeRequest = globalThis.Request;
class WorkersRedirectRequest extends NativeRequest {
    constructor(input, init) {
        const mode = init?.redirect;
        if (mode !== undefined && !['follow', 'manual'].includes(String(mode).toLowerCase())) {
            throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
        }
        super(input, init);
    }
}
function capabilities(revision = UI_OBSERVED_REVISION) {
    const observed = revision === UI_OBSERVED_REVISION;
    return {
        status: 'ok', contractVersion: 'qagent.ui-capabilities.v1', revision,
        contracts: ['qagent.ui-capture.v1', 'qagent.ui-capture-events.v1', 'qagent.ui-artifact.v1'],
        readEnabled: true, captureEnabled: true,
        captureDataOrigins: observed ? ['SYNTHETIC_CONTROL', 'OBSERVED_SANITIZED'] : ['SYNTHETIC_CONTROL'],
        artifactContentTypes: observed ? ['application/json', 'image/png'] : ['application/json'],
        capabilities: observed ? ['OBSERVED_CAPTURE', 'MASKED_SCREENSHOTS'] : ['CAPTURE_CONTRACTS'],
        limits: { artifactBytes: 1048576, artifactsPerCapture: 128, captureArtifactBytes: 67108864,
            eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000,
            captureEventBytes: 8388608, controlBytes: 32768, sessionSeconds: 900 },
    };
}
function isolated(t) {
    t.mock.method(globalThis, 'Request', WorkersRedirectRequest);
    const publicFetch = t.mock.method(globalThis, 'fetch', () => {
        throw new Error('Unexpected public fetch: no fallback is permitted');
    });
    return publicFetch;
}

test('FIX3 original unsupported Request value is rejected before a binding can run (compatibility model)', () => {
    let reachedBinding = false;
    const binding = { fetch() { reachedBinding = true; } };
    assert.throws(() => binding.fetch(new WorkersRedirectRequest('https://qagent-observation/v1/ui/capabilities',
        { method: 'GET', redirect: 'error' })), { name: 'TypeError' });
    assert.equal(reachedBinding, false);
});

for (const revision of [UI_REVISION, UI_OBSERVED_REVISION]) {
    test(`FIX3 ${revision} uses manual redirects over the existing binding`, async t => {
        const publicFetch = isolated(t);
        let calls = 0;
        const expected = capabilities(revision);
        const result = await getObservationUiCapabilities({ OBSERVATION_SERVICE: { async fetch(request) {
            calls++;
            assert.equal(request.redirect, 'manual');
            assert.equal(request.method, 'GET');
            const url = new URL(request.url);
            assert.equal(url.origin, 'https://qagent-observation');
            assert.equal(url.pathname, '/v1/ui/capabilities');
            assert.equal(url.searchParams.get('revision'), revision === UI_REVISION ? null : revision);
            assert.equal(request.headers.has('authorization'), false);
            return Response.json(expected);
        } } }, 'UI_CAPTURE', revision);
        assert.deepEqual(result, expected);
        assert.equal(calls, 1);
        assert.equal(publicFetch.mock.callCount(), 0);
    });
}

for (const status of [301, 302, 303, 307, 308]) {
    test(`FIX3 redirect ${status} is rejected, never followed, and no grant capability is returned`, async t => {
        const publicFetch = isolated(t);
        let calls = 0;
        const binding = { async fetch(request) {
            calls++;
            assert.equal(request.redirect, 'manual');
            return new Response(null, { status, headers: {
                location: 'https://must-not-be-called.invalid/elsewhere',
                'content-type': 'application/json',
            } });
        } };
        await assert.rejects(() => getObservationUiCapabilities({ OBSERVATION_SERVICE: binding }, 'UI_CAPTURE', UI_OBSERVED_REVISION),
            { code: 'UI_SERVICE_CAPABILITY_MISMATCH', status: 503 });
        assert.equal(calls, 1);
        assert.equal(publicFetch.mock.callCount(), 0);
    });
}

test('FIX3 disabled capture still refuses while historical read stays authorized by capability', async t => {
    const publicFetch = isolated(t);
    const c = { ...capabilities(), captureEnabled: false };
    const env = { OBSERVATION_SERVICE: { async fetch() { return Response.json(c); } } };
    await assert.rejects(() => getObservationUiCapabilities(env, 'UI_CAPTURE', UI_OBSERVED_REVISION), { code: 'UI_CAPTURE_UNAVAILABLE' });
    assert.deepEqual(await getObservationUiCapabilities(env, 'UI_ARTIFACT_READ', UI_OBSERVED_REVISION), c);
    assert.equal(publicFetch.mock.callCount(), 0);
});

test('FIX3 storage/schema not ready remains fail-closed', async t => {
    isolated(t);
    await assert.rejects(() => getObservationUiCapabilities({ OBSERVATION_SERVICE: {
        async fetch() { return Response.json({ ...capabilities(), readEnabled: false }); },
    } }, 'UI_CAPTURE', UI_OBSERVED_REVISION), { code: 'UI_STORAGE_OR_SCHEMA_UNAVAILABLE' });
});

test('FIX3 absent binding remains unavailable without a public fallback', async t => {
    const publicFetch = isolated(t);
    await assert.rejects(() => getObservationUiCapabilities({}, 'UI_CAPTURE', UI_OBSERVED_REVISION), { code: 'UI_SERVICE_UNAVAILABLE' });
    assert.equal(publicFetch.mock.callCount(), 0);
});

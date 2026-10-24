import { UI_REVISION, UI_OBSERVED_REVISION, UI_REVISIONS } from './uiCaptureGrantToken.js';
const CONTRACTS = ['qagent.ui-capture.v1', 'qagent.ui-capture-events.v1', 'qagent.ui-artifact.v1'];
const EXPECTED_LIMITS = { artifactBytes: 1048576, artifactsPerCapture: 128, captureArtifactBytes: 67108864, eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000, captureEventBytes: 8388608, controlBytes: 32768, sessionSeconds: 900 };
const err = code => Object.assign(new Error(code), { code, status: 503 });
export async function getObservationUiCapabilities(env, purpose, revision = UI_REVISION) {
    if(!UI_REVISIONS.includes(revision)) throw err('UI_SERVICE_CAPABILITY_MISMATCH');
    if (!env.OBSERVATION_SERVICE?.fetch)
        throw err('UI_SERVICE_UNAVAILABLE');
    const controller = new AbortController();
    let timer;
    try {
        const operation = (async () => {
            const response = await env.OBSERVATION_SERVICE.fetch(new Request(`https://qagent-observation/v1/ui/capabilities${revision===UI_REVISION?'':'?revision='+encodeURIComponent(revision)}`, { method: 'GET', signal: controller.signal, redirect: 'error' }));
            if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
                throw err('UI_SERVICE_CAPABILITY_MISMATCH');
            const reader = response.body?.getReader();
            if (!reader)
                throw err('UI_SERVICE_CAPABILITY_MISMATCH');
            let text = '', bytes = 0;
            const decoder = new TextDecoder('utf-8', { fatal: true });
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    bytes += part.value.length;
                    if (bytes > 16384) {
                        await reader.cancel();
                        throw err('UI_SERVICE_CAPABILITY_MISMATCH');
                    }
                    text += decoder.decode(part.value, { stream: true });
                }
                text += decoder.decode();
            }
            finally {
                reader.releaseLock();
            }
            const c = JSON.parse(text);
            if (c.contractVersion !== 'qagent.ui-capabilities.v1' || c.revision !== revision || CONTRACTS.some(v => !c.contracts?.includes(v)) || Object.entries(EXPECTED_LIMITS).some(([k, v]) => c.limits?.[k] !== v))
                throw err('UI_SERVICE_CAPABILITY_MISMATCH');
            if (c.readEnabled !== true)
                throw err('UI_STORAGE_OR_SCHEMA_UNAVAILABLE');
            const origins = revision === UI_OBSERVED_REVISION ? ['SYNTHETIC_CONTROL','OBSERVED_SANITIZED'] : ['SYNTHETIC_CONTROL'];
            const types = revision === UI_OBSERVED_REVISION ? ['application/json','image/png'] : ['application/json'];
            if (purpose === 'UI_CAPTURE' && (c.captureEnabled !== true || JSON.stringify(c.captureDataOrigins) !== JSON.stringify(origins) || JSON.stringify(c.artifactContentTypes) !== JSON.stringify(types) || (revision === UI_OBSERVED_REVISION && (!c.capabilities?.includes('OBSERVED_CAPTURE') || !c.capabilities?.includes('MASKED_SCREENSHOTS')))))
                throw err('UI_CAPTURE_UNAVAILABLE');
            return c;
        })();
        return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(err('UI_SERVICE_TIMEOUT')); }, 1500); })]);
    }
    catch (e) {
        if (e?.code?.startsWith('UI_'))
            throw e;
        throw err('UI_SERVICE_UNAVAILABLE');
    }
    finally {
        clearTimeout(timer);
    }
}

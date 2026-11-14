import { UI_REVISION, UI_OBSERVED_REVISION, UI_PAGE_OBSERVED_REVISION, UI_PAGE_ENVIRONMENT_REVISION, UI_REVISIONS } from './uiCaptureGrantToken.js';
const CONTRACTS = ['qagent.ui-capture.v1', 'qagent.ui-capture-events.v1', 'qagent.ui-artifact.v1'];
const EXPECTED_LIMITS = { artifactBytes: 1048576, artifactsPerCapture: 128, captureArtifactBytes: 67108864, eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000, captureEventBytes: 8388608, controlBytes: 32768, sessionSeconds: 900 };
const PAGE_CONTRACTS = ['qagent.ui-capture.v2', 'qagent.ui-capture-events.v2', 'qagent.ui-artifact.v2', 'qagent.ui-action.v2', 'qagent.ui-interaction.v2', 'qagent.ui-checkpoint.v2'];
const PAGE_LIMITS = { artifactBytes: 16777216, artifactsPerCapture: 512, captureArtifactBytes: 268435456 };
const PAGE_KINDS = ['DOCUMENT_HTML', 'RENDERED_HTML', 'DOM_SNAPSHOT_JSON', 'LAYOUT_JSON', 'FORM_STATE_JSON', 'RESOURCE_MANIFEST_JSON', 'CSS_TEXT', 'SCRIPT_TEXT', 'ASSET_BINARY', 'HTTP_REQUEST_BODY', 'HTTP_RESPONSE_BODY', 'SCREENSHOT_PNG', 'ACTION_VALUE_JSON', 'HEADERS_JSON'];
const err = code => Object.assign(new Error(code), { code, status: 503 });
function contains(values, expected) { return Array.isArray(values) && expected.every(value => values.includes(value)); }
function pageLimitsCompatible(limits) {
    return limits && Object.entries(EXPECTED_LIMITS).every(([name, value]) => Object.hasOwn(PAGE_LIMITS, name) || limits[name] === value)
        && Object.entries(PAGE_LIMITS).every(([name, max]) => Number.isSafeInteger(limits[name]) && limits[name] >= 1 && limits[name] <= max)
        && limits.artifactBytes <= limits.captureArtifactBytes;
}
export async function getObservationUiCapabilities(env, purpose, revision = UI_REVISION) {
    if(!UI_REVISIONS.includes(revision)) throw err('UI_SERVICE_CAPABILITY_MISMATCH');
    if (!env.OBSERVATION_SERVICE?.fetch)
        throw err('UI_SERVICE_UNAVAILABLE');
    const controller = new AbortController();
    let timer;
    try {
        const operation = (async () => {
            const response = await env.OBSERVATION_SERVICE.fetch(new Request(`https://qagent-observation/v1/ui/capabilities${revision===UI_REVISION?'':'?revision='+encodeURIComponent(revision)}`, { method: 'GET', signal: controller.signal, redirect: 'manual' }));
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
            const environmentManaged = revision === UI_PAGE_ENVIRONMENT_REVISION;
            const observedPage = revision === UI_PAGE_OBSERVED_REVISION || environmentManaged;
            if (!c || c.contractVersion !== 'qagent.ui-capabilities.v1' || c.revision !== revision
                || (observedPage ? c.status !== 'ok' || !contains(c.contracts, PAGE_CONTRACTS) || !pageLimitsCompatible(c.limits)
                    : CONTRACTS.some(v => !c.contracts?.includes(v)) || Object.entries(EXPECTED_LIMITS).some(([k, v]) => c.limits?.[k] !== v)))
                throw err('UI_SERVICE_CAPABILITY_MISMATCH');
            if (c.readEnabled !== true)
                throw err('UI_STORAGE_OR_SCHEMA_UNAVAILABLE');
            if (observedPage) {
                if (purpose === 'UI_CAPTURE' && (c.captureEnabled !== true
                    || !contains(c.captureDataOrigins, [environmentManaged ? 'OBSERVED_ENVIRONMENT_MANAGED' : 'OBSERVED_SANITIZED'])
                    || !contains(c.artifactKinds, PAGE_KINDS)
                    || !contains(c.artifactContentTypes, ['application/json', 'text/html', 'text/css', 'text/javascript', 'image/png'])
                    || !contains(c.capabilities, ['OBSERVED_PAGE_COPY', 'FULL_TEST_CAPTURE', environmentManaged ? 'ENVIRONMENT_MANAGED_TEST_DATA' : 'MASKED_SCREENSHOTS', 'PRIVATE_INERT_STORAGE', 'EXPLICIT_V2_EVENTS', 'PAGED_SOURCE_READ'])
                    || c.ingestion?.contractVersion !== 'qagent.ui-ingestion.v1' || c.ingestion?.receiptVersion !== 'qagent.ui-ingestion-receipt.v1'
                    || c.ingestion?.mode !== 'ASYNC_QUEUE' || c.ingestion?.enabled !== true || c.ingestion?.durability !== 'QUEUE_PUBLISHED'))
                    throw err('UI_CAPTURE_UNAVAILABLE');
                return c;
            }
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

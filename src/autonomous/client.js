import { buildTestGenerationInternalHeaders } from '../security/testGenerationInternalAuth.js';
import { failure, safeCode } from './contracts.js';
/** Private orchestration transport. No public URL fallback, no Console JWT. */
export async function autonomousClient({ env, organizationId, projectId, path, method = 'GET', body = null, fetchImpl = null, timeoutMs = 30000 }) {
    const binding = env.TEST_GENERATION_ORCHESTRATOR_SERVICE;
    if (!fetchImpl && !binding?.fetch)
        failure('AUTONOMOUS_ORCHESTRATOR_NOT_CONFIGURED', 503, true);
    const url = 'https://qagent-test-generation-orchestrator.internal' + path, rawBody = body === null ? '' : JSON.stringify(body);
    const headers = await buildTestGenerationInternalHeaders({ env, organizationId, projectId, method, url, rawBody });
    const controller = new AbortController();
    let reader = null, timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('AUTONOMOUS_ORCHESTRATOR_TIMEOUT'); Object.assign(error, { code: 'AUTONOMOUS_ORCHESTRATOR_TIMEOUT', status: 503, retryable: true }); reject(error); controller.abort(); reader?.cancel().catch(() => { }); }, Math.max(10, Math.min(30000, timeoutMs))); });
    try {
        const request = new Request(url, { method, headers: { ...headers, Accept: 'application/json', ...(rawBody ? { 'Content-Type': 'application/json' } : {}) }, ...(rawBody ? { body: rawBody } : {}), signal: controller.signal });
        const response = await Promise.race([fetchImpl ? fetchImpl(request) : binding.fetch(request), deadline]);
        reader = response.body?.getReader();
        let text = '', size = 0;
        const decoder = new TextDecoder();
        if (reader)
            try {
                for (;;) {
                    const { done, value } = await Promise.race([reader.read(), deadline]);
                    if (done)
                        break;
                    size += value.byteLength;
                    if (size > 2000000) {
                        await reader.cancel();
                        failure('AUTONOMOUS_RESPONSE_LIMIT', 502);
                    }
                    text += decoder.decode(value, { stream: true });
                }
                text += decoder.decode();
            }
            finally {
                reader.releaseLock();
            }
        let p;
        try {
            p = JSON.parse(text);
        }
        catch {
            failure('AUTONOMOUS_RESPONSE_INVALID', 502);
        }
        if (!response.ok || p?.status !== 'ok')
            failure(safeCode(p), response.status === 200 ? 502 : response.status, p.retryable === true || response.status >= 500);
        if (p.data === undefined)
            failure('AUTONOMOUS_RESPONSE_INVALID', 502);
        return p.data;
    }
    catch (e) {
        if (e?.code)
            throw e;
        failure('AUTONOMOUS_ORCHESTRATOR_UNAVAILABLE', 503, true);
    }
    finally {
        clearTimeout(timer);
    }
}
export const autonomousPath = (projectId, suffix) => `/v1/autonomous-learning/projects/${encodeURIComponent(projectId)}/${suffix}`;

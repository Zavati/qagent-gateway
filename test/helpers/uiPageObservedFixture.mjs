import assert from 'node:assert/strict';
import { hashAccessToken } from '../../src/lib/keyService.js';
import { UI_CAPTURE_POLICY_VARIABLE } from '../../src/ui/uiCaptureConfigurationService.js';

export const PC3_REVISION = '08.2-PC.3.r1';
export const PC3_SECRET = 'local-control-only-secret-012345678901234567890';
export const PC3_ENVIRONMENT = Object.freeze({ organizationId: 'org_control', projectId: 'prj_control', environmentId: 'env_control', status: 'active', webBaseUrl: 'https://app.example.test', environmentType: 'STG' });

export function pageCapabilities(patch = {}) {
    return {
        status: 'ok', contractVersion: 'qagent.ui-capabilities.v1', revision: PC3_REVISION,
        contracts: ['qagent.ui-capture.v2', 'qagent.ui-capture-events.v2', 'qagent.ui-artifact.v2', 'qagent.ui-action.v2', 'qagent.ui-interaction.v2', 'qagent.ui-checkpoint.v2'],
        readEnabled: true, captureEnabled: true, captureDataOrigins: ['OBSERVED_SANITIZED'],
        artifactKinds: ['DOCUMENT_HTML', 'RENDERED_HTML', 'DOM_SNAPSHOT_JSON', 'LAYOUT_JSON', 'FORM_STATE_JSON', 'RESOURCE_MANIFEST_JSON', 'CSS_TEXT', 'SCRIPT_TEXT', 'ASSET_BINARY', 'HTTP_REQUEST_BODY', 'HTTP_RESPONSE_BODY', 'SCREENSHOT_PNG', 'ACTION_VALUE_JSON', 'HEADERS_JSON'],
        artifactContentTypes: ['application/json', 'text/html', 'text/css', 'text/javascript', 'image/png'],
        capabilities: ['OBSERVED_PAGE_COPY', 'FULL_TEST_CAPTURE', 'MASKED_SCREENSHOTS', 'PRIVATE_INERT_STORAGE', 'EXPLICIT_V2_EVENTS', 'PAGED_SOURCE_READ'],
        limits: { artifactBytes: 16777216, artifactsPerCapture: 512, captureArtifactBytes: 268435456, eventBytes: 32768, batchBytes: 262144, batchEvents: 100, captureEvents: 2000, captureEventBytes: 8388608, controlBytes: 32768, sessionSeconds: 900 },
        ingestion: { contractVersion: 'qagent.ui-ingestion.v1', receiptVersion: 'qagent.ui-ingestion-receipt.v1', mode: 'ASYNC_QUEUE', enabled: true, durability: 'QUEUE_PUBLISHED' },
        ...patch,
    };
}

/** Only storage/binding seams are doubles. The handler, policy, auth and signature code are real. */
export async function gatewayPageFixture(options = {}) {
    const qps = 'qps_' + 'P'.repeat(48), keyHash = 'sha256:' + 'b'.repeat(64), hashed = await hashAccessToken(qps);
    const calls = [], capabilityRequests = [];
    const kv = new Map([
        [`plugin_session:${hashed}`, JSON.stringify({ organizationId: 'org_control', keyHash, pluginSessionId: 'psn_control', expiresAt: new Date(Date.now() + 3600000).toISOString() })],
        [`license:${keyHash}`, JSON.stringify({ status: 'active', plan: 'pro', expiresAt: new Date(Date.now() + 86400000).toISOString(), ...options.license })],
    ]);
    const policy = options.policy === undefined ? { mode: 'FULL_TEST', networkPaths: ['/api/'], sourceBuildRef: 'build_control' } : options.policy;
    const variables = policy === null ? [] : [{ variableKey: UI_CAPTURE_POLICY_VARIABLE, valueType: 'JSON', variableValue: JSON.stringify(policy), status: 'active' }];
    const db = { prepare(sql) { return { bind(...params) { return {
        first: async () => {
            calls.push({ sql, params });
            if (params[0] !== 'org_control') return null;
            if (/FROM\s+projects/i.test(sql)) return params[1] === 'prj_control' ? { projectId: 'prj_control', organizationId: 'org_control', status: 'active' } : null;
            if (/FROM\s+environments/i.test(sql)) return params[1] === 'prj_control' && params[2] === 'env_control' ? PC3_ENVIRONMENT : null;
            if (/FROM\s+organizations/i.test(sql)) return { organizationId: 'org_control', status: 'active' };
            throw new Error('Unexpected first query');
        },
        all: async () => {
            calls.push({ sql, params });
            assert.deepEqual(params, ['org_control', 'prj_control', 'env_control']);
            if (/environment_variables/i.test(sql)) return { results: variables };
            if (/environment_api_bindings/i.test(sql)) return { results: [{ baseUrl: 'https://app.example.test/api/' }] };
            throw new Error('Unexpected all query');
        },
    }; } }; } };
    const env = {
        QAGENT_DB: db, QAGENT_KV: { get: async k => kv.get(k) }, UI_CAPTURE_ENABLED: 'true', OBSERVATION_GRANT_SECRET: PC3_SECRET,
        OBSERVATION_SERVICE: { fetch: async req => {
            capabilityRequests.push(req);
            return options.observationFetch ? options.observationFetch(req) : Response.json(options.capabilities ?? pageCapabilities());
        } },
        ...options.env,
    };
    const request = (patch = {}) => new Request('https://gateway.example.test/v1/plugin/ui-capture-grants', {
        method: 'POST', headers: { authorization: 'Bearer ' + qps, 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'prj_control', environmentId: 'env_control', purpose: 'UI_CAPTURE', contractRevision: PC3_REVISION, configurationMode: 'ENVIRONMENT', ...patch }),
    });
    return { env, request, calls, capabilityRequests };
}

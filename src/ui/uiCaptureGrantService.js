import { assertPremiumAllowed, getLicenseByKeyHash } from '../lib/licenseService.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { requirePluginSession } from '../services/pluginAuthService.js';
import { createUiCaptureGrantToken, UI_REVISION, UI_REVISIONS, UI_PURPOSES } from './uiCaptureGrantToken.js';
import { getObservationUiCapabilities } from './observationUiCapabilitiesClient.js';
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status, code }); };
async function input(req) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('content-type') || '') || req.headers.has('content-encoding'))
        fail('UI_MEDIA_TYPE_UNSUPPORTED', 415);
    const reader = req.body?.getReader();
    if (!reader)
        fail('UI_INPUT_REQUIRED');
    let bytes = 0;
    const parts = [];
    try {
        while (true) {
            const r = await reader.read();
            if (r.done)
                break;
            bytes += r.value.length;
            if (bytes > 4096) {
                await reader.cancel();
                fail('UI_PAYLOAD_TOO_LARGE', 413);
            }
            parts.push(r.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const all = new Uint8Array(bytes);
    let pos = 0;
    for (const part of parts) {
        all.set(part, pos);
        pos += part.length;
    }
    let v;
    try {
        v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    }
    catch {
        fail('UI_INPUT_INVALID');
    }
    const keys = ['projectId', 'environmentId', 'purpose', 'contractRevision'];
    if (!v || typeof v !== 'object' || Array.isArray(v) || keys.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !keys.includes(k)))
        fail('UI_INPUT_INVALID');
    for (const [k, prefix] of [['projectId', 'prj'], ['environmentId', 'env']])
        if (typeof v[k] !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9-]{3,160}$`).test(v[k]))
            fail('UI_SCOPE_INVALID');
    if (!Object.hasOwn(UI_PURPOSES, v.purpose))
        fail('UI_PURPOSE_REQUIRED');
    if (!UI_REVISIONS.includes(v.contractRevision))
        fail('UI_SERVICE_CAPABILITY_MISMATCH', 409);
    return v;
}
export async function createUiCaptureGrant(req, env) {
    const session = await requirePluginSession(req, env); // Existing authority, NEVER organizationId from body.
    const v = await input(req);
    if (v.purpose === 'UI_CAPTURE' && env.UI_CAPTURE_ENABLED !== 'true')
        fail('UI_CAPTURE_DISABLED', 409);
    const organizationId = session.organizationId;
    const project = await getOrganizationProject(env, organizationId, v.projectId);
    const environment = await getProjectEnvironment(env, organizationId, project.projectId, v.environmentId);
    const license = await getLicenseByKeyHash(env, session.keyHash);
    try {
        assertPremiumAllowed(license);
    }
    catch {
        fail('UI_ENTITLEMENT_REQUIRED', 403);
    }
    const now = Date.now();
    const dates = [session.expiresAt, license?.expiresAt || license?.trialEndsAt].filter(Boolean).map(x => Date.parse(x));
    if (!dates.length || dates.some(x => !Number.isFinite(x) || x <= now))
        fail('UI_AUTHORITY_EXPIRED', 403);
    let web;
    try {
        web = new URL(environment.webBaseUrl);
        if (!['http:', 'https:'].includes(web.protocol) || web.username || web.password)
            fail('UI_WEB_ORIGIN_REQUIRED');
    }
    catch {
        fail('UI_WEB_ORIGIN_REQUIRED', 409);
    }
    const capabilities = await getObservationUiCapabilities(env, v.purpose, v.contractRevision);
    const signed = await createUiCaptureGrantToken(env, { organizationId, projectId: project.projectId, environmentId: environment.environmentId,
        pluginSessionId: session.pluginSessionId, contractRevision: v.contractRevision, purpose: v.purpose, origins: [web.origin], authorityExpiresAt: Math.floor(Math.min(now + 900000, ...dates) / 1000) });
    return { status: 'ok', grant: { token: signed.token, audience: 'qagent-observation-ui', purpose: v.purpose, expiresAt: signed.expiresAt, expiresInSeconds: signed.expiresInSeconds },
        context: { organizationId, projectId: project.projectId, environmentId: environment.environmentId, pluginSessionId: session.pluginSessionId, origins: [web.origin] }, capabilities };
}

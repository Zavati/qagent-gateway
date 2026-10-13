// UI signatures are domain-separated from qog/qos and REST execution tickets.
const PREFIX = 'qug_v1', DOMAIN = 'QAGENT_UI_CAPTURE\n';
export const UI_REVISION = '08.2-A.1.r1';
export const UI_PURPOSES = Object.freeze({ UI_CAPTURE: ['ui:capture:create'], UI_ARTIFACT_READ: ['ui:artifact:read'] });
function b64(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function unb64(s) { if (!/^[A-Za-z0-9_-]+$/.test(s))
    throw new Error('UI_GRANT_INVALID'); return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), x => x.charCodeAt(0)); }
function error(code, status = 401) { return Object.assign(new Error(code), { code, status }); }
async function key(env) { const secret = String(env.OBSERVATION_GRANT_SECRET || '').trim(); if (secret.length < 32)
    throw error('UI_GRANT_SECRET_UNAVAILABLE', 503); return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export function validateUiGrantClaims(p, now = Math.floor(Date.now() / 1000)) {
    const fields = ['ver', 'iss', 'aud', 'jti', 'purpose', 'capabilities', 'organizationId', 'projectId', 'environmentId', 'pluginSessionId', 'origins', 'iat', 'exp', 'authorityExpiresAt', 'contractRevision'];
    if (!p || Object.keys(p).length !== fields.length || Object.keys(p).some(k => !fields.includes(k)) || p.ver !== 1 || p.iss !== 'qagent-gateway' || p.aud !== 'qagent-observation-ui' || p.contractRevision !== UI_REVISION)
        throw error('UI_GRANT_INVALID');
    if (!Object.hasOwn(UI_PURPOSES, p.purpose) || JSON.stringify(p.capabilities) !== JSON.stringify(UI_PURPOSES[p.purpose]))
        throw error('UI_GRANT_INVALID');
    for (const f of ['jti', 'organizationId', 'projectId', 'environmentId', 'pluginSessionId'])
        if (typeof p[f] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,179}$/.test(p[f]))
            throw error('UI_GRANT_INVALID');
    if (![p.iat, p.exp, p.authorityExpiresAt].every(Number.isSafeInteger) || p.iat > now + 30 || p.exp <= p.iat || p.exp - p.iat > 120 || p.authorityExpiresAt < p.exp || p.authorityExpiresAt > p.iat + 900)
        throw error('UI_GRANT_INVALID');
    if (now >= p.exp)
        throw error('UI_GRANT_EXPIRED');
    if (!Array.isArray(p.origins) || p.origins.length !== 1)
        throw error('UI_GRANT_INVALID');
    try {
        for (const s of p.origins) {
            const u = new URL(s);
            if (!['http:', 'https:'].includes(u.protocol) || u.origin !== s || u.username || u.password)
                throw error('UI_GRANT_INVALID');
        }
    }
    catch {
        throw error('UI_GRANT_INVALID');
    }
    return p;
}
export async function createUiCaptureGrantToken(env, context) {
    const now = Math.floor(Date.now() / 1000), until = Math.min(now + 900, Math.floor(context.authorityExpiresAt));
    if (until <= now)
        throw error('UI_AUTHORITY_EXPIRED', 403);
    const p = { ver: 1, iss: 'qagent-gateway', aud: 'qagent-observation-ui', jti: `qugj_${crypto.randomUUID()}`, purpose: context.purpose,
        capabilities: UI_PURPOSES[context.purpose], organizationId: context.organizationId, projectId: context.projectId,
        environmentId: context.environmentId, pluginSessionId: context.pluginSessionId, origins: context.origins,
        iat: now, exp: Math.min(now + 120, until), authorityExpiresAt: until, contractRevision: UI_REVISION };
    validateUiGrantClaims(p, now);
    const input = `${PREFIX}.${b64(new TextEncoder().encode(JSON.stringify(p)))}`;
    const signature = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(DOMAIN + input));
    return { token: `${input}.${b64(new Uint8Array(signature))}`, payload: p, expiresAt: new Date(p.exp * 1000).toISOString(), expiresInSeconds: p.exp - now };
}
export async function verifyUiCaptureGrantToken(env, token, now = Math.floor(Date.now() / 1000)) {
    if (typeof token !== 'string' || token.length > 8192)
        throw error('UI_GRANT_INVALID');
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX)
        throw error('UI_GRANT_INVALID');
    let p;
    try {
        if (!await crypto.subtle.verify('HMAC', await key(env), unb64(parts[2]), new TextEncoder().encode(DOMAIN + parts.slice(0, 2).join('.'))))
            throw error('UI_GRANT_INVALID');
        p = JSON.parse(new TextDecoder().decode(unb64(parts[1])));
    }
    catch {
        throw error('UI_GRANT_INVALID');
    }
    return validateUiGrantClaims(p, now);
}

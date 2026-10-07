/** 08.1.8-FIX-1: read configured destinations, not credentials or observed URLs.
 * The resulting list is a consent preview; only a deliberate policy write pins it.
 * Runtime still checks every materialized target against the saved policy.
 */
import { digest, exact, failure, HASH, identifier, normalizePolicy } from './contracts.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { listProjectEnvironmentApiBindings } from '../services/environmentApiBindingService.js';
import { listEnvironmentAuthProfilesPublic } from '../services/authProfileRuntimeService.js';

export const ENVIRONMENT_ORIGINS_CONTRACT = 'qagent.autonomous-environment-origins.v1';
const SOURCE_KINDS = ['WEB_BASE_URL', 'API_SERVICE', 'AUTH_API_SERVICE'];
const SCOPES = ['organizationId', 'projectId', 'environmentId'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeName = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';

/** Canonical comparison only. Never overwrites the original execution base URL. */
export function configuredUrlOrigin(raw) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000 || /[\u0000-\u0020\u007f\\]/.test(raw.trim()) || !/^https?:\/\//i.test(raw.trim()))
        failure('AUTONOMOUS_CONFIGURED_URL_INVALID');
    let u;
    try { u = new URL(raw.trim()); } catch { failure('AUTONOMOUS_CONFIGURED_URL_INVALID'); }
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || /[*{}]/.test(u.hostname) || u.username || u.password || u.search || u.hash || u.origin.length > 300)
        failure('AUTONOMOUS_CONFIGURED_URL_INVALID');
    return u.origin;
}
function scoped(value, scope) {
    return object(value) && SCOPES.every(k => value[k] === scope[k]);
}
function emptyContext(scope, name = '', status = 'UNAVAILABLE', code = 'AUTONOMOUS_ENVIRONMENT_ORIGINS_UNAVAILABLE') {
    return { contractVersion: ENVIRONMENT_ORIGINS_CONTRACT, ...Object.fromEntries(SCOPES.map(k => [k, scope[k]])), environmentName: safeName(name),
        status, allowedOrigins: [], entries: [], originsHash: null, runtimeOriginAuthProfileCount: 0,
        issues: [{ code, source: 'ENVIRONMENT_CONFIGURATION' }] };
}

/** Pure derivation with a scoped hash. Only safe origins and fixed source tags leave
 * this function. Invalid URLs, auth config and upstream error messages never do.
 */
export async function deriveEnvironmentOrigins(scope, { environment, bindings, authProfiles }) {
    SCOPES.forEach(k => identifier(scope[k]));
    if (!scoped(environment, scope) || (environment.status && environment.status !== 'active'))
        failure('AUTONOMOUS_ENVIRONMENT_ORIGINS_SCOPE_MISMATCH', 403);
    if (!Array.isArray(bindings) || bindings.length > 500 || !object(authProfiles) || Object.keys(authProfiles).length > 500)
        return emptyContext(scope, environment.name, 'CONFIGURATION_REQUIRED', 'AUTONOMOUS_ENVIRONMENT_CONFIG_LIMIT');
    const origins = new Map(), apiOrigins = new Map(), issues = [];
    let runtimeOriginAuthProfileCount = 0;
    function issue(code, source) { if (!issues.some(x => x.code === code && x.source === source)) issues.push({ code, source }); }
    function add(raw, source) {
        try {
            const origin = configuredUrlOrigin(raw);
            if (!origins.has(origin)) origins.set(origin, new Set());
            origins.get(origin).add(source);
            return origin;
        } catch { issue('AUTONOMOUS_CONFIGURED_URL_INVALID', source); return null; }
    }
    if (environment.webBaseUrl != null && environment.webBaseUrl !== '') add(environment.webBaseUrl, 'WEB_BASE_URL');
    for (const binding of bindings) {
        if (!scoped(binding, scope)) failure('AUTONOMOUS_ENVIRONMENT_ORIGINS_SCOPE_MISMATCH', 403);
        if (binding.status && binding.status !== 'active') continue;
        if (typeof binding.serviceKey !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(binding.serviceKey)) {
            issue('AUTONOMOUS_API_SERVICE_REFERENCE_INVALID', 'API_SERVICE'); continue;
        }
        const origin = add(binding.baseUrl, 'API_SERVICE');
        if (apiOrigins.has(binding.serviceKey) && apiOrigins.get(binding.serviceKey) !== origin)
            issue('AUTONOMOUS_API_SERVICE_ORIGIN_AMBIGUOUS', 'API_SERVICE');
        apiOrigins.set(binding.serviceKey, origin);
    }
    for (const profile of Object.values(authProfiles)) {
        if (!object(profile)) { issue('AUTONOMOUS_AUTH_TARGET_UNSUPPORTED', 'AUTH_API_SERVICE'); continue; }
        if (profile.enabled === false || (profile.status && profile.status !== 'active')) continue;
        if (['none', 'basic', 'api_key'].includes(profile.type)) continue; // no exchange destination
        if (!['oauth2_client_credentials', 'login_http_json'].includes(profile.type) || !object(profile.config)) {
            issue('AUTONOMOUS_AUTH_TARGET_UNSUPPORTED', 'AUTH_API_SERVICE'); continue;
        }
        const config = profile.config;
        const targetMode = config.targetMode || (config.apiServiceKey ? 'api_service' : 'runtime_origin');
        if (targetMode === 'runtime_origin') {
            // Runtime is scenario-specific. Do not invent an auth host from a path,
            // unrelated profile, observation or the browser's currently open URL.
            runtimeOriginAuthProfileCount++;
        } else if (targetMode === 'api_service') {
            const origin = apiOrigins.get(config.apiServiceKey);
            if (!origin) issue('AUTONOMOUS_AUTH_SERVICE_BINDING_REQUIRED', 'AUTH_API_SERVICE');
            else origins.get(origin).add('AUTH_API_SERVICE');
        } else issue('AUTONOMOUS_AUTH_TARGET_UNSUPPORTED', 'AUTH_API_SERVICE');
    }
    if (!origins.size) issue('AUTONOMOUS_ENVIRONMENT_ORIGINS_REQUIRED', 'ENVIRONMENT_CONFIGURATION');
    if (origins.size > 10) issue('AUTONOMOUS_ENVIRONMENT_ORIGIN_LIMIT', 'ENVIRONMENT_CONFIGURATION');
    if (issues.length) return { ...emptyContext(scope, environment.name, 'CONFIGURATION_REQUIRED'), issues, runtimeOriginAuthProfileCount };
    const allowedOrigins = [...origins.keys()].sort();
    const entries = allowedOrigins.map(origin => ({ origin, sources: SOURCE_KINDS.filter(k => origins.get(origin).has(k)) }));
    const originsHash = await digest({ contractVersion: ENVIRONMENT_ORIGINS_CONTRACT, ...Object.fromEntries(SCOPES.map(k => [k, scope[k]])), allowedOrigins });
    return { contractVersion: ENVIRONMENT_ORIGINS_CONTRACT, ...Object.fromEntries(SCOPES.map(k => [k, scope[k]])),
        environmentName: safeName(environment.name), status: 'READY', allowedOrigins, entries, originsHash,
        runtimeOriginAuthProfileCount, issues: [] };
}

/** Uses existing scoped metadata readers only; no variables, Secret Vault or JIT. */
export async function resolveEnvironmentOrigins(scope, deps = {}) {
    try {
        const environment = scope.environment || await (deps.getEnvironment || getProjectEnvironment)(scope.env, scope.organizationId, scope.projectId, scope.environmentId);
        const [bindings, authProfiles] = await Promise.all([
            (deps.listApiBindings || listProjectEnvironmentApiBindings)(scope.env, scope.organizationId, scope.projectId, scope.environmentId),
            (deps.listAuthProfiles || listEnvironmentAuthProfilesPublic)(scope.env, scope.organizationId, scope.projectId, scope.environmentId),
        ]);
        return await deriveEnvironmentOrigins(scope, { environment, bindings, authProfiles });
    } catch (e) {
        // Keeping policy reads/revocation usable must not turn missing config into
        // permission to save a derived policy. The new write checks status READY.
        if (e?.code === 'AUTONOMOUS_ENVIRONMENT_ORIGINS_SCOPE_MISMATCH') throw e;
        return emptyContext(scope, scope.environment?.name);
    }
}
const PUBLIC_FIELDS = ['contractVersion', 'enabled', 'expectedRevision', 'confirmDelegation', 'confirmControlledEnvironment', 'profile', 'originSelection', 'allowedChangeTypes', 'expiresAt', 'limits'];
export async function materializeEnvironmentPolicy(input, scope, deps = {}) {
    exact(input, PUBLIC_FIELDS);
    exact(input.originSelection, ['source', 'originsHash']);
    if (input.enabled !== true || input.originSelection.source !== 'ENVIRONMENT_CONFIG' || typeof input.originSelection.originsHash !== 'string' || !HASH.test(input.originSelection.originsHash))
        failure('AUTONOMOUS_ORIGIN_SELECTION_INVALID', 400);
    if (input.confirmDelegation !== true || input.confirmControlledEnvironment !== true)
        failure('AUTONOMOUS_DELEGATION_CONFIRMATION_REQUIRED', 400);
    const context = await resolveEnvironmentOrigins(scope, deps);
    if (context.status !== 'READY')
        failure(context.status === 'UNAVAILABLE' ? 'AUTONOMOUS_ENVIRONMENT_ORIGINS_UNAVAILABLE' : 'AUTONOMOUS_ENVIRONMENT_CONFIGURATION_REQUIRED', context.status === 'UNAVAILABLE' ? 503 : 409);
    if (input.originSelection.originsHash !== context.originsHash)
        failure('AUTONOMOUS_ENVIRONMENT_ORIGINS_CHANGED', 409);
    const { originSelection, ...rest } = input;
    const policy = { ...rest, allowedOrigins: [...context.allowedOrigins] };
    normalizePolicy(policy); // preserve every original consent/profile/limit check
    return { input: policy, environmentOrigins: context };
}

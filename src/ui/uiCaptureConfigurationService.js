import { listProjectEnvironmentApiBindings } from '../services/environmentApiBindingService.js';
import { listProjectEnvironmentVariables } from '../services/environmentVariableService.js';

export const UI_MONITORING_CONFIG_VERSION = 'qagent.ui-monitoring-config.v1';
export const UI_CAPTURE_POLICY_VARIABLE = 'QAGENT_UI_CAPTURE_POLICY';
const fields = ['networkPaths', 'businessHeaderNames', 'publicTextSelectors', 'valueSelectors', 'screenshotSelectors', 'maskSelectors'];
export const UI_CAPTURE_MODES = ['PROTECTED','FULL_TEST'];
const fail = (code = 'UI_ENVIRONMENT_POLICY_INVALID', status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const privateText = v => /(?:Bearer\s+\S+|\bq(?:ps|og|os|ug|us|ag)_\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(v);
function strings(v, max, check) {
    if (!Array.isArray(v) || v.length > max) fail();
    if (v.some(x => typeof x !== 'string' || !x.length || privateText(x) || !check(x))) fail();
    return [...new Set(v)];
}
function paths(v) {
    const result = strings(v, 16, x => x.length <= 256 && x.startsWith('/') && !x.startsWith('//') && !/[?#%\\\u0000-\u001f]/.test(x) && !x.split('/').some(p => p === '.' || p === '..'));
    if (!result.length) fail();
    return result;
}
function originUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { fail('UI_WEB_ORIGIN_REQUIRED'); }
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) fail('UI_WEB_ORIGIN_REQUIRED');
    return u;
}
/** Resolve only non-secret capture settings. No AuthProfile/Vault values leave this boundary. */
export function buildUiCaptureConfiguration({ projectId, environment, bindings = [], variables = [] }) {
    const web = originUrl(environment.webBaseUrl);
    const matches = variables.filter(v => v.variableKey === UI_CAPTURE_POLICY_VARIABLE && v.status !== 'archived');
    if (matches.length > 1) fail();
    let configured = {};
    if (matches.length) {
        const variable = matches[0];
        if (variable.valueType !== 'JSON' || typeof variable.variableValue !== 'string' || new TextEncoder().encode(variable.variableValue).length > 8192) fail();
        try { configured = JSON.parse(variable.variableValue); } catch { fail(); }
        const allowed = ['enabled', 'mode', ...fields, 'startMode', 'sourceBuildRef'];
        if (!record(configured) || Object.keys(configured).some(k => !allowed.includes(k))) fail();
        if (own(configured, 'enabled') && typeof configured.enabled !== 'boolean') fail();
        if (configured.enabled === false) fail('UI_ENVIRONMENT_CAPTURE_DISABLED');
        if (own(configured, 'mode') && !UI_CAPTURE_MODES.includes(configured.mode)) fail();
    }
    const inheritedPaths = [];
    for (const binding of bindings) {
        if (binding.status === 'archived') continue;
        let u;
        try { u = new URL(binding.baseUrl); } catch { fail('UI_ENVIRONMENT_API_BINDING_INVALID'); }
        // The A.2 consumer only permits the web origin. A second host is never widened implicitly.
        if (u.origin !== web.origin) continue;
        if (u.username || u.password || u.search || u.hash) fail('UI_ENVIRONMENT_API_BINDING_INVALID');
        inheritedPaths.push(u.pathname || '/');
    }
    const defaults = inheritedPaths.length ? [...new Set(inheritedPaths)].sort() : [web.pathname || '/'];
    const mode = own(configured, 'mode') ? configured.mode : 'PROTECTED';
    const fullDefaults = {
        publicTextSelectors: ['body'],
        valueSelectors: ['input:not([type="password"]):not([type="hidden"]):not([type="file"]),textarea,select'],
        screenshotSelectors: ['body'],
        maskSelectors: ['input[type="password"]','input[type="hidden"]','input[type="file"]','[autocomplete*="password"]','[autocomplete="one-time-code"]','[data-private]','[data-qagent-private]','[data-sensitive]']
    };
    const policy = {
        version: 'qagent.ui-capture-policy.v1',
        mode,
        // Compatibility with A.2's policy schema: a centrally enabled, authenticated scope;
        // NOT a fabricated per-session checkbox/acceptance receipt.
        acknowledgeTestData: true,
        networkPaths: paths(own(configured, 'networkPaths') ? configured.networkPaths : defaults),
        businessHeaderNames: strings(own(configured, 'businessHeaderNames') ? configured.businessHeaderNames : [], 16, x => x.length <= 80 && /^[a-z][a-z0-9-]*$/.test(x) && !/(?:authorization|cookie|token|secret|api-?key|session|csrf)/i.test(x)),
        publicTextSelectors: [], valueSelectors: [], screenshotSelectors: [], maskSelectors: [],
        startMode: own(configured, 'startMode') ? configured.startMode : 'CURRENT_DOCUMENT'
    };
    for (const field of ['publicTextSelectors', 'valueSelectors', 'screenshotSelectors', 'maskSelectors']) {
        const fallback = mode === 'FULL_TEST' ? fullDefaults[field] : [];
        policy[field] = strings(own(configured, field) ? configured[field] : fallback, 32, x => x.length <= 256 && !/[{}<>\u0000-\u001f]|:has\(/i.test(x));
    }
    if (!['CURRENT_DOCUMENT', 'NEXT_NAVIGATION'].includes(policy.startMode)) fail();
    const sourceBuildRef = configured.sourceBuildRef ?? null;
    if (sourceBuildRef !== null && (typeof sourceBuildRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,179}$/.test(sourceBuildRef) || privateText(sourceBuildRef))) fail();
    return {
        version: UI_MONITORING_CONFIG_VERSION,
        projectId,
        environmentId: environment.environmentId,
        origin: web.origin,
        policySource: matches.length ? 'ENVIRONMENT_VARIABLE' : 'ENVIRONMENT_DEFAULT',
        networkScopeSource: own(configured, 'networkPaths') ? 'ENVIRONMENT_VARIABLE' : inheritedPaths.length ? 'API_BINDINGS' : 'WEB_BASE_URL',
        policy,
        sourceBuildRef
    };
}
export async function resolveUiCaptureConfiguration(env, organizationId, projectId, environment) {
    const [bindings, variables] = await Promise.all([
        listProjectEnvironmentApiBindings(env, organizationId, projectId, environment.environmentId),
        listProjectEnvironmentVariables(env, organizationId, projectId, environment.environmentId)
    ]);
    return buildUiCaptureConfiguration({ projectId, environment, bindings, variables });
}

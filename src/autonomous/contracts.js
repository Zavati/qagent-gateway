/** 08.1.8. Closed operational contracts; no request values or credentials. */
export const POLICY_CONTRACT = 'qagent.autonomous-learning-policy.v1';
export const CYCLE_CONTRACT = 'qagent.autonomous-learning-cycle.v1';
export const MESSAGE_CONTRACT = 'qagent.autonomous-learning-wake.v1';
export const PROFILE = 'CONTROLLED_READS_V1';
export const CHANGE_TYPES = Object.freeze(['SCENARIO_READINESS_CONFIRMATION', 'ASSERTION_COVERAGE_EXTENSION']);
export const READ_METHODS = Object.freeze(['GET', 'HEAD', 'OPTIONS']);
export const TERMINAL_CYCLES = Object.freeze(['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'FAILED', 'CANCELLED', 'EXPIRED']);
export const TERMINAL_SCENARIOS = Object.freeze(['VERIFIED', 'ALREADY_READY', 'PROTECTED', 'NEEDS_ATTENTION']);
export const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const HASH = /^[a-f0-9]{64}$/;
export function failure(code, status = 409, retryable = false) { const e = new Error(code); Object.assign(e, { code, status, retryable }); throw e; }
export function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
export function exact(v, fields, code = 'AUTONOMOUS_INPUT_INVALID') { if (!plain(v) || Object.keys(v).some(k => !fields.includes(k)))
    failure(code, 400); }
export function identifier(v) { if (typeof v !== 'string' || !ID.test(v))
    failure('AUTONOMOUS_ID_INVALID', 400); return v; }
export function canonical(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean')
        return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v))
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(canonical).join(',') + ']';
    if (plain(v))
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    failure('AUTONOMOUS_CANONICAL_VALUE_INVALID', 400);
}
export async function digest(v) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof v === 'string' ? v : canonical(v))))].map(x => x.toString(16).padStart(2, '0')).join(''); }
export function safeCode(e) { const code = e?.code; return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,119}$/.test(code) ? code : 'AUTONOMOUS_DEPENDENCY_FAILED'; }
const integer = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export function normalizeOrigins(raw) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10)
        failure('AUTONOMOUS_ORIGINS_REQUIRED', 400);
    const values = raw.map(s => { try {
        if (typeof s !== 'string' || s.length > 300)
            throw 0;
        const u = new URL(s);
        if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== ''))
            throw 0;
        return u.origin;
    }
    catch {
        failure('AUTONOMOUS_ORIGIN_INVALID', 400);
    } });
    return [...new Set(values)].sort();
}
export function normalizePolicy(input, { nowMs = Date.now() } = {}) {
    exact(input, ['contractVersion', 'enabled', 'expectedRevision', 'confirmDelegation', 'confirmControlledEnvironment', 'profile', 'allowedOrigins', 'allowedChangeTypes', 'expiresAt', 'limits']);
    if (input.contractVersion !== POLICY_CONTRACT || typeof input.enabled !== 'boolean' || !integer(input.expectedRevision, 0, 1000000))
        failure('AUTONOMOUS_POLICY_INVALID', 400);
    if (!input.enabled)
        return { enabled: false, expectedRevision: input.expectedRevision };
    if (input.confirmDelegation !== true || input.confirmControlledEnvironment !== true)
        failure('AUTONOMOUS_DELEGATION_CONFIRMATION_REQUIRED', 400);
    if (input.profile !== PROFILE)
        failure('AUTONOMOUS_PROFILE_UNSUPPORTED', 400);
    if (!Array.isArray(input.allowedChangeTypes) || !input.allowedChangeTypes.length || input.allowedChangeTypes.some(t => !CHANGE_TYPES.includes(t)) || new Set(input.allowedChangeTypes).size !== input.allowedChangeTypes.length)
        failure('AUTONOMOUS_CHANGE_TYPES_INVALID', 400);
    const expires = Date.parse(input.expiresAt);
    if (typeof input.expiresAt !== 'string' || !Number.isFinite(expires) || expires <= nowMs + 60000 || expires > nowMs + 90 * 86400000)
        failure('AUTONOMOUS_POLICY_EXPIRY_INVALID', 400);
    const defaults = { maxEndpoints: 50, maxScenarios: 300, maxRuns: 700, maxAnalysisOperations: 700, maxDurationSeconds: 7200, concurrency: 2, maxTechnicalRetries: 1 };
    exact(input.limits || {}, Object.keys(defaults));
    const l = { ...defaults, ...(input.limits || {}) };
    const bounds = { maxEndpoints: [1, 200], maxScenarios: [1, 1000], maxRuns: [1, 3000], maxAnalysisOperations: [1, 3000], maxDurationSeconds: [60, 86400], concurrency: [1, 4], maxTechnicalRetries: [0, 2] };
    for (const k of Object.keys(bounds))
        if (!integer(l[k], ...bounds[k]))
            failure('AUTONOMOUS_LIMIT_INVALID', 400);
    return { enabled: true, expectedRevision: input.expectedRevision, profile: PROFILE, allowedOrigins: normalizeOrigins(input.allowedOrigins), allowedChangeTypes: [...input.allowedChangeTypes].sort(), expiresAt: new Date(expires).toISOString(), limits: l };
}
export function normalizeCycleStart(input) {
    exact(input, ['contractVersion', 'environmentId', 'policyRevision', 'confirmStart', 'requestId']);
    if (input.contractVersion !== 'qagent.autonomous-learning-start.v1' || input.confirmStart !== true || !integer(input.policyRevision, 1, 1000000))
        failure('AUTONOMOUS_START_INVALID', 400);
    return { environmentId: identifier(input.environmentId), policyRevision: input.policyRevision, requestId: identifier(input.requestId) };
}
export function activePolicy(policy, cycle, nowMs = Date.now()) {
    return Boolean(policy?.enabled && policy.policyId === cycle.policyId && policy.revision === cycle.policyRevision && policy.policyHash === cycle.policyHash && policy.environmentId === cycle.environmentId && policy.organizationId === cycle.organizationId && policy.projectId === cycle.projectId && Date.parse(policy.expiresAt) > nowMs);
}
export function assertOrigin(origin, allowed) { let actual; try {
    actual = new URL(origin).origin;
}
catch {
    failure('AUTONOMOUS_RUNTIME_ORIGIN_INVALID');
} if (!allowed.includes(actual))
    failure('AUTONOMOUS_RUNTIME_ORIGIN_NOT_AUTHORIZED', 403); return actual; }
export function summarizeItems(items) {
    const counts = { endpoints: items.length, scenarios: 0, verified: 0, alreadyReady: 0, protected: 0, needsAttention: 0, inProgress: 0 };
    for (const item of items) {
        const ss = item.document?.scenarios || [];
        counts.scenarios += ss.length;
        for (const s of ss) {
            if (s.status === 'VERIFIED')
                counts.verified++;
            else if (s.status === 'ALREADY_READY')
                counts.alreadyReady++;
            else if (s.status === 'PROTECTED')
                counts.protected++;
            else if (s.status === 'NEEDS_ATTENTION')
                counts.needsAttention++;
            else
                counts.inProgress++;
        }
        if (item.status === 'FAILED' && !ss.length)
            counts.needsAttention++;
    }
    return counts;
}
/** Private in-process authority returned from a live orchestration grant. This
 * object is not accepted by the public Run-create JSON contract. */
export function assertExecutionAuthorization(a, scope) {
    exact(a, ['contractVersion', 'kind', 'policyId', 'policyRevision', 'cycleId', 'itemId', 'operationId', 'organizationId', 'projectId', 'environmentId', 'testDesignVersionId', 'scenarioIds', 'allowedOrigins', 'expiresAt']);
    if (a.contractVersion !== 'qagent.autonomous-execution-authorization.v1' || a.kind !== 'POLICY_DELEGATION' || !Number.isInteger(a.policyRevision) || a.policyRevision < 1 || Date.parse(a.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(a.expiresAt)))
        failure('AUTONOMOUS_EXECUTION_AUTHORIZATION_INVALID', 403);
    for (const key of ['policyId', 'cycleId', 'itemId', 'operationId', 'organizationId', 'projectId', 'environmentId', 'testDesignVersionId'])
        identifier(a[key]);
    for (const key of ['organizationId', 'projectId', 'environmentId', 'testDesignVersionId'])
        if (a[key] !== scope[key])
            failure('AUTONOMOUS_EXECUTION_SCOPE_MISMATCH', 403);
    if (scope.purpose !== 'LEARNING' || !Array.isArray(a.scenarioIds) || a.scenarioIds.length !== 1 || canonical(a.scenarioIds) !== canonical(scope.scenarioIds))
        failure('AUTONOMOUS_EXECUTION_SCOPE_MISMATCH', 403);
    identifier(a.scenarioIds[0]);
    normalizeOrigins(a.allowedOrigins);
    return a;
}

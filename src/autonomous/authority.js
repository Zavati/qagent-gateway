/** Signed delegation decision. Transported only by private service bindings.
 * Its signer records policy authorization, never a simulated human approval. */
export const AUTHORITY_CONTRACT = 'qagent.autonomous-approval-authorization.v1';
const TYPES = ['SCENARIO_READINESS_CONFIRMATION', 'ASSERTION_COVERAGE_EXTENSION'];
const ID = /^[A-Za-z0-9_-]{1,160}$/, HASH = /^[a-f0-9]{64}$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function authorityError(code = 'AUTONOMOUS_APPROVAL_INVALID', status = 403) { const e = new Error(code); Object.assign(e, { code, status }); throw e; }
export function authorityJson(v) { if (v === null || typeof v === 'string' || typeof v === 'boolean')
    return JSON.stringify(v); if (typeof v === 'number' && Number.isFinite(v))
    return JSON.stringify(v); if (Array.isArray(v))
    return '[' + v.map(authorityJson).join(',') + ']'; if (plain(v))
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + authorityJson(v[k])).join(',') + '}'; authorityError(); }
export async function authorityHash(v) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authorityJson(v))))].map(x => x.toString(16).padStart(2, '0')).join(''); }
const fields = ['contractVersion', 'kind', 'decisionId', 'policyId', 'policyRevision', 'policyHash', 'cycleId', 'itemId', 'organizationId', 'projectId', 'endpointId', 'environmentId', 'sourceTestDesignVersionId', 'delegatedByUserId', 'delegatedAt', 'expiresAt', 'members', 'signature'];
export function validateAuthorityShape(a, scope = {}) {
    if (!plain(a) || Object.keys(a).sort().join(',') !== [...fields].sort().join(',') || a.contractVersion !== AUTHORITY_CONTRACT || a.kind !== 'POLICY_DELEGATION')
        authorityError();
    for (const k of ['decisionId', 'policyId', 'cycleId', 'itemId', 'organizationId', 'projectId', 'endpointId', 'environmentId', 'sourceTestDesignVersionId', 'delegatedByUserId'])
        if (typeof a[k] !== 'string' || !ID.test(a[k]))
            authorityError();
    if (!Number.isInteger(a.policyRevision) || a.policyRevision < 1 || !HASH.test(a.policyHash) || !HASH.test(a.signature) || ![a.delegatedAt, a.expiresAt].every(s => typeof s === 'string' && s.length <= 35 && Number.isFinite(Date.parse(s))) || Date.parse(a.expiresAt) <= Date.parse(a.delegatedAt))
        authorityError();
    for (const key of ['organizationId', 'projectId', 'endpointId', 'environmentId', 'sourceTestDesignVersionId'])
        if (scope[key] !== undefined && scope[key] !== a[key])
            authorityError('AUTONOMOUS_APPROVAL_SCOPE_MISMATCH');
    if (!Array.isArray(a.members) || a.members.length < 1 || a.members.length > 50)
        authorityError();
    const proposals = new Set(), scenarios = new Set();
    for (const m of a.members) {
        if (!plain(m) || Object.keys(m).sort().join(',') !== 'changeId,changeType,proofHash,proposalId,scenarioId' || ![m.proposalId, m.scenarioId, m.changeId].every(x => typeof x === 'string' && ID.test(x)) || !TYPES.includes(m.changeType) || !HASH.test(m.proofHash) || proposals.has(m.proposalId) || scenarios.has(m.scenarioId))
            authorityError();
        proposals.add(m.proposalId);
        scenarios.add(m.scenarioId);
    }
    return a;
}
async function key(env, usage) { const secret = env?.AUTONOMOUS_LEARNING_HMAC_SECRET; if (typeof secret !== 'string' || secret.length < 32)
    authorityError('AUTONOMOUS_APPROVAL_SIGNING_NOT_CONFIGURED', 503); return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]); }
function payload(a) { const { signature, ...rest } = a; return new TextEncoder().encode(AUTHORITY_CONTRACT + '\n' + authorityJson(rest)); }
export async function signAuthority(env, fields) { const a = { ...fields, signature: '0'.repeat(64) }; validateAuthorityShape(a); a.signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', await key(env, 'sign'), payload(a)))].map(x => x.toString(16).padStart(2, '0')).join(''); return a; }
export async function verifyAuthority(env, a, scope = {}, nowMs = Date.now()) {
    validateAuthorityShape(a, scope);
    if (!Number.isFinite(nowMs) || Date.parse(a.expiresAt) <= nowMs || Date.parse(a.delegatedAt) > nowMs + 60000)
        authorityError('AUTONOMOUS_APPROVAL_EXPIRED');
    const sig = Uint8Array.from(a.signature.match(/../g), x => parseInt(x, 16));
    if (!await crypto.subtle.verify('HMAC', await key(env, 'verify'), sig, payload(a)))
        authorityError('AUTONOMOUS_APPROVAL_SIGNATURE_INVALID');
    return a;
}
export async function assertAuthorityChange(a, { proposalId, scenarioId, changeId, changeType, proof }) {
    const m = a.members.find(x => x.proposalId === proposalId && x.scenarioId === scenarioId && x.changeType === changeType && (!changeId || x.changeId === changeId));
    if (!m || m.proofHash !== await authorityHash(proof))
        authorityError('AUTONOMOUS_APPROVAL_CHANGE_MISMATCH');
    const e = changeType === 'ASSERTION_COVERAGE_EXTENSION' ? proof?.execution : proof;
    if (!e || e.environmentId !== a.environmentId || e.organizationId !== a.organizationId || e.projectId !== a.projectId || e.endpointId !== a.endpointId || e.testDesignVersionId !== a.sourceTestDesignVersionId || e.scenarioId !== scenarioId || e.executionPurpose !== 'LEARNING')
        authorityError('AUTONOMOUS_APPROVAL_EVIDENCE_MISMATCH');
    return m;
}
export function authoritySummary(a) { if (!a)
    return null; return { contractVersion: AUTHORITY_CONTRACT, kind: a.kind, decisionId: a.decisionId, policyId: a.policyId, policyRevision: a.policyRevision, cycleId: a.cycleId, itemId: a.itemId, environmentId: a.environmentId, delegatedByUserId: a.delegatedByUserId, delegatedAt: a.delegatedAt, reviewedByHuman: false }; }

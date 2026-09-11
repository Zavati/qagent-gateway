/** 08.1.6 public provenance contract. It deliberately cannot contain request/response values. */
export const OBSERVED_BASELINE_CONTRACT = 'qagent.observed-baseline-source.v1';
export const OBSERVED_COMPARISON_POLICY = 'qagent.observed-comparison.v1';
const SOURCE_KEYS = ['organizationId', 'projectId', 'environmentId', 'endpointId', 'eventId', 'normalizedEventId', 'evidenceId', 'observationSessionId', 'batchId', 'observedAt', 'method', 'path', 'origin', 'statusCode', 'contentType', 'authObserved', 'authScheme'];
const BASE_KEYS = ['contractVersion', 'baselineId', 'generationClass', 'source', 'responseSchemaVersionId', 'responseSchemaHash', 'requestFingerprint', 'fingerprintScope', 'requestBodyEncoding', 'requestCoverage', 'responseCoverage', 'inferenceVersion', 'arrayStates', 'selfCheck', 'expiresAt', 'familyKey', 'comparisonPolicy', 'revision', 'enrichment'];
const REASONS = new Set(['REQUEST_QUERY_UNAVAILABLE', 'REPEATED_QUERY_UNAVAILABLE', 'REQUEST_BODY_UNAVAILABLE', 'REQUEST_BODY_TRUNCATED', 'REQUEST_DATA_UNSAFE_OR_UNSUPPORTED', 'REQUEST_PATH_UNAVAILABLE', 'REPEATED_PATH_UNSUPPORTED', 'REQUEST_LIMIT', 'BODY_ON_SAFE_METHOD', 'RESPONSE_UNAVAILABLE', 'PARTIAL_CAPTURE', 'UNKNOWN_STRUCTURE', 'SANITIZED_VALUE', 'UNSUPPORTED_VALUE', 'DEPTH_LIMIT', 'PROPERTY_LIMIT', 'ARRAY_SAMPLE_LIMIT', 'SANITIZED_CONTAINER', 'BODY_TRUNCATED', 'UNSUPPORTED_PROPERTY', 'PROFILE_LIMIT', 'AUTH_CONTEXT_UNAVAILABLE']);
const plain = x => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).every(k => keys.includes(k));
const id = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const date = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && x.length <= 40 && Number.isFinite(Date.parse(x));
function fail(code = 'OBSERVED_BASELINE_CONTRACT_INVALID') { const e = new Error('A baseline observada não possui uma origem válida e verificável.'); e.code = code; e.status = 409; throw e; }
export function validateObservedBaseline(b, scope = {}) {
    if (!exact(b, BASE_KEYS) || b.contractVersion !== OBSERVED_BASELINE_CONTRACT || b.generationClass !== 'OBSERVED_BASELINE' || !/^obl_[a-f0-9]{40}$/.test(b.baselineId))
        fail();
    const s = b.source;
    if (!exact(s, SOURCE_KEYS) || !SOURCE_KEYS.every(k => Object.prototype.hasOwnProperty.call(s, k)))
        fail();
    for (const k of ['organizationId', 'projectId', 'environmentId', 'endpointId', 'eventId', 'normalizedEventId', 'evidenceId', 'observationSessionId', 'batchId'])
        if (!id(s[k]))
            fail();
    for (const k of ['organizationId', 'projectId', 'environmentId', 'endpointId'])
        if (scope[k] && s[k] !== scope[k])
            fail('OBSERVED_BASELINE_SCOPE_MISMATCH');
    if (!date(s.observedAt) || !date(b.expiresAt) || Date.parse(b.expiresAt) <= Date.parse(s.observedAt))
        fail();
    if (!['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(s.method) || typeof s.path !== 'string' || !s.path.startsWith('/') || s.path.startsWith('//') || s.path.length > 2048 || /[?#\r\n]/.test(s.path))
        fail();
    try {
        const origin = new URL(s.origin);
        if (origin.origin !== s.origin || !['http:', 'https:'].includes(origin.protocol))
            fail();
    }
    catch {
        fail();
    }
    if (!Number.isInteger(s.statusCode) || s.statusCode < 200 || s.statusCode > 299 || typeof s.authObserved !== 'boolean')
        fail();
    if (s.contentType !== null && (typeof s.contentType !== 'string' || s.contentType.length > 128 || /[\r\n]/.test(s.contentType)))
        fail();
    if (s.authScheme !== null && !['NONE', 'UNKNOWN', 'BEARER', 'BASIC', 'API_KEY', 'COOKIE', 'CUSTOM', 'TOKEN'].includes(s.authScheme))
        fail();
    if (b.responseSchemaVersionId !== null && !/^csv_[A-Za-z0-9_-]{1,120}$/.test(b.responseSchemaVersionId))
        fail();
    if (b.responseSchemaHash !== null && !/^sch_[a-f0-9]{40}$/.test(b.responseSchemaHash))
        fail();
    if ((b.responseSchemaVersionId === null) !== (b.responseSchemaHash === null))
        fail();
    if (!/^brq_[a-f0-9]{64}$/.test(b.requestFingerprint) || b.fingerprintScope !== 'CANONICAL_CAPTURED_REQUEST_DATA' || !/^bfm_[a-f0-9]{40}$/.test(b.familyKey))
        fail();
    if (!['NONE', 'JSON', 'FORM_URLENCODED', 'UNSUPPORTED'].includes(b.requestBodyEncoding) || b.inferenceVersion !== 'qagent.structural-inference.v2')
        fail();
    if (!exact(b.requestCoverage, ['status', 'reasons', 'headers']) || !['COMPLETE', 'PARTIAL'].includes(b.requestCoverage.status) || b.requestCoverage.headers !== 'AUTH_RUNTIME_AND_CONFIG')
        fail();
    if (!exact(b.responseCoverage, ['status', 'reasons']) || !['COMPLETE', 'PARTIAL', 'NO_BODY'].includes(b.responseCoverage.status))
        fail();
    for (const c of [b.requestCoverage, b.responseCoverage])
        if (!Array.isArray(c.reasons) || c.reasons.length > 24 || c.reasons.some(x => !REASONS.has(x)) || (c.status !== 'PARTIAL' && c.reasons.length))
            fail();
    if (!['PASSED', 'PARTIAL', 'FAILED', 'NO_BODY'].includes(b.selfCheck))
        fail();
    if (!Array.isArray(b.arrayStates) || b.arrayStates.length > 32 || b.arrayStates.some(x => !exact(x, ['path', 'state']) || typeof x.path !== 'string' || x.path.length > 256 || !/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\*\])*$/.test(x.path) || !['EMPTY', 'NON_EMPTY', 'MIXED'].includes(x.state)))
        fail();
    const noBody = s.statusCode === 204 || s.statusCode === 205 || s.method === 'HEAD';
    if ((b.responseCoverage.status === 'NO_BODY') !== noBody || (b.selfCheck === 'NO_BODY') !== noBody)
        fail();
    if (b.selfCheck === 'PASSED' && (b.responseCoverage.status !== 'COMPLETE' || !b.responseSchemaVersionId))
        fail();
    if (b.revision != null) {
        const r = b.revision;
        if (!exact(r, ['previousBaselineId', 'sourceTestDesignVersionId', 'approvedByUserId', 'approvedAt', 'reasonCode'])
            || !/^obl_[a-f0-9]{40}$/.test(r.previousBaselineId) || !id(r.sourceTestDesignVersionId) || !id(r.approvedByUserId) || !date(r.approvedAt)
            || !['APPROVED_PRODUCT_CHANGE', 'RECAPTURE_SOURCE', 'CORRECT_GENERATION', 'COMPARISON_POLICY_REVIEW'].includes(r.reasonCode))
            fail('OBSERVED_BASELINE_APPROVAL_REQUIRED');
    }
    if (b.enrichment != null) validateBaselineEnrichment(b.enrichment, b);
    const p = b.comparisonPolicy;
    if (!exact(p, ['contractVersion', 'mode', 'protectObservedPresence', 'arrayStates', 'confirmedContext']) || p.contractVersion !== OBSERVED_COMPARISON_POLICY || !['STRUCTURE', 'CONTROLLED_STATE'].includes(p.mode) || p.protectObservedPresence !== true)
        fail();
    if (JSON.stringify(p.arrayStates) !== JSON.stringify(b.arrayStates))
        fail();
    if (p.mode === 'CONTROLLED_STATE') {
        if (!exact(p.confirmedContext, ['userId', 'environmentId', 'confirmedAt']) || !id(p.confirmedContext.userId) || !date(p.confirmedContext.confirmedAt) || p.confirmedContext.environmentId !== s.environmentId)
            fail('OBSERVED_BASELINE_CONTEXT_CONFIRMATION_REQUIRED');
    }
    else if (p.confirmedContext !== null)
        fail();
    return b;
}
export function baselineFromSource(source, policy = { mode: 'STRUCTURE' }, actor = null, now = new Date().toISOString()) {
    const b = Object.fromEntries(BASE_KEYS.filter(k => k !== 'comparisonPolicy' && Object.prototype.hasOwnProperty.call(source, k)).map(k => [k, structuredClone(source[k])]));
    b.comparisonPolicy = { contractVersion: OBSERVED_COMPARISON_POLICY, mode: policy.mode || 'STRUCTURE', protectObservedPresence: true, arrayStates: structuredClone(b.arrayStates),
        confirmedContext: policy.mode === 'CONTROLLED_STATE' ? { userId: actor, environmentId: b.source.environmentId, confirmedAt: now } : null };
    return validateObservedBaseline(b);
}
export function observedBaselineReady(b, now = Date.now()) {
    return b.requestCoverage.status === 'COMPLETE' && Date.parse(b.expiresAt) > now
        && ((['COMPLETE', 'NO_BODY'].includes(b.responseCoverage.status) && ['PASSED', 'NO_BODY'].includes(b.selfCheck))
            || (b.enrichment != null && validateBaselineEnrichment(b.enrichment,b).selfCheck === 'PASSED'));
}
/** Never allow an ordinary repair/proposal to silently redefine a protected baseline. */
export function assertNoProtectedBaselineChanges(specification, scenarioIds) {
    const ids = new Set(scenarioIds || []);
    if ((specification?.scenarios || []).some(s => s.generationClass === 'OBSERVED_BASELINE' && ids.has(s.scenarioId)))
        fail('OBSERVED_BASELINE_REBASELINE_REQUIRED');
}
export function canonicalBaselineJson(v) {
    function sort(x) { if (Array.isArray(x))
        return x.map(sort); if (plain(x))
        return Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])); return x; }
    return JSON.stringify(sort(v));
}
export function observedBaselineAssertions(b) {
    const assertions = [{ type: 'STATUS', expectedStatusCodes: [b.source.statusCode] }];
    if (b.source.contentType)
        assertions.push({ type: 'CONTENT_TYPE', expected: [b.source.contentType.split(';', 1)[0].trim().toLowerCase()] });
    const expected = baselineEffectiveResponse(b);
    if (expected.schemaVersionId && b.responseCoverage.status !== 'NO_BODY')
        assertions.push({ type: 'SCHEMA', schemaRef: expected.schemaVersionId });
    return assertions;
}
export function validateObservedBaselineScenario(s, scope = {}) {
    if (s.generationClass !== 'OBSERVED_BASELINE') {
        if (s.baseline != null)
            fail();
        return s;
    }
    const b = validateObservedBaseline(s.baseline, scope);
    const target = s.spec?.target || s.target;
    if (!target || target.catalogEndpointId !== b.source.endpointId || target.method !== b.source.method || target.path !== b.source.path)
        fail('OBSERVED_BASELINE_TARGET_MISMATCH');
    if (canonicalBaselineJson(s.spec?.assertions || s.assertions) !== canonicalBaselineJson(observedBaselineAssertions(b)))
        fail('OBSERVED_BASELINE_EXPECTATION_PROTECTED');
    const auth = s.spec?.auth || s.auth;
    if (b.source.authObserved && auth?.requirement !== 'REQUIRED')
        fail('OBSERVED_BASELINE_AUTH_REQUIRED');
    return s;
}
/** Called inside Registry optimistic append against its current version, not merely a UI flag. */
export function isApprovedBaselineRevision(prior, successor, currentVersionId) {
    const b = successor?.baseline, r = b?.revision;
    if (!r || successor?.generationClass !== 'OBSERVED_BASELINE' || r.previousBaselineId !== prior.baseline.baselineId || r.sourceTestDesignVersionId !== currentVersionId)
        return false;
    if (['organizationId', 'projectId', 'endpointId', 'environmentId', 'method', 'path', 'origin'].some(k => b.source[k] !== prior.baseline.source[k]))
        return false;
    validateObservedBaselineScenario(successor);
    return true;
}

// Learning is an explicit execution purpose, never an implicit READY override.
export const LEARNING_PURPOSE = 'LEARNING';
const LEARNING_SOFT_BLOCKERS = new Set(['OBSERVED_BASELINE_RESPONSE_INCOMPLETE','OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE']);
export function baselineLearningEligibility(scenario, now = Date.now()) {
    const b=scenario?.baseline;
    if(scenario?.generationClass!=='OBSERVED_BASELINE'||!b)return {allowed:false,reason:'NOT_OBSERVED_BASELINE'};
    try { validateObservedBaselineScenario(scenario); } catch(e) { return {allowed:false,reason:e.code}; }
    if(!['GET','HEAD','OPTIONS'].includes(b.source.method))return {allowed:false,reason:'LEARNING_MUTATION_REQUIRES_SEPARATE_AUTHORIZATION'};
    if(Date.parse(b.expiresAt)<=now)return {allowed:false,reason:'OBSERVED_BASELINE_SOURCE_EXPIRED'};
    if(b.requestCoverage.status!=='COMPLETE')return {allowed:false,reason:'OBSERVED_BASELINE_REQUEST_INCOMPLETE'};
    if(b.responseCoverage.status!=='PARTIAL'||b.selfCheck!=='PARTIAL'||b.enrichment)return {allowed:false,reason:'BASELINE_NOT_PARTIAL_LEARNING_CANDIDATE'};
    if(!b.responseSchemaVersionId||!b.responseSchemaHash)return {allowed:false,reason:'OBSERVED_BASELINE_SCHEMA_REQUIRED'};
    if(!scenario.spec?.target?.apiServiceKey)return {allowed:false,reason:'OBSERVED_BASELINE_RUNTIME_REQUIRED'};
    if(b.source.authObserved&&(!scenario.spec?.auth?.authProfileRef||scenario.spec.auth.requirement!=='REQUIRED'))return {allowed:false,reason:'OBSERVED_BASELINE_AUTH_REQUIRED'};
    if(scenario.spec?.auth?.requirement==='REQUIRED'&&!scenario.spec.auth.authProfileRef)return {allowed:false,reason:'OBSERVED_BASELINE_AUTH_REQUIRED'};
    if((scenario.automation?.blockers||[]).some(x=>!LEARNING_SOFT_BLOCKERS.has(x)))return {allowed:false,reason:'LEARNING_OPERATIONAL_BLOCKER'};
    return {allowed:true,reason:'RESPONSE_KNOWLEDGE_INCOMPLETE'};
}
export function baselineEffectiveResponse(b) {
    return b.enrichment ? {schemaVersionId:b.enrichment.responseSchemaVersionId,schemaHash:b.enrichment.responseSchemaHash}
        : {schemaVersionId:b.responseSchemaVersionId,schemaHash:b.responseSchemaHash};
}
export function validateBaselineEnrichment(e,b) {
    if(!exact(e,['contractVersion','proposalId','sourceResultSetId','sourceScenarioResultId','sourceRunId','sourceTestDesignVersionId','environmentId','responseSchemaVersionId','responseSchemaHash','approvedByUserId','approvedAt','selfCheck'])
        || e.contractVersion!=='qagent.baseline-enrichment.v1'||e.selfCheck!=='PASSED')fail('OBSERVED_BASELINE_ENRICHMENT_INVALID');
    for(const k of ['proposalId','sourceResultSetId','sourceScenarioResultId','sourceRunId','sourceTestDesignVersionId','environmentId','approvedByUserId'])if(!id(e[k]))fail('OBSERVED_BASELINE_ENRICHMENT_INVALID');
    if(!date(e.approvedAt)||!/^csv_[A-Za-z0-9_-]{1,120}$/.test(e.responseSchemaVersionId)||!/^sch_[a-f0-9]{40}$/.test(e.responseSchemaHash))fail('OBSERVED_BASELINE_ENRICHMENT_INVALID');
    if(b&&(b.responseCoverage.status!=='PARTIAL'||b.selfCheck!=='PARTIAL'||b.requestCoverage.status!=='COMPLETE'||b.source.environmentId!==e.environmentId||b.responseSchemaVersionId===e.responseSchemaVersionId))fail('OBSERVED_BASELINE_ENRICHMENT_INVALID');
    return e;
}

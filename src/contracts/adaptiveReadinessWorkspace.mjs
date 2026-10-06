/** D: presentation contract only. This module never grants runtime authorization. */
export const WORKSPACE_CONTRACT = 'qagent.adaptive-readiness-workspace.v1';
export const NEXT_ACTION_CONTRACT = 'qagent.readiness-next-action.v1';
export const FILTER_VALUES = Object.freeze({
    execution: ['READY', 'BLOCKED'], expectation: ['VERIFIED', 'EVIDENCED', 'HYPOTHESIS', 'UNKNOWN', 'CONTRADICTED'],
    coverage: ['COMPLETE', 'PARTIAL', 'UNSUPPORTED'], review: ['NONE', 'LEARNING_AVAILABLE', 'PROPOSAL_AVAILABLE', 'HUMAN_REQUIRED'],
    nextAction: ['NONE', 'RUN_LEARNING', 'OPEN_REQUEST_DESIGNER', 'OPEN_AUTH_CONFIGURATION', 'REVIEW_NEGATIVE_STRATEGY', 'EXTEND_ASSERTIONS', 'REVIEW_PROPOSAL', 'HUMAN_REVIEW', 'UNSUPPORTED_CAPABILITY'],
    generationClass: ['OBSERVED_BASELINE', 'AI_EXPLORATORY', 'LEGACY'], method: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
export const FILTER_KEYS = ['execution', 'expectation', 'coverage', 'review', 'issueKind', 'issueCode', 'nextAction', 'generationClass', 'method', 'q'];
export const KPI_KEYS = ['regressionReady', 'learningAvailable', 'needsData', 'coverageToImprove', 'needsStrategy', 'humanReview', 'blocked'];
export const WORKFLOW_STATES = ['IDLE', 'ANALYZE', 'REVIEW_PROPOSAL', 'VERIFY_APPLIED_VERSION', 'VERIFIED', 'PROTECTED', 'UNAVAILABLE'];
export const isWorkspaceId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(x);
const code = x => typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,119}$/.test(x);
const obj = x => x != null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => obj(x) && Object.keys(x).every(k => keys.includes(k));
const codes = x => Array.isArray(x) && x.length <= 132 && x.every(code);
const finiteTime = x => typeof x === 'string' && x.length <= 40 && Number.isFinite(Date.parse(x));
const integer = x => Number.isSafeInteger(x) && x >= 0;
export function workspaceError(code, status = 400) { const e = new Error(code); e.code = code; e.status = status; return e; }
export function emptyWorkspaceFilters() { return Object.fromEntries(FILTER_KEYS.map(k => [k, ''])); }
export function parseWorkspaceQuery(params) {
    const allowed = [...FILTER_KEYS, 'environmentId', 'endpointId', 'testDesignVersionId', 'limit', 'cursor'];
    for (const k of params.keys())
        if (!allowed.includes(k) || params.getAll(k).length !== 1)
            throw workspaceError('READINESS_WORKSPACE_QUERY_INVALID');
    const f = emptyWorkspaceFilters();
    for (const k of FILTER_KEYS) {
        const v = params.get(k) || '';
        if (v.length > (k === 'q' ? 120 : 120) || /[\x00-\x1f\x7f]/.test(v))
            throw workspaceError('READINESS_WORKSPACE_QUERY_INVALID');
        if (v && FILTER_VALUES[k] && !FILTER_VALUES[k].includes(v))
            throw workspaceError('READINESS_WORKSPACE_QUERY_INVALID');
        if (v && ['issueKind', 'issueCode'].includes(k) && !code(v))
            throw workspaceError('READINESS_WORKSPACE_QUERY_INVALID');
        f[k] = v;
    }
    const environmentId = params.get('environmentId'), endpointId = params.get('endpointId') || null, testDesignVersionId = params.get('testDesignVersionId') || null;
    if (!isWorkspaceId(environmentId) || Boolean(endpointId) !== Boolean(testDesignVersionId) || (endpointId && (!isWorkspaceId(endpointId) || !isWorkspaceId(testDesignVersionId))))
        throw workspaceError('READINESS_WORKSPACE_SCOPE_INVALID');
    const raw = params.get('limit') || '3', limit = Number(raw), cursor = params.get('cursor') || null;
    if (!/^[1-5]$/.test(raw) || !integer(limit) || limit < 1 || (cursor && (cursor.length > 14000 || !/^[A-Za-z0-9_-]+$/.test(cursor))) || (endpointId && cursor))
        throw workspaceError('READINESS_WORKSPACE_QUERY_INVALID');
    return { environmentId, endpointId, testDesignVersionId, filters: f, limit, cursor };
}
export function workspaceQuery(query) { const p = new URLSearchParams({ environmentId: query.environmentId, limit: String(query.limit || 3) }); for (const k of FILTER_KEYS)
    if (query.filters?.[k])
        p.set(k, query.filters[k]); for (const k of ['endpointId', 'testDesignVersionId', 'cursor'])
    if (query[k])
        p.set(k, query[k]); return p; }
/** Strict additive validation for the old Console reader too; no blanket acceptance of unknown keys. */
export function validateReadinessShape(v) {
    const assert = x => { if (!x)
        throw workspaceError('READINESS_WORKSPACE_RESPONSE_INVALID', 502); };
    assert(exact(v, ['contractVersion', 'basis', 'evaluationScope', 'execution', 'expectation', 'coverage', 'review', 'regression', 'issues']));
    assert(v.contractVersion === 'qagent.scenario-readiness.v2' && ['NATIVE_V2', 'LEGACY_PROJECTION'].includes(v.basis) && ['TEST_DESIGN_ONLY', 'EVIDENCE_RECONCILED'].includes(v.evaluationScope));
    for (const [dimension, key] of [['execution', 'reasonCodes'], ['coverage', 'gapCodes'], ['review', 'reasonCodes'], ['regression', 'reasonCodes']]) {
        const x = v[dimension];
        assert(exact(x, ['status', key]) && (dimension === 'regression' ? FILTER_VALUES.execution : FILTER_VALUES[dimension]).includes(x.status) && codes(x[key]));
    }
    assert(exact(v.expectation, ['status', 'basis']) && FILTER_VALUES.expectation.includes(v.expectation.status) && code(v.expectation.basis));
    assert(Array.isArray(v.issues) && v.issues.length <= 128);
    for (const i of v.issues) {
        assert(exact(i, ['contractVersion', 'code', 'source', 'kind', 'severity', 'blocksExecution', 'blocksRegression', 'humanRequired', 'resolution', 'path', 'selector', 'expectedType', 'detail']));
        assert(i.contractVersion === 'qagent.readiness-issue.v1' && [i.code, i.source, i.kind, i.severity, i.resolution].every(code) && ['blocksExecution', 'blocksRegression', 'humanRequired'].every(k => typeof i[k] === 'boolean'));
        for (const k of ['path', 'selector', 'expectedType', 'detail'])
            if (i[k] != null)
                assert(typeof i[k] === 'string' && i[k].length <= 500 && !/[\x00-\x1f\x7f]/.test(i[k]));
    }
    if (v.execution.status === 'READY')
        assert(!v.issues.some(i => i.blocksExecution));
    if (v.regression.status === 'READY')
        assert(v.execution.status === 'READY' && ['VERIFIED', 'EVIDENCED'].includes(v.expectation.status) && v.coverage.status === 'COMPLETE' && !v.issues.some(i => i.blocksRegression));
    return v;
}
export function matchesWorkspaceFilters(item, f) { const v = item.readinessV2; return ['execution', 'expectation', 'coverage', 'review'].every(k => !f[k] || v[k].status === f[k]) && (!f.issueKind || v.issues.some(i => i.kind === f.issueKind)) && (!f.issueCode || v.issues.some(i => i.code === f.issueCode)) && (!f.nextAction || item.nextAction.type === f.nextAction) && (!f.generationClass || item.generationClass === f.generationClass) && (!f.method || item.method === f.method) && (!f.q || [item.title, item.scenarioId, item.path].join(' ').toLowerCase().includes(f.q.toLowerCase())); }
export function countWorkspaceItems(items) {
    const out = Object.fromEntries(KPI_KEYS.map(k => [k, 0]));
    for (const i of items) {
        if (!i.complete)
            continue;
        const v = i.readinessV2;
        if (v.regression.status === 'READY' && !i.policyBlocked)
            out.regressionReady++;
        if (['RUN_LEARNING', 'EXTEND_ASSERTIONS'].includes(i.nextAction.type))
            out.learningAvailable++;
        if (v.issues.some(x => x.kind === 'DATA_DEPENDENCY' && x.blocksExecution))
            out.needsData++;
        if (v.coverage.status === 'PARTIAL')
            out.coverageToImprove++;
        if (v.issues.some(x => x.kind === 'AUTH_STRATEGY' || x.code === 'NEGATIVE_CONDITION_NOT_MODELED'))
            out.needsStrategy++;
        if (v.review.status === 'HUMAN_REQUIRED' || i.nextAction.type === 'HUMAN_REVIEW')
            out.humanReview++;
        if (v.execution.status === 'BLOCKED' || i.policyBlocked)
            out.blocked++;
    }
    return out;
}
function validateRefs(m, assert) {
    assert(exact(m, ['contractVersion', 'scenarioId', 'testDesignVersionId', 'environmentId', 'sourceScenarioHash', 'state', 'complete', 'reasonCodes', 'resolvedIssueCodes', 'evidence', 'proposal', 'verification', 'examinedResultCount', 'historyLimit', 'snapshotPersisted']));
    assert(m.contractVersion === 'qagent.readiness-reconciliation.v1' && /^[a-f0-9]{64}$/.test(m.sourceScenarioHash || '') && typeof m.complete === 'boolean' && codes(m.reasonCodes) && codes(m.resolvedIssueCodes) && m.snapshotPersisted === false && integer(m.examinedResultCount) && m.historyLimit === 5);
    assert(['UNCHANGED', 'PENDING_VERIFICATION', 'VERIFIED', 'CONTRADICTED', 'EVIDENCED', 'PROPOSAL_AVAILABLE', 'BASELINE_PROTECTED', 'MUTATION_POLICY_PRESERVED'].includes(m.state));
    for (const [k, fields] of [['evidence', ['resultSetId', 'scenarioResultId', 'runId', 'completedAt']], ['proposal', ['proposalId', 'status', 'sourceTestDesignVersionId', 'resultTestDesignVersionId']], ['verification', ['verificationId', 'proposalId', 'resultSetId']]]) {
        const x = m[k];
        if (x === null)
            continue;
        assert(exact(x, fields));
        for (const field of fields)
            assert(x[field] === null || (field === 'completedAt' ? finiteTime(x[field]) : isWorkspaceId(x[field])));
    }
}
export function validateWorkspaceEnvelope(body, scope, query) {
    const assert = x => { if (!x)
        throw workspaceError('READINESS_WORKSPACE_RESPONSE_INVALID', 502); };
    assert(exact(body, ['status', 'data']) && body.status === 'ok');
    const d = body.data;
    assert(exact(d, ['contractVersion', 'organizationId', 'projectId', 'environmentId', 'computedAt', 'readinessRevision', 'summaryBasis', 'filters', 'permissions', 'summary', 'page', 'items', 'errors', 'complete', 'executionStarted', 'appliedByThisOperation', 'versionsModified', 'aiCalled']));
    assert(d.contractVersion === WORKSPACE_CONTRACT && d.projectId === scope.projectId && isWorkspaceId(d.organizationId) && (!scope.organizationId || d.organizationId === scope.organizationId) && d.environmentId === query.environmentId && finiteTime(d.computedAt) && /^rrev_[a-f0-9]{64}$/.test(d.readinessRevision || ''));
    assert(d.summaryBasis === 'PAGE_ONLY_OVERLAPPING_DIMENSIONS' && exact(d.filters, FILTER_KEYS) && FILTER_KEYS.every(k => d.filters[k] === (query.filters?.[k] || '')));
    assert(exact(d.permissions, ['canWrite']) && typeof d.permissions.canWrite === 'boolean');
    assert(exact(d.summary, ['scannedEndpointCount', 'inventoryEndpointCount', 'scannedScenarioCount', 'matchedScenarioCount', 'classifiedScenarioCount', 'kpis']) && ['scannedEndpointCount', 'scannedScenarioCount', 'matchedScenarioCount', 'classifiedScenarioCount'].every(k => integer(d.summary[k])) && (d.summary.inventoryEndpointCount === null || integer(d.summary.inventoryEndpointCount)) && exact(d.summary.kpis, KPI_KEYS) && KPI_KEYS.every(k => integer(d.summary.kpis[k]) && d.summary.kpis[k] <= d.summary.classifiedScenarioCount));
    assert(exact(d.page, ['limit', 'hasMore', 'nextCursor']) && d.page.limit === query.limit && typeof d.page.hasMore === 'boolean' && (d.page.hasMore ? typeof d.page.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,14000}$/.test(d.page.nextCursor) : d.page.nextCursor === null));
    assert(typeof d.complete === 'boolean' && ['executionStarted', 'appliedByThisOperation', 'versionsModified', 'aiCalled'].every(k => d[k] === false) && Array.isArray(d.items) && d.items.length <= 250 && d.items.length === d.summary.matchedScenarioCount && Array.isArray(d.errors) && d.errors.length <= 5);
    const seen = new Set();
    for (const i of d.items) {
        assert(exact(i, ['endpointId', 'testDesignId', 'testDesignVersionId', 'testDesignVersion', 'scenarioId', 'environmentId', 'title', 'method', 'path', 'generationClass', 'readiness', 'snapshotReadinessV2', 'readinessV2', 'effectiveReadiness', 'readinessReconciliation', 'complete', 'policyBlocked', 'nextAction', 'commands', 'workflow']));
        assert(['endpointId', 'testDesignId', 'testDesignVersionId', 'scenarioId'].every(k => isWorkspaceId(i[k])) && i.environmentId === d.environmentId && integer(i.testDesignVersion) && i.testDesignVersion > 0 && FILTER_VALUES.method.includes(i.method) && FILTER_VALUES.generationClass.includes(i.generationClass) && typeof i.title === 'string' && i.title.length <= 200 && typeof i.path === 'string' && i.path.startsWith('/') && i.path.length <= 2048 && !/[?#\x00-\x1f\x7f]/.test(i.path));
        if (query.endpointId)
            assert(i.endpointId === query.endpointId && i.testDesignVersionId === query.testDesignVersionId);
        const key = [i.endpointId, i.testDesignVersionId, i.scenarioId].join(':');
        assert(!seen.has(key));
        seen.add(key);
        validateReadinessShape(i.snapshotReadinessV2);
        validateReadinessShape(i.readinessV2);
        validateRefs(i.readinessReconciliation, assert);
        const m = i.readinessReconciliation;
        assert(i.readinessV2.evaluationScope === 'EVIDENCE_RECONCILED' && m.scenarioId === i.scenarioId && m.testDesignVersionId === i.testDesignVersionId && m.environmentId === i.environmentId && typeof i.complete === 'boolean' && i.complete === m.complete && typeof i.policyBlocked === 'boolean');
        assert(['READY', 'NEEDS_DATA', 'REVIEW_REQUIRED', 'NEEDS_AUTH', 'NEEDS_ENVIRONMENT', 'UNKNOWN'].includes(i.readiness) && ['READY', 'NEEDS_DATA', 'REVIEW_REQUIRED', 'NEEDS_AUTH', 'NEEDS_ENVIRONMENT'].includes(i.effectiveReadiness));
        assert(exact(i.nextAction, ['contractVersion', 'type', 'enabled', 'reasonCodes']) && i.nextAction.contractVersion === NEXT_ACTION_CONTRACT && FILTER_VALUES.nextAction.includes(i.nextAction.type) && typeof i.nextAction.enabled === 'boolean' && codes(i.nextAction.reasonCodes));
        assert(exact(i.commands, ['analyze', 'regression', 'verify']) && ['analyze', 'regression', 'verify'].every(k => typeof i.commands[k] === 'boolean') && WORKFLOW_STATES.includes(i.workflow));
        if (!d.permissions.canWrite || !i.complete)
            assert(!Object.values(i.commands).some(Boolean));
        if (i.commands.regression)
            assert(i.readinessV2.regression.status === 'READY');
        if (i.commands.verify)
            assert(m.proposal?.status === 'APPLIED' && m.proposal.resultTestDesignVersionId === i.testDesignVersionId && m.verification === null);
        if (i.readinessV2.expectation.status === 'VERIFIED')
            assert(m.verification !== null && m.state === 'VERIFIED' && m.proposal?.status === 'APPLIED' && m.proposal.resultTestDesignVersionId === i.testDesignVersionId && m.verification.proposalId === m.proposal.proposalId);
        if (i.nextAction.enabled && ['RUN_LEARNING', 'EXTEND_ASSERTIONS'].includes(i.nextAction.type))
            assert(i.commands.analyze && d.permissions.canWrite && i.complete);
        assert(matchesWorkspaceFilters(i, d.filters));
    }
    for (const e of d.errors)
        assert(exact(e, ['endpointId', 'testDesignVersionId', 'code']) && isWorkspaceId(e.endpointId) && isWorkspaceId(e.testDesignVersionId) && code(e.code));
    if (d.complete)
        assert(!d.errors.length && d.items.every(i => i.complete));
    assert(d.summary.scannedEndpointCount <= query.limit && d.summary.scannedScenarioCount <= d.summary.scannedEndpointCount * 50);
    assert(d.summary.classifiedScenarioCount <= d.summary.scannedScenarioCount && d.summary.matchedScenarioCount <= d.summary.scannedScenarioCount);
    return d;
}

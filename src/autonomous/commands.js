import { failure, identifier, exact, canonical, activePolicy, READ_METHODS, CHANGE_TYPES, assertOrigin, digest } from './contracts.js';
import { signAuthority, assertAuthorityChange, authorityHash, AUTHORITY_CONTRACT } from './authority.js';
import { autonomousClient, autonomousPath } from './client.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { getOrganizationMember } from '../repositories/organizationRepository.js';
import { getProjectTestReadiness, getRunnerTestArtifact, getLatestTestDesign } from '../services/testRegistryClient.js';
import { parseTestReadinessQuery } from '../contracts/testReadiness.js';
import { getReadinessReconciliation } from '../services/readinessReconciliationClient.js';
import { readinessScenarioHash, readinessReconciliationEnabled } from '../readiness/readinessReconciliation.js';
import { analyzeLearningResolution, verifyLearningResolution } from '../handlers/consoleLearningResolution.js';
import { getEvolutionProposal, getEvolutionPolicy, approveEvolutionProposalsByPolicy, verifyEvolutionOutcome } from '../services/testEvolutionClient.js';
import { createRunV1, getRunV1 } from '../services/runService.js';
import { getRunBundle } from '../repositories/runRepository.js';
import { getResultsLatestRunResultSet } from '../services/resultsReadClient.js';
import { parseEvolutionVerificationKey, assertTerminalHttpTimeout, assertHttpTimeoutResult } from '../lib/evolutionVerificationRetry.js';
import { assertLinkedVerificationRetry, successfulVerification } from '../services/evolutionVerificationRetryService.js';
import { createEvolutionRerunV1 } from '../services/evolutionRerunService.js';
const assert = (ok, code = 'AUTONOMOUS_EVIDENCE_SCOPE_MISMATCH') => { if (!ok)
    failure(code, 409); };
const attention = reasonCode => ({ status: 'NEEDS_ATTENTION', reasonCode });
const wait = (reasonCode = 'AUTONOMOUS_RESULT_PENDING') => ({ status: 'WAIT', reasonCode, delaySeconds: 10 });
const finalRun = s => ['PASSED', 'FAILED', 'ERROR', 'CANCELLED', 'REJECTED'].includes(s);
const proofOf = c => c.changeType === 'ASSERTION_COVERAGE_EXTENSION' ? c.proposed?.coverageProof : c.proposed?.confirmationProof;
export function sourceRunKey(c, i, scenarioId, attempt) { identifier(c.cycleId); identifier(i.itemId); identifier(scenarioId); if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3)
    failure('AUTONOMOUS_ATTEMPT_INVALID'); return `autonomous-learning:${c.cycleId}:${i.itemId}:${scenarioId}:${attempt}`; }
/** Obtain live authorization from the owner of the persisted cycle. Every step
 * rechecks the policy and its delegator; the queue message is only a wake hint. */
export async function learningGrant(common, input, { snapshot = false, ...deps } = {}) {
    exact(input, snapshot ? ['cycleId', 'leaseToken'] : ['cycleId', 'itemId', 'operationId', 'leaseToken']);
    Object.values(input).forEach(identifier);
    if (!readinessReconciliationEnabled(common.env))
        failure('READINESS_RECONCILIATION_DISABLED');
    const data = await (deps.client || autonomousClient)({ ...common, path: autonomousPath(common.projectId, `cycles/${input.cycleId}/authorize`), method: 'POST', body: { leaseToken: input.leaseToken, ...(!snapshot ? { itemId: input.itemId, operationId: input.operationId } : {}) } });
    const { cycle, policy, item, operation } = data;
    assert(cycle?.cycleId === input.cycleId && cycle.organizationId === common.organizationId && cycle.projectId === common.projectId && cycle.status === 'RUNNING' && activePolicy(policy, cycle) && Date.parse(cycle.deadline) > Date.now(), 'AUTONOMOUS_AUTHORIZATION_INACTIVE');
    const member = await (deps.getMember || getOrganizationMember)(common.env, common.organizationId, policy.delegatedByUserId);
    if (member?.status !== 'active' || !['owner', 'admin'].includes(member.role))
        failure('AUTONOMOUS_DELEGATOR_REVOKED', 403);
    const environment = await (deps.getEnvironment || getProjectEnvironment)(common.env, common.organizationId, common.projectId, policy.environmentId);
    if (!['DEV', 'QA', 'STG', 'CUSTOM'].includes(environment?.environmentType))
        failure('AUTONOMOUS_ENVIRONMENT_NOT_CONTROLLED', 403);
    if (!snapshot)
        assert(item?.itemId === input.itemId && item.cycleId === cycle.cycleId && item.organizationId === common.organizationId && item.projectId === common.projectId && operation?.operationId === input.operationId, 'AUTONOMOUS_AUTHORIZATION_SCOPE_MISMATCH');
    return data;
}
export async function snapshotLearningCycle(common, grant, deps = {}) {
    const { cycle: c, policy: p } = grant;
    const params = new URLSearchParams({ view: 'endpoints', limit: '25' });
    if (c.cursor)
        params.set('cursor', c.cursor);
    const inventory = await (deps.inventory || getProjectTestReadiness)({ ...common, query: parseTestReadinessQuery(params) });
    assert(inventory.organizationId === common.organizationId && inventory.projectId === common.projectId, 'AUTONOMOUS_INVENTORY_SCOPE_MISMATCH');
    assert(Array.isArray(inventory.items) && inventory.items.length <= 25 && typeof inventory.page?.hasMore === 'boolean', 'AUTONOMOUS_INVENTORY_INVALID');
    const total = inventory.filteredSummary?.matchingEndpointCount;
    if (Number.isInteger(total) && total > p.limits.maxEndpoints)
        failure('AUTONOMOUS_ENDPOINT_BUDGET_EXCEEDED');
    return { endpoints: inventory.items.map(e => ({ endpointId: identifier(e.endpointId), testDesignVersionId: identifier(e.testDesignVersionId), testDesignVersion: e.testDesignVersion })), hasMore: inventory.page.hasMore, nextCursor: inventory.page.nextCursor || null };
}
function runtimeAuthority(g, versionId, scenarioId) { const { cycle: c, policy: p, item: i, operation: o } = g; return { contractVersion: 'qagent.autonomous-execution-authorization.v1', kind: 'POLICY_DELEGATION', policyId: p.policyId, policyRevision: p.revision, cycleId: c.cycleId, itemId: i.itemId, operationId: o.operationId, organizationId: c.organizationId, projectId: c.projectId, environmentId: c.environmentId, testDesignVersionId: versionId, scenarioIds: [scenarioId], allowedOrigins: p.allowedOrigins, expiresAt: c.deadline }; }
async function artifactFor(common, g, versionId, deps) { const a = await (deps.artifact || getRunnerTestArtifact)({ ...common, testDesignVersionId: versionId }); assert(a?.organizationId === common.organizationId && a.projectId === common.projectId && a.endpointId === g.item.endpointId && a.testDesignVersionId === versionId, 'AUTONOMOUS_ARTIFACT_SCOPE_MISMATCH'); return a; }
async function sourceCurrent(common, g, deps) { const latest = await (deps.latest || getLatestTestDesign)({ ...common, endpointId: g.item.endpointId }); assert(latest.exists && latest.testDesign?.versionId === g.item.sourceVersionId, 'AUTONOMOUS_SOURCE_VERSION_STALE'); }
async function projected(common, g, versionId, deps) { const p = await (deps.reconcile || getReadinessReconciliation)({ ...common, endpointId: g.item.endpointId, testDesignVersionId: versionId, environmentId: g.cycle.environmentId }); assert(p.organizationId === common.organizationId && p.projectId === common.projectId && p.endpointId === g.item.endpointId && p.environmentId === g.cycle.environmentId && p.testDesignVersionId === versionId && p.complete === true, 'AUTONOMOUS_READINESS_INCOMPLETE'); return p; }
function eligibleSource(s) { if (s?.generationClass === 'OBSERVED_BASELINE' || s?.baseline)
    return 'AUTONOMOUS_BASELINE_PROTECTED'; if (!READ_METHODS.includes(s?.spec?.target?.method))
    return 'AUTONOMOUS_MUTATION_NOT_SUPPORTED'; if (!['REQUIRED', 'NONE', 'UNAUTHENTICATED'].includes(s?.spec?.auth?.requirement))
    return 'AUTONOMOUS_AUTH_STRATEGY_REQUIRED'; return null; }
function hardIssue(r) { if (r.readinessV2?.expectation?.status === 'CONTRADICTED')
    return 'AUTONOMOUS_EXPECTATION_CONTRADICTED'; if (r.readinessV2?.review?.status === 'HUMAN_REQUIRED' || r.readinessV2?.issues?.some(i => i.humanRequired))
    return 'AUTONOMOUS_HUMAN_DECISION_REQUIRED'; if (r.readinessV2?.coverage?.status === 'UNSUPPORTED')
    return 'AUTONOMOUS_CAPABILITY_UNSUPPORTED'; return null; }
async function candidateProposal(common, g, proposalId, scenarioId, deps) { const p = await (deps.proposal || getEvolutionProposal)({ ...common, proposalId }); assert(p.proposalId === proposalId && p.source?.endpointId === g.item.endpointId && p.source?.scenarioId === scenarioId, 'AUTONOMOUS_PROPOSAL_SCOPE_MISMATCH'); return p; }
function supportedProposal(g, p) { if (!p.changes?.length || p.changes.length !== 1)
    return false; return p.changes.every(c => CHANGE_TYPES.includes(c.changeType) && g.policy.allowedChangeTypes.includes(c.changeType) && proofOf(c)); }
async function latestRunResult(common, runId, deps) { try {
    return await (deps.runResult || getResultsLatestRunResultSet)({ ...common, runId });
}
catch (e) {
    if (e.status === 404)
        return null;
    throw e;
} }
function resultId(d) { return d?.resultSet?.resultSetId || d?.latest?.resultSetId || null; }
function assertResultScope(d, g, r, scenarioId) { const x = d?.resultSet; assert(x && x.organizationId === g.cycle.organizationId && x.projectId === g.cycle.projectId && x.environmentId === g.cycle.environmentId && x.endpointId === g.item.endpointId && x.runId === r.runId && x.testDesignVersionId === r.testDesignVersionId && d.scenarios?.some(s => s.scenarioId === scenarioId), 'AUTONOMOUS_RESULT_SCOPE_MISMATCH'); }
async function timeoutEligibility(common, g, r, scenarioId, deps) { const b = await (deps.bundle || getRunBundle)(common.env, common.organizationId, common.projectId, r.runId); assert(b?.run?.runId === r.runId && b.run.testDesignVersionId === r.testDesignVersionId && b.run.environmentId === g.cycle.environmentId && b.run.scenarioIds?.length === 1 && b.run.scenarioIds[0] === scenarioId); assertTerminalHttpTimeout(b, { cooldown: false }); const d = await latestRunResult(common, r.runId, deps); if (!d)
    failure('AUTONOMOUS_RESULT_PENDING', 409); assertHttpTimeoutResult(d, b); return b; }
/** A single bounded state-machine operation, not an HTTP loop over a project. */
export async function executeLearningStep(common, g, deps = {}) {
    const { cycle: c, policy: p, item: i, operation: o } = g, cmd = o.command;
    // OFF remains an explicit project stop. SUGGEST is superseded only for the
    // narrow classes named in a separately enabled autonomous delegation.
    const evolutionPolicy = await (deps.evolutionPolicy || getEvolutionPolicy)(common);
    if (evolutionPolicy?.mode === 'OFF')
        failure('TEST_EVOLUTION_PROJECT_DISABLED', 409);
    if (cmd.kind === 'PREPARE') {
        await sourceCurrent(common, g, deps);
        const a = await artifactFor(common, g, i.sourceVersionId, deps), scenarios = a.specification?.scenarios;
        assert(Array.isArray(scenarios) && scenarios.length > 0 && scenarios.length <= 50, 'AUTONOMOUS_SCENARIO_LIMIT');
        assert(a.version === i.sourceVersion, 'AUTONOMOUS_ARTIFACT_SCOPE_MISMATCH');
        const projection = await projected(common, g, i.sourceVersionId, deps), map = new Map(projection.items.map(r => [r.scenarioId, r]));
        assert(map.size === scenarios.length, 'AUTONOMOUS_READINESS_INCOMPLETE');
        const out = [];
        for (const s of scenarios) {
            const r = map.get(s.scenarioId);
            assert(r?.readinessReconciliation?.complete === true && r.readinessReconciliation.sourceScenarioHash === await readinessScenarioHash(s), 'AUTONOMOUS_READINESS_HASH_MISMATCH');
            let status = 'ANALYZE', reasonCode = null, proposalId = null, appliedVersionId = null;
            const unavailable = eligibleSource(s), hard = hardIssue(r);
            if (unavailable) {
                status = unavailable === 'AUTONOMOUS_BASELINE_PROTECTED' ? 'PROTECTED' : 'NEEDS_ATTENTION';
                reasonCode = unavailable;
            }
            else if (hard) {
                status = 'NEEDS_ATTENTION';
                reasonCode = hard;
            }
            else if (r.readinessV2.regression?.status === 'READY') {
                status = 'ALREADY_READY';
            }
            else if (r.readinessReconciliation.proposal?.status === 'APPLIED') {
                const prop = r.readinessReconciliation.proposal;
                if (prop.resultTestDesignVersionId === i.sourceVersionId) {
                    status = 'VERIFY';
                    proposalId = prop.proposalId;
                    appliedVersionId = i.sourceVersionId;
                }
                else {
                    status = 'NEEDS_ATTENTION';
                    reasonCode = 'AUTONOMOUS_INHERITED_VERSION_MISMATCH';
                }
            }
            out.push({ scenarioId: identifier(s.scenarioId), status, reasonCode, sourceHash: r.readinessReconciliation.sourceScenarioHash, ...(proposalId ? { proposalId, appliedVersionId } : {}) });
        }
        return { status: 'PREPARED', scenarios: out };
    }
    const s = i.document.scenarios.find(x => x.scenarioId === cmd.scenarioId);
    if (cmd.kind === 'ANALYZE') {
        await sourceCurrent(common, g, deps);
        const response = await (deps.analyze || analyzeLearningResolution)({ ...common, userId: null }, { environmentId: c.environmentId, selections: [{ endpointId: i.endpointId, testDesignVersionId: i.sourceVersionId, scenarioId: cmd.scenarioId }] }, deps.analyzeDeps || {}, { deterministicOnly: true });
        const a = response.data?.items?.[0];
        if (!a || a.status === 'ERROR')
            return attention(a?.errorCode || 'AUTONOMOUS_ANALYSIS_UNAVAILABLE');
        if (a.readinessReconciliation?.status === 'UNAVAILABLE' || a.readinessReconciliation?.complete === false)
            return wait('AUTONOMOUS_READINESS_PENDING');
        if (a.readinessV2 && hardIssue(a))
            return attention(hardIssue(a));
        if (a.proposal) {
            const prop = await candidateProposal(common, g, a.proposal.proposalId, cmd.scenarioId, deps);
            if (prop.status === 'APPLIED')
                return prop.result?.testDesignVersionId === i.sourceVersionId ? { status: 'APPLIED', proposalId: prop.proposalId, testDesignVersionId: prop.result.testDesignVersionId } : attention('AUTONOMOUS_SOURCE_ALREADY_EVOLVED');
            if (prop.status !== 'PENDING_REVIEW' || prop.source.testDesignVersionId !== i.sourceVersionId || !supportedProposal(g, prop))
                return attention('AUTONOMOUS_CHANGE_NOT_DELEGATED');
            if (cmd.afterRun && prop.source.runId !== cmd.runId)
                return attention('AUTONOMOUS_NEWER_EVIDENCE_REVIEW_REQUIRED');
            return { status: 'PROPOSED', proposalId: prop.proposalId };
        }
        if (a.status === 'NO_CHANGE_REQUIRED')
            return { status: 'ALREADY_READY' };
        if (a.learning?.allowed === true && !cmd.afterRun)
            return { status: 'LEARNING_AVAILABLE' };
        return attention(a.reason || a.learning?.reason || 'AUTONOMOUS_NO_SUPPORTED_PROPOSAL');
    }
    if (cmd.kind === 'RUN') {
        await sourceCurrent(common, g, deps);
        if (cmd.retryOfRunId) {
            const previous = await (deps.readRun || getRunV1)({ ...common, runId: cmd.retryOfRunId });
            const b = await timeoutEligibility(common, g, previous.run, cmd.scenarioId, deps);
            assert(b.run.idempotencyKey === sourceRunKey(c, i, cmd.scenarioId, cmd.attempt - 1), 'AUTONOMOUS_RETRY_SCOPE_MISMATCH');
            assertTerminalHttpTimeout(b);
        }
        const created = await (deps.createRun || createRunV1)({ ...common, userId: p.delegatedByUserId, executionAuthorization: runtimeAuthority(g, i.sourceVersionId, cmd.scenarioId), input: { contractVersion: 'qagent.run-create.v1', testDesignVersionId: i.sourceVersionId, environmentId: c.environmentId, scenarioIds: [cmd.scenarioId], purpose: 'LEARNING', confirmDiscoveredRuntime: false }, idempotencyKey: sourceRunKey(c, i, cmd.scenarioId, cmd.attempt), deps: deps.runDeps || {} });
        assert(created.run?.testDesignVersionId === i.sourceVersionId && created.run.environmentId === c.environmentId && created.run.scenarioIds?.length === 1 && created.run.scenarioIds[0] === cmd.scenarioId);
        return { status: created.idempotentReplay ? 'REUSED' : 'CREATED', runId: created.run.runId };
    }
    if (cmd.kind === 'RUN_STATUS' || cmd.kind === 'VERIFY_STATUS') {
        const out = await (deps.readRun || getRunV1)({ ...common, runId: cmd.runId }), r = out.run;
        assert(r?.runId === cmd.runId && r.environmentId === c.environmentId && r.endpointId === i.endpointId && r.testDesignVersionId === (cmd.testDesignVersionId || i.sourceVersionId) && r.scenarioIds?.length === 1 && r.scenarioIds[0] === cmd.scenarioId);
        if (!finalRun(r.status))
            return wait();
        if (r.status === 'ERROR') {
            try {
                await timeoutEligibility(common, g, r, cmd.scenarioId, deps);
                return { status: 'RETRYABLE_TIMEOUT', reasonCode: 'RUNNER_HTTP_TIMEOUT' };
            }
            catch (e) {
                if (e.code === 'AUTONOMOUS_RESULT_PENDING')
                    return wait();
                return attention(e.code || 'AUTONOMOUS_RUN_ERROR');
            }
        }
        if (r.status !== 'PASSED')
            return attention('AUTONOMOUS_EXECUTION_NOT_PASSED');
        const d = await latestRunResult(common, r.runId, deps);
        if (!resultId(d))
            return wait();
        assertResultScope(d, g, r, cmd.scenarioId);
        if (cmd.kind === 'RUN_STATUS')
            return { status: 'PASSED', runId: r.runId, resultSetId: resultId(d) };
        const prop = await candidateProposal(common, g, cmd.proposalId, cmd.scenarioId, deps);
        if (prop.outcomeVerification) {
            if (!successfulVerification(prop.outcomeVerification))
                return attention('AUTONOMOUS_VERIFICATION_NOT_CONFIRMED');
            const v = prop.outcomeVerification;
            assert(v.evolved?.testDesignVersionId === cmd.testDesignVersionId && v.rerun?.runId === r.runId && v.rerun?.resultSetId === resultId(d), 'AUTONOMOUS_RECEIPT_SCOPE_MISMATCH');
            return { status: 'VERIFIED', verificationId: v.verificationId, resultSetId: resultId(d) };
        }
        const b = await (deps.bundle || getRunBundle)(common.env, common.organizationId, common.projectId, r.runId), link = parseEvolutionVerificationKey(b?.run?.idempotencyKey);
        assert(link?.proposalId === cmd.proposalId && link.testDesignVersionId === cmd.testDesignVersionId, 'AUTONOMOUS_VERIFICATION_LINK_MISMATCH');
        if (link.attemptNumber > 1)
            await (deps.validateRetry || assertLinkedVerificationRetry)({ ...common, run: b.run, proposal: prop });
        const v = await (deps.verifyOutcome || verifyEvolutionOutcome)({ ...common, userId: null, proposalId: cmd.proposalId, input: { rerunRunId: r.runId, rerunResultSetId: resultId(d) } });
        if (!successfulVerification(v))
            return attention('AUTONOMOUS_VERIFICATION_NOT_CONFIRMED');
        assert(v.evolved?.testDesignVersionId === cmd.testDesignVersionId && v.rerun?.runId === r.runId, 'AUTONOMOUS_RECEIPT_SCOPE_MISMATCH');
        return { status: 'VERIFIED', verificationId: v.verificationId, resultSetId: resultId(d) };
    }
    if (cmd.kind === 'APPLY') {
        const members = [], items = [];
        let applied = 0;
        const projection = await projected(common, g, i.sourceVersionId, deps);
        for (const id of cmd.proposalIds) {
            const state = i.document.scenarios.find(s => s.proposalId === id && s.status === 'PROPOSED');
            assert(state, 'AUTONOMOUS_SELECTION_INVALID');
            const prop = await candidateProposal(common, g, id, state.scenarioId, deps);
            if (prop.status === 'APPLIED')
                applied++;
            else
                assert(prop.status === 'PENDING_REVIEW' || prop.status === 'APPROVED' || prop.status === 'APPLY_ERROR', 'AUTONOMOUS_PROPOSAL_STATE_INVALID');
            assert(prop.source.testDesignVersionId === i.sourceVersionId && supportedProposal(g, prop), 'AUTONOMOUS_CHANGE_NOT_DELEGATED');
            const r = projection.items.find(x => x.scenarioId === state.scenarioId);
            assert(r && !hardIssue(r), 'AUTONOMOUS_HUMAN_DECISION_REQUIRED');
            const change = prop.changes[0];
            members.push({ proposalId: id, scenarioId: state.scenarioId, changeId: change.changeId, changeType: change.changeType, proofHash: await authorityHash(proofOf(change)) });
            items.push({ proposalId: id, acceptedChangeIds: [change.changeId] });
        }
        // An idempotent policy decision uses stable members/policy/cycle IDs; an
        // already committed append can be recovered without a second human decision.
        if (!applied)
            await sourceCurrent(common, g, deps);
        const authority = await signAuthority(common.env, { contractVersion: AUTHORITY_CONTRACT, kind: 'POLICY_DELEGATION', decisionId: o.operationId, policyId: p.policyId, policyRevision: p.revision, policyHash: p.policyHash, cycleId: c.cycleId, itemId: i.itemId, organizationId: c.organizationId, projectId: c.projectId, endpointId: i.endpointId, environmentId: c.environmentId, sourceTestDesignVersionId: i.sourceVersionId, delegatedByUserId: p.delegatedByUserId, delegatedAt: p.delegatedAt, expiresAt: c.deadline, members });
        const response = await (deps.apply || approveEvolutionProposalsByPolicy)({ ...common, userId: null, input: { items, reason: `Autorizado pela política ${p.policyId} revisão ${p.revision}, ciclo ${c.cycleId}.`, approvalAuthorization: authority } });
        assert(response.status === 'APPLIED' && response.result?.testDesignVersionId, 'AUTONOMOUS_APPLICATION_NOT_COMPLETED');
        return { status: 'APPLIED', decisionId: authority.decisionId, testDesignVersionId: response.result.testDesignVersionId, testDesignVersion: response.result.testDesignVersion, proposals: (response.proposals || []).map(p => ({ proposalId: p.proposalId, status: p.status, testDesignVersionId: p.result?.testDesignVersionId })) };
    }
    if (cmd.kind === 'VERIFY') {
        const prop = await candidateProposal(common, g, cmd.proposalId, cmd.scenarioId, deps);
        assert(prop.status === 'APPLIED' && prop.result?.testDesignVersionId === cmd.testDesignVersionId, 'AUTONOMOUS_APPLIED_VERSION_MISMATCH');
        const executionAuthorization = runtimeAuthority(g, cmd.testDesignVersionId, cmd.scenarioId);
        const out = await (deps.verify || verifyLearningResolution)({ ...common, userId: p.delegatedByUserId, executionAuthorization }, { proposalIds: [cmd.proposalId], confirmExecution: true, ...(cmd.retryOfRunId ? { retryOfRunId: cmd.retryOfRunId } : {}) }, deps.verifyDeps || {});
        const x = out.data?.items?.[0];
        if (!x)
            return attention('AUTONOMOUS_VERIFICATION_UNAVAILABLE');
        if (x.status === 'ERROR' && x.retryAfterSeconds)
            return { status: 'WAIT', delaySeconds: x.retryAfterSeconds, reasonCode: x.errorCode };
        if (x.status === 'VERIFIED')
            return { status: 'VERIFIED' };
        if (!['CREATED', 'REUSED'].includes(x.status))
            return attention(x.errorCode || 'AUTONOMOUS_VERIFICATION_NOT_CONFIRMED');
        assert(x.testDesignVersionId === cmd.testDesignVersionId);
        return { status: x.status, runId: x.runId };
    }
    if (cmd.kind === 'RECONCILE') {
        const a = await artifactFor(common, g, cmd.testDesignVersionId, deps), projection = await projected(common, g, cmd.testDesignVersionId, deps), r = projection.items.find(x => x.scenarioId === cmd.scenarioId), source = a.specification.scenarios.find(x => x.scenarioId === cmd.scenarioId);
        assert(r && source && r.readinessReconciliation.sourceScenarioHash === await readinessScenarioHash(source), 'AUTONOMOUS_READINESS_HASH_MISMATCH');
        const q = r.readinessV2, m = r.readinessReconciliation;
        if (q.expectation.status === 'VERIFIED' && q.coverage.status === 'COMPLETE' && q.regression.status === 'READY' && q.execution.status === 'READY' && m.state === 'VERIFIED' && m.verification?.proposalId === cmd.proposalId && m.verification.resultSetId === m.evidence?.resultSetId) {
            return { status: 'VERIFIED', verificationId: m.verification.verificationId, resultSetId: m.verification.resultSetId };
        }
        return attention(hardIssue(r) || 'AUTONOMOUS_RECONCILIATION_NOT_VERIFIED');
    }
    failure('AUTONOMOUS_COMMAND_UNSUPPORTED', 400);
}

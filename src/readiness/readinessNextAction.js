import { NEXT_ACTION_CONTRACT } from '../contracts/adaptiveReadinessWorkspace.mjs';
import { assessLearningAdmission } from './learningAdmissionV2.js';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Presentation projection from trusted, hash-bound data. Actual writes always revalidate. */
export function readinessNextAction(source, item, { canWrite = false, now = Date.now() } = {}) {
    const v = item.readinessV2, m = item.readinessReconciliation;
    const issues = v.issues, complete = m.complete === true;
    const baseline = source.generationClass === 'OBSERVED_BASELINE' || source.baseline != null;
    const safe = SAFE.has(source.spec?.target?.method);
    const expired = baseline && source.baseline?.expiresAt && Date.parse(source.baseline.expiresAt) <= now;
    const commands = { analyze: false, regression: false, verify: false };
    let type = 'NONE', workflow = 'IDLE', reasons = [], policyBlocked = !safe || Boolean(expired);
    if (!complete) {
        workflow = 'UNAVAILABLE';
        reasons = ['READINESS_EVIDENCE_UNAVAILABLE'];
    }
    else if (baseline) {
        workflow = 'PROTECTED';
        reasons = [expired ? 'OBSERVED_BASELINE_SOURCE_EXPIRED' : 'OBSERVED_BASELINE_PROTECTED'];
        commands.regression = canWrite && safe && !expired && v.regression.status === 'READY';
        if (v.review.status === 'HUMAN_REQUIRED')
            type = 'HUMAN_REVIEW';
    }
    else if (!safe) {
        workflow = 'PROTECTED';
        reasons = ['LEARNING_MUTATION_NOT_ALLOWED'];
    }
    else {
        const effective = structuredClone(source);
        effective.readinessV2 = structuredClone(v);
        const admission = assessLearningAdmission(effective, { enabled: true });
        const applied = m.proposal?.status === 'APPLIED' && m.proposal.resultTestDesignVersionId === item.testDesignVersionId;
        const pending = applied && !m.verification;
        if (v.expectation.status === 'CONTRADICTED' || v.review.status === 'HUMAN_REQUIRED' || issues.some(i => i.humanRequired)) {
            type = issues.some(i => i.kind === 'AUTH_STRATEGY') ? 'REVIEW_NEGATIVE_STRATEGY' : v.coverage.status === 'UNSUPPORTED' ? 'UNSUPPORTED_CAPABILITY' : 'HUMAN_REVIEW';
            reasons = issues.filter(i => i.humanRequired).map(i => i.code);
        }
        else if (pending) {
            type = 'REVIEW_PROPOSAL';
            workflow = 'VERIFY_APPLIED_VERSION';
            commands.verify = canWrite && v.execution.status === 'READY';
            reasons = ['EXPECTATION_REVALIDATION_REQUIRED'];
        }
        else if (m.proposal && ['PENDING_REVIEW', 'APPROVED', 'APPLY_ERROR'].includes(m.proposal.status)) {
            type = 'REVIEW_PROPOSAL';
            workflow = 'REVIEW_PROPOSAL';
        }
        else if (v.coverage.status === 'UNSUPPORTED') {
            type = 'UNSUPPORTED_CAPABILITY';
            reasons = v.coverage.gapCodes;
        }
        else if (issues.some(i => i.blocksExecution && ['AUTH_PROFILE_REQUIRED', 'AUTH_CONFIGURATION_REQUIRED'].includes(i.code))) {
            type = 'OPEN_AUTH_CONFIGURATION';
            reasons = issues.filter(i => i.blocksExecution).map(i => i.code);
        }
        else if (issues.some(i => i.kind === 'AUTH_STRATEGY') || admission.reason?.startsWith('NEGATIVE_REQUEST_') || admission.reason === 'LEARNING_CONDITION_DATA_REQUIRED') {
            type = admission.reason === 'LEARNING_CONDITION_DATA_REQUIRED' ? 'OPEN_REQUEST_DESIGNER' : 'REVIEW_NEGATIVE_STRATEGY';
            reasons = [admission.reason || 'AUTH_STRATEGY_NOT_MODELED'];
        }
        else if (v.execution.status === 'BLOCKED') {
            type = issues.some(i => i.kind === 'DATA_DEPENDENCY' || i.code === 'REQUEST_MODEL_INVALID') ? 'OPEN_REQUEST_DESIGNER' : 'NONE';
            reasons = v.execution.reasonCodes;
        }
        else if (v.regression.status === 'READY') {
            workflow = v.expectation.status === 'VERIFIED' ? 'VERIFIED' : 'IDLE';
            commands.regression = canWrite && admission.allowed;
            if (!admission.allowed) {
                type = 'HUMAN_REVIEW';
                reasons = [admission.reason || 'LEARNING_UNAVAILABLE'];
            }
        }
        else if (admission.allowed || admission.preparationAllowed) {
            type = v.coverage.status === 'PARTIAL' ? 'EXTEND_ASSERTIONS' : 'RUN_LEARNING';
            workflow = 'ANALYZE';
            commands.analyze = canWrite;
            reasons = v.coverage.status === 'PARTIAL' ? v.coverage.gapCodes : v.review.reasonCodes;
        }
        else {
            type = 'HUMAN_REVIEW';
            reasons = [admission.reason || 'LEARNING_UNAVAILABLE'];
        }
    }
    const passive = ['OPEN_REQUEST_DESIGNER', 'OPEN_AUTH_CONFIGURATION', 'REVIEW_NEGATIVE_STRATEGY', 'HUMAN_REVIEW', 'UNSUPPORTED_CAPABILITY'].includes(type);
    return { nextAction: { contractVersion: NEXT_ACTION_CONTRACT, type, enabled: complete && (passive || type === 'REVIEW_PROPOSAL' || commands.analyze), reasonCodes: [...new Set(reasons.filter(Boolean))].sort() }, commands, workflow, policyBlocked };
}

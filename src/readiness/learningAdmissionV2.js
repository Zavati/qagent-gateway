/** 08.1.7-B. Admission policy, not an execution permit or maturity transition.
 * Inputs are authoritative Registry scenarios. Browser/model hints are not inputs.
 * Mirrored deliberately in Gateway/Evolution/Registry until the shared-policy debt
 * is addressed. Native classification never reads automation.blockers.
 */
import { assessExploratoryLearning, buildExploratoryLearningAdmission, learningReadinessDiagnostics } from '../learningScenarioEligibility.js';
import { assertionCoverageGaps } from '../coverageAssertions.js';
import { negativePreparationGate } from '../negativeRequestStrategy.js';
import { adaptLegacyScenarioReadiness } from './legacyReadinessAdapter.js';
import { collectScenarioReadinessIssues } from './scenarioReadinessFacts.js';
import { validateScenarioReadinessV2, projectLegacyReadiness } from './scenarioReadinessV2.js';
import { normalizeReadinessIssues, READINESS_ISSUE_DEFINITIONS } from './readinessIssues.js';

export const STRUCTURED_ADMISSION_BASIS = 'STRUCTURED_READINESS_V2';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v || {}, k);
const unique = xs => [...new Set(xs)].sort();
// Wire compatibility ONLY. These codes are generated from validated structured facts,
// not from prose, and remain accepted by the unchanged Runner admission.v1 validator.
const WIRE = Object.freeze({
  EXPECTATION_STATUS_NOT_OBSERVED: 'LEARNING_EXPECTATION_NOT_OBSERVED',
  EXPECTATION_CONTENT_TYPE_NOT_OBSERVED: 'LEARNING_EXPECTATION_NOT_OBSERVED',
  EXPECTATION_LITERAL_UNVERIFIED: 'LEARNING_LITERAL_EXPECTATION_UNVERIFIED',
  EXPECTATION_HYPOTHESIS_UNVERIFIED: 'LEARNING_HYPOTHESIS_UNVERIFIED',
  EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED: 'LEARNING_RESPONSE_KNOWLEDGE_REQUIRED',
  EXPECTATION_UNKNOWN: 'LEARNING_RESPONSE_KNOWLEDGE_REQUIRED',
  EXPECTATION_REVALIDATION_REQUIRED: 'LEARNING_HYPOTHESIS_UNVERIFIED',
  ASSERTION_TYPE_REQUIRED: 'LEARNING_ASSERTION_COVERAGE_GAP',
  ASSERTION_PATH_REQUIRED: 'LEARNING_ASSERTION_COVERAGE_GAP',
  ASSERTION_PAGINATION_BOUND_REQUIRED: 'LEARNING_ASSERTION_COVERAGE_GAP',
  ASSERTION_STATUS_REQUIRED: 'LEARNING_ASSERTION_COVERAGE_GAP',
  ASSERTION_CONTENT_TYPE_REQUIRED: 'LEARNING_ASSERTION_COVERAGE_GAP',
  ASSERTION_SCHEMA_INCOMPLETE: 'LEARNING_ASSERTION_COVERAGE_GAP',
  PATH_PARAM_UNRESOLVED: 'LEARNING_PATH_DATA_TO_RESOLVE',
});

function specialUnresolvedCondition(scenario) {
  return scenario?.category === 'NEGATIVE' && (scenario.spec?.assertions || []).some(a =>
    (a.type === 'STATUS' && (a.expectedStatusCodes || []).includes(404)) ||
    (a.type === 'JSON_PATH_EQUALS' && Array.isArray(a.expected) && a.expected.length === 0));
}
function denial(reason, extra = {}) {
  return { allowed: false, preparationAllowed: false, reason, blockers: [reason],
    knowledgeWarnings: [], deferredBlockers: [], ...extra };
}
function samePreparationSource(source, prepared) {
  // Data preparation may change bindings only. It cannot repair intent/auth/target,
  // assertions, readiness or policy under cover of clearing PATH_PARAM_UNRESOLVED.
  const strip = s => { const out = structuredClone(s); if (out.spec) delete out.spec.testData; return out; };
  return JSON.stringify(strip(source)) === JSON.stringify(strip(prepared));
}

/** `preparationAllowed` is NOT `allowed`: it can start bounded data resolution only.
 * Only ordinary missing path data may be privately prepared; special negative
 * conditions, secrets, auth, runtime, unsupported and policy issues stay fail-closed.
 * `preparedScenario` comes only from the server's existing test-data preparer.
 */
export function assessLearningAdmission(scenario, { enabled = false, preparedScenario = null } = {}) {
  if (!enabled) return assessExploratoryLearning(scenario);
  if (scenario?.generationClass === 'OBSERVED_BASELINE' || scenario?.baseline != null) {
    return denial('LEARNING_BASELINE_REQUIRES_EXISTING_POLICY');
  }
  let snapshot, native, facts;
  try {
    if (own(scenario, 'readinessV2')) {
      snapshot = validateScenarioReadinessV2(scenario.readinessV2);
      native = snapshot.basis === 'NATIVE_V2';
    } else native = false;
    if (!native) snapshot = adaptLegacyScenarioReadiness(scenario);
    if (preparedScenario && !samePreparationSource(scenario, preparedScenario)) {
      return denial('LEARNING_PREPARATION_SOURCE_MISMATCH');
    }
    facts = collectScenarioReadinessIssues(preparedScenario || scenario);
  } catch {
    return denial('SCENARIO_READINESS_V2_INVALID', { admissionBasis: 'INVALID_V2' });
  }
  const basis = native ? STRUCTURED_ADMISSION_BASIS : 'LEGACY_PROJECTION';
  let legacy = null;
  // B retains the bounded, conservative legacy adapter/policy, including its
  // unknown-text fail-closed rule. This branch never handles a native snapshot.
  if (!native) {
    legacy = assessExploratoryLearning(scenario);
    if (!legacy.allowed) return { ...legacy, preparationAllowed: false, admissionBasis: basis };
  }
  let issues = normalizeReadinessIssues([...snapshot.issues, ...facts]);
  const originalPathIssue = issues.some(i => i.code === 'PATH_PARAM_UNRESOLVED');
  const pathPrepared = Boolean(preparedScenario) && !facts.some(i => i.code === 'PATH_PARAM_UNRESOLVED');
  // This removes only a data-dependency classification in a private admission
  // view. It never edits the stored snapshot nor promotes expectation/coverage.
  if (pathPrepared && !specialUnresolvedCondition(scenario)) {
    issues = issues.filter(i => i.code !== 'PATH_PARAM_UNRESOLVED');
  }
  const gaps = assertionCoverageGaps(scenario);
  const coveragePartial = snapshot.coverage.status === 'PARTIAL' || issues.some(i => i.kind === 'ASSERTION_COVERAGE');
  const mapped = unique([...snapshot.issues, ...facts].map(i => WIRE[i.code]).filter(Boolean));
  if (native && snapshot.expectation.status === 'HYPOTHESIS' && !mapped.some(c => c !== 'LEARNING_PATH_DATA_TO_RESOLVE' && c !== 'LEARNING_ASSERTION_COVERAGE_GAP')) mapped.push('LEARNING_HYPOTHESIS_UNVERIFIED');
  if (native && snapshot.expectation.status === 'UNKNOWN') mapped.push('LEARNING_RESPONSE_KNOWLEDGE_REQUIRED');
  if (coveragePartial) mapped.push('LEARNING_ASSERTION_COVERAGE_GAP');
  const deferred = native ? unique(mapped) : legacy.deferredBlockers;
  const metadata = {
    admissionBasis: basis, readinessContractVersion: snapshot.contractVersion,
    sourceExecutionStatus: snapshot.execution.status,
    executionStatus: issues.some(i => i.blocksExecution) ? 'BLOCKED' : 'READY',
    expectationStatus: snapshot.expectation.status,
    coverageStatus: snapshot.coverage.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : coveragePartial ? 'PARTIAL' : 'COMPLETE',
    issueCodes: unique(issues.map(i => i.code)),
    resolvedIssueCodes: pathPrepared && originalPathIssue && !specialUnresolvedCondition(scenario) ? ['PATH_PARAM_UNRESOLVED'] : [],
    deferredBlockers: deferred,
    knowledgeWarnings: native ? deferred.filter(c => c !== 'LEARNING_PATH_DATA_TO_RESOLVE') : legacy.knowledgeWarnings,
    coverageGaps: gaps, confirmationRequiresCoverage: coveragePartial,
  };
  const deny = (reason, blockers = [reason], preparationAllowed = false) => denial(reason, {
    ...metadata, blockers: unique(blockers), preparationAllowed,
  });
  if (!SAFE.has(scenario?.spec?.target?.method)) return deny('LEARNING_MUTATION_NOT_ALLOWED');
  if (scenario?.spec?.dslVersion !== 'qagent.api-test-dsl.v1' || scenario?.spec?.type !== 'api') return deny('LEARNING_REQUEST_DSL_UNSUPPORTED');
  if (snapshot.expectation.status === 'CONTRADICTED') return deny('LEARNING_EXPECTATION_CONTRADICTED');
  const human = issues.filter(i => i.humanRequired);
  if (human.length || snapshot.review.status === 'HUMAN_REQUIRED') return deny(human[0]?.code || 'LEARNING_HUMAN_REVIEW_REQUIRED', human.map(i => i.code));
  if (metadata.coverageStatus === 'UNSUPPORTED') return deny('LEARNING_CAPABILITY_UNSUPPORTED');
  const negative = negativePreparationGate(scenario);
  if (!negative.allowed) return deny(negative.reason);
  const blocking = issues.filter(i => i.blocksExecution);
  if (blocking.length) {
    const onlyPath = blocking.every(i => i.code === 'PATH_PARAM_UNRESOLVED');
    if (onlyPath && specialUnresolvedCondition(scenario)) return deny('LEARNING_CONDITION_DATA_REQUIRED');
    return deny(blocking[0].code, blocking.map(i => i.code), onlyPath);
  }
  return { ...metadata, allowed: true, preparationAllowed: false, reason: null, blockers: [] };
}

/** Compatibility projection after private data preparation. All runtime/auth/data
 * materializers and the unchanged Runner remain mandatory independent checks.
 */
export function buildLearningAdmissionForRunner(source, prepared, { enabled = false } = {}) {
  if (!enabled) return buildExploratoryLearningAdmission(prepared);
  const assessment = assessLearningAdmission(source, { enabled, preparedScenario: prepared });
  if (!assessment.allowed) return null;
  const native = assessment.admissionBasis === STRUCTURED_ADMISSION_BASIS;
  return {
    contractVersion: 'qagent.exploratory-learning-admission.v1',
    sourceReadiness: native ? projectLegacyReadiness(source.readinessV2) : source.automation.readiness,
    deferredBlockers: assessment.deferredBlockers,
  };
}

export function learningAdmissionDiagnostics(scenario, { enabled = false, preparedScenario = null } = {}) {
  if (!enabled) return learningReadinessDiagnostics(scenario);
  const a = assessLearningAdmission(scenario, { enabled, preparedScenario });
  return {
    contractVersion: 'qagent.semantic-readiness-diagnostics.v1',
    basis: a.admissionBasis === STRUCTURED_ADMISSION_BASIS ? 'SYSTEM_STRUCTURED_READINESS_V2' : a.admissionBasis === 'INVALID_V2' ? 'INVALID_STRUCTURED_READINESS' : 'SYSTEM_DSL_AND_LEGACY_REASON_ANALYSIS',
    currentReadiness: scenario?.automation?.readiness || null,
    canInvestigate: a.allowed,
    issues: (a.issueCodes || a.blockers || []).slice(0,30).map(code => ({ code,
      kind: READINESS_ISSUE_DEFINITIONS[code]?.kind || 'OPERATIONAL_BLOCKER' })),
    coverageLimited: a.confirmationRequiresCoverage === true,
  };
}

/** Proof validation is versioned by this discriminator, NOT the current rollout
 * flag. An old persisted proof must retain its original admission interpretation.
 */
export function assessLearningProofSource(source, admissionBasis = null) {
  if (admissionBasis == null) return assessExploratoryLearning(source);
  if (admissionBasis !== STRUCTURED_ADMISSION_BASIS || source?.readinessV2?.basis !== 'NATIVE_V2') {
    return denial('LEARNING_CONFIRMATION_ADMISSION_SOURCE_MISMATCH');
  }
  return assessLearningAdmission(source, { enabled: true });
}

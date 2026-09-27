import {
  ScenarioReadinessError, assertReadinessKeys, normalizeReadinessIssues, validateReadinessIssue,
} from './readinessIssues.js';
export const SCENARIO_READINESS_VERSION = 'qagent.scenario-readiness.v2';
export const READINESS_EVALUATION_SCOPE = 'TEST_DESIGN_ONLY';
export const READINESS_BASES = Object.freeze(['NATIVE_V2', 'LEGACY_PROJECTION']);
export const EXPECTATION_BASES = Object.freeze({
  OBSERVED_EVIDENCE: 'EVIDENCED', OBSERVED_BASELINE: 'EVIDENCED',
  AI_ASSUMED: 'HYPOTHESIS', UNOBSERVED_EXPECTATION: 'HYPOTHESIS',
  LEGACY_OBSERVED_EVIDENCE: 'EVIDENCED', LEGACY_ASSUMED: 'HYPOTHESIS',
  LEGACY_UNVERIFIED: 'HYPOTHESIS', DERIVATION_PENDING_VERIFICATION: 'HYPOTHESIS',
  UNDETERMINED: 'UNKNOWN', VERSION_VERIFICATION: 'VERIFIED', COMPATIBLE_CONTRADICTION: 'CONTRADICTED',
});
export function scenarioReadinessV2Enabled(env = {}) {
  return ['true', '1'].includes(String(env?.SCENARIO_READINESS_V2_ENABLED ?? 'false').trim().toLowerCase());
}
const unique = xs => [...new Set(xs)].sort();
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const mature = status => ['EVIDENCED', 'VERIFIED'].includes(status);
function coverageFor(issues) {
  const unsupported = issues.filter(i => i.kind === 'UNSUPPORTED_CAPABILITY');
  const gaps = issues.filter(i => i.kind === 'ASSERTION_COVERAGE');
  return { status: unsupported.length ? 'UNSUPPORTED' : gaps.length ? 'PARTIAL' : 'COMPLETE',
    gapCodes: unique([...unsupported, ...gaps].map(i => i.code)) };
}
function regressionFor(execution, expectation, coverage, issues) {
  const reasonCodes = unique([
    ...(execution.status !== 'READY' ? ['EXECUTION_BLOCKED'] : []),
    ...(!mature(expectation.status) ? ['EXPECTATION_NOT_MATURE'] : []),
    ...(coverage.status !== 'COMPLETE' ? ['COVERAGE_INCOMPLETE'] : []),
    ...issues.filter(i => i.blocksRegression).map(i => i.code),
  ]);
  return { status: reasonCodes.length ? 'BLOCKED' : 'READY', reasonCodes };
}
function reviewFor(execution, expectation, coverage, issues, learningPolicyAllows, proposalAvailable) {
  const human = issues.filter(i => i.humanRequired);
  if (human.length) return { status: 'HUMAN_REQUIRED', reasonCodes: unique(human.map(i => i.code)) };
  if (proposalAvailable) return { status: 'PROPOSAL_AVAILABLE', reasonCodes: [] };
  if (execution.status === 'READY' && learningPolicyAllows && (!mature(expectation.status) || coverage.status === 'PARTIAL')) {
    const reasons = issues.filter(i => ['EXPECTATION_KNOWLEDGE', 'ASSERTION_COVERAGE'].includes(i.kind)).map(i => i.code);
    return { status: 'LEARNING_AVAILABLE', reasonCodes: unique(reasons.length ? reasons : [
      ...(!mature(expectation.status) ? ['EXPECTATION_NOT_MATURE'] : []),
      ...(coverage.status === 'PARTIAL' ? ['COVERAGE_INCOMPLETE'] : []),
    ]) };
  }
  return { status: 'NONE', reasonCodes: [] };
}
/** Pure reducer over SYSTEM-owned facts. No runtime/data access, AI decision or side effect.
 * VERIFIED / CONTRADICTED / PROPOSAL_AVAILABLE are reserved contracts; A does not produce them.
 * LEARNING_AVAILABLE describes a candidate, not an admission/authorization token.
 */
export function evaluateScenarioReadinessV2({ issues = [], expectation = { status: 'UNKNOWN', basis: 'UNDETERMINED' },
  basis = 'NATIVE_V2', learningPolicyAllows = false, proposalAvailable = false } = {}) {
  const normalized = normalizeReadinessIssues(issues);
  const execution = { status: normalized.some(i => i.blocksExecution) ? 'BLOCKED' : 'READY',
    reasonCodes: unique(normalized.filter(i => i.blocksExecution).map(i => i.code)) };
  const coverage = coverageFor(normalized);
  const value = { contractVersion: SCENARIO_READINESS_VERSION, basis, evaluationScope: READINESS_EVALUATION_SCOPE,
    execution, expectation: { ...expectation }, coverage,
    review: reviewFor(execution, expectation, coverage, normalized, learningPolicyAllows === true, proposalAvailable === true),
    regression: regressionFor(execution, expectation, coverage, normalized), issues: normalized };
  return validateScenarioReadinessV2(value);
}
export function projectLegacyReadiness(readiness) {
  validateScenarioReadinessV2(readiness);
  if (readiness.regression.status === 'READY') return 'READY';
  const blockers = readiness.issues.filter(i => i.blocksExecution);
  if (blockers.some(i => i.kind === 'DATA_DEPENDENCY')) return 'NEEDS_DATA';
  if (blockers.some(i => i.code === 'AUTH_PROFILE_REQUIRED')) return 'NEEDS_AUTH';
  if (blockers.some(i => ['RUNTIME_TARGET_MISSING', 'ENVIRONMENT_UNAVAILABLE'].includes(i.code))) return 'NEEDS_ENVIRONMENT';
  return 'REVIEW_REQUIRED';
}
export function validateScenarioReadinessV2(value, { path = 'readinessV2' } = {}) {
  const fail = suffix => { throw new ScenarioReadinessError(suffix ? `${path}.${suffix}` : path); };
  assertReadinessKeys(value, ['contractVersion', 'basis', 'evaluationScope', 'execution', 'expectation', 'coverage', 'review', 'regression', 'issues'], path);
  if (value.contractVersion !== SCENARIO_READINESS_VERSION || !READINESS_BASES.includes(value.basis)
    || value.evaluationScope !== READINESS_EVALUATION_SCOPE) fail();
  if (!Array.isArray(value.issues) || value.issues.length > 128) fail('issues');
  value.issues.forEach((i, n) => validateReadinessIssue(i, `${path}.issues[${n}]`));
  if (!same(value.issues, normalizeReadinessIssues(value.issues))) fail('issues');
  for (const key of ['execution', 'review', 'regression']) {
    assertReadinessKeys(value[key], ['status', 'reasonCodes'], `${path}.${key}`);
    if (!Array.isArray(value[key].reasonCodes) || value[key].reasonCodes.length > 131
      || value[key].reasonCodes.some(s => typeof s !== 'string') || !same(value[key].reasonCodes, unique(value[key].reasonCodes))) fail(key);
  }
  assertReadinessKeys(value.expectation, ['status', 'basis'], `${path}.expectation`);
  if (!Object.hasOwn(EXPECTATION_BASES, value.expectation.basis) || EXPECTATION_BASES[value.expectation.basis] !== value.expectation.status) fail('expectation');
  assertReadinessKeys(value.coverage, ['status', 'gapCodes'], `${path}.coverage`);
  const expectedExecution = { status: value.issues.some(i => i.blocksExecution) ? 'BLOCKED' : 'READY',
    reasonCodes: unique(value.issues.filter(i => i.blocksExecution).map(i => i.code)) };
  if (!same(value.execution, expectedExecution)) fail('execution');
  if (!same(value.coverage, coverageFor(value.issues))) fail('coverage');
  const expectedReview = reviewFor(value.execution, value.expectation, value.coverage, value.issues,
    value.review.status === 'LEARNING_AVAILABLE', value.review.status === 'PROPOSAL_AVAILABLE');
  if (!same(value.review, expectedReview)) fail('review');
  if (!same(value.regression, regressionFor(value.execution, value.expectation, value.coverage, value.issues))) fail('regression');
  return value;
}
/** Native generation contract: old versions with no field remain valid.
 * This is NOT a transition/verification engine; later phases must add proof checks explicitly.
 */
export function validateScenarioReadinessAttachment(scenario, { path = 'scenario', generation = false } = {}) {
  if (!Object.hasOwn(scenario || {}, 'readinessV2')) return false;
  const value = validateScenarioReadinessV2(scenario.readinessV2, { path: `${path}.readinessV2` });
  if (value.basis === 'NATIVE_V2') {
    if (scenario?.automation?.readiness !== projectLegacyReadiness(value)) throw new ScenarioReadinessError(`${path}.automation.readiness`);
    if (scenario?.grounding?.level === 'ASSUMED' && value.expectation.status !== 'HYPOTHESIS') throw new ScenarioReadinessError(`${path}.readinessV2.expectation`);
    if (value.review.status === 'LEARNING_AVAILABLE' && !['GET', 'HEAD', 'OPTIONS'].includes(scenario?.spec?.target?.method)) throw new ScenarioReadinessError(`${path}.readinessV2.review`);
  }
  if (generation && (value.basis !== 'NATIVE_V2' || ['VERIFIED', 'CONTRADICTED'].includes(value.expectation.status)
    || value.review.status === 'PROPOSAL_AVAILABLE')) throw new ScenarioReadinessError(`${path}.readinessV2`, 'SCENARIO_READINESS_V2_TRANSITION_UNSUPPORTED');
  return true;
}

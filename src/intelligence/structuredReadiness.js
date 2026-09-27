import { buildReadinessIssue, normalizeReadinessIssues } from '../readiness/readinessIssues.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness } from '../readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues, isSafeReadinessMethod, scenarioExpectedStatuses } from '../readiness/scenarioReadinessFacts.js';
const SEMANTIC_CODES = Object.freeze({
  SEMANTIC_STATUS_LEARNING: 'EXPECTATION_STATUS_NOT_OBSERVED', SEMANTIC_STATUS_UNOBSERVED: 'EXPECTATION_STATUS_NOT_OBSERVED',
  SEMANTIC_SCHEMA_STATUS_MISMATCH: 'ASSERTION_SCHEMA_INCOMPLETE', SEMANTIC_CONTENT_TYPE_UNOBSERVED: 'EXPECTATION_CONTENT_TYPE_NOT_OBSERVED',
  SEMANTIC_JSON_PATH_VALUE_DEPENDENT: 'UNSUPPORTED_ASSERTION_SELECTOR', SEMANTIC_JSON_PATH_UNMODELED: 'EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED',
  SEMANTIC_EXACT_VALUE_UNGROUNDED: 'EXPECTATION_LITERAL_UNVERIFIED', SEMANTIC_RESPONSE_HEADER_UNOBSERVED: 'EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED',
  SEMANTIC_QUERY_PARAM_UNMODELED: 'REQUEST_MODEL_INVALID', SEMANTIC_PATH_PARAM_UNMODELED: 'REQUEST_MODEL_INVALID',
  SEMANTIC_PATH_PARAM_NEEDS_DATA: 'PATH_PARAM_UNRESOLVED', SEMANTIC_BODY_UNSUPPORTED_FOR_METHOD: 'REQUEST_MODEL_INVALID',
  SEMANTIC_REQUEST_BODY_UNMODELED: 'REQUEST_MODEL_INVALID', SEMANTIC_REQUEST_BODY_FIELDS_UNMODELED: 'REQUEST_MODEL_INVALID',
  SEMANTIC_REQUEST_BODY_NEEDS_DATA: 'BODY_VALUE_REQUIRED', SEMANTIC_REQUEST_HEADER_UNMODELED: 'REQUEST_MODEL_INVALID',
  SEMANTIC_AUTH_CONTRADICTION: 'AUTH_INTENT_CONFLICT', SEMANTIC_AUTH_UNSUPPORTED: 'EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED',
  SEMANTIC_TARGET_MUTATION_UNSUPPORTED: 'UNSUPPORTED_PATH_MUTATION', SEMANTIC_FAULT_INJECTION_UNSUPPORTED: 'UNSUPPORTED_FAULT_INJECTION',
  SEMANTIC_ASSERTION_COVERAGE_GAP: 'UNSUPPORTED_LATENCY_ASSERTION', SEMANTIC_ASSERTION_CAPABILITY_GAP: 'ASSERTION_SCHEMA_INCOMPLETE',
  SEMANTIC_EXTRACT_UNMODELED: 'EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED',
});
/** Side-channel from trusted producers, NOT a field accepted from model output. */
export function structuredSemanticIssues(issues = []) {
  const byScenario = Object.create(null);
  for (const issue of issues) {
    if (issue.code === 'SEMANTIC_EVIDENCE_AUTO_GROUNDED') continue;
    const code = issue.readinessCode || SEMANTIC_CODES[issue.code] || 'OPERATIONAL_BLOCKER';
    (byScenario[issue.scenarioId] ||= []).push(buildReadinessIssue(code, 'SEMANTIC_GUARD'));
  }
  return Object.fromEntries(Object.entries(byScenario).map(([id, xs]) => [id, normalizeReadinessIssues(xs)]));
}
export function structuredPlannerIssue(item, { runtimePending = false } = {}) {
  const code = runtimePending ? 'OBSERVED_RUNTIME_VALUE_PENDING'
    : ['TEST_DATA_MUTATION_INTENT_REQUIRES_EXPLICIT_STRATEGY', 'TEST_DATA_DUPLICATE_INTENT_REQUIRES_OBSERVED_OR_EXPLICIT_STRATEGY'].includes(item.code) ? 'NEGATIVE_CONDITION_NOT_MODELED'
    : item.source === 'SECRET' ? 'SECRET_REQUIRED'
    : item.source === 'OBSERVED' ? 'OBSERVED_VALUE_UNAVAILABLE'
    : item.target === 'PATH_PARAM' ? 'PATH_PARAM_UNRESOLVED'
    : item.target === 'QUERY' ? 'QUERY_VALUE_REQUIRED' : 'BODY_VALUE_REQUIRED';
  return buildReadinessIssue(code, 'TEST_DATA_PLANNER');
}
function expectationFromContext(scenario, context, issues) {
  if (scenario.grounding?.level === 'ASSUMED') return { status: 'HYPOTHESIS', basis: 'AI_ASSUMED' };
  if (scenario.generationClass === 'OBSERVED_BASELINE' && scenario.baseline?.source?.evidenceId) return { status: 'EVIDENCED', basis: 'OBSERVED_BASELINE' };
  if (issues.some(i => i.kind === 'EXPECTATION_KNOWLEDGE')) return { status: 'HYPOTHESIS', basis: 'UNOBSERVED_EXPECTATION' };
  const refs = new Set(scenario.grounding?.evidenceRefs || []);
  const evidence = (context?.evidence || []).filter(e => refs.has(e.evidenceId));
  const statuses = scenarioExpectedStatuses(scenario);
  if (statuses.length && statuses.every(status => evidence.some(e => e.statusCode === status))) return { status: 'EVIDENCED', basis: 'OBSERVED_EVIDENCE' };
  return { status: 'UNKNOWN', basis: 'UNDETERMINED' };
}
/** Attach only after sanitizer, guards, planner and the existing negative gate.
 * No old learning predicate or run authorization is replaced by this function.
 */
export function attachNativeScenarioReadiness(scenario, context, {
  semanticIssues = [], authIssues = [], plannerIssues = [], plannerCompleted = false,
  secretSafeDiagnostics = null, nowMs = null,
} = {}) {
  const structural = collectScenarioReadinessIssues(scenario, { nowMs });
  // These two guard findings are provisional: only the final planner/DSL can decide resolution.
  const preliminary = new Set(['PATH_PARAM_UNRESOLVED', 'BODY_VALUE_REQUIRED']);
  const semantic = semanticIssues.filter(i => !(plannerCompleted && preliminary.has(i.code)));
  const issues = [...structural, ...semantic, ...authIssues, ...plannerIssues];
  if (secretSafeDiagnostics?.reviewRequiredScenarioIds?.includes(scenario.scenarioId)) issues.push(buildReadinessIssue('SENSITIVE_INTENT_REQUIRES_REVIEW', 'SECRET_GUARD'));
  if (secretSafeDiagnostics?.needsDataScenarioIds?.includes(scenario.scenarioId)
    && !(scenario.spec?.testData?.bindings || []).some(b => b.source === 'SECRET' && b.bindingKey)) issues.push(buildReadinessIssue('SECRET_REQUIRED', 'SECRET_GUARD'));
  // Baseline-only source availability is not encoded in the DSL; keep its deterministic source guard.
  if (scenario.generationClass === 'OBSERVED_BASELINE' && scenario.automation?.blockers?.includes('OBSERVED_BASELINE_SOURCE_UNAVAILABLE')) issues.push(buildReadinessIssue('OBSERVED_BASELINE_SOURCE_UNAVAILABLE', 'READINESS_EVALUATOR'));
  const normalized = normalizeReadinessIssues(issues);
  const readinessV2 = evaluateScenarioReadinessV2({ issues: normalized, expectation: expectationFromContext(scenario, context, normalized),
    learningPolicyAllows: isSafeReadinessMethod(scenario) && scenario.generationClass !== 'OBSERVED_BASELINE' });
  const readiness = projectLegacyReadiness(readinessV2);
  const blockers = readiness === 'READY' ? [] : [...new Set([
    ...(scenario.automation?.blockers || []),
    ...(scenario.automation?.blockers?.length ? [] : normalized.map(i => i.code)),
    ...(!normalized.length && readinessV2.expectation.status === 'HYPOTHESIS' ? ['O cenário contém hipótese que precisa de revisão humana.'] : []),
    ...(!normalized.length && readinessV2.expectation.status === 'UNKNOWN' ? ['EXPECTATION_UNKNOWN'] : []),
  ])].slice(0, 10);
  scenario.readinessV2 = readinessV2;
  scenario.automation = { ...scenario.automation, readiness, blockers,
    evolutionState: readiness === 'READY' ? (scenario.automation?.evolutionState === 'LEARNING' ? 'LEARNING' : 'STABLE') : 'BLOCKED' };
  return scenario;
}

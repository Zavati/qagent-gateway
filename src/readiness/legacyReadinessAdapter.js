import { learningBlockerCodes } from '../learningScenarioEligibility.js';
import { buildReadinessIssue, normalizeReadinessIssues } from './readinessIssues.js';
import { evaluateScenarioReadinessV2, validateScenarioReadinessV2 } from './scenarioReadinessV2.js';
import { collectScenarioReadinessIssues, legacyExpectation, isSafeReadinessMethod } from './scenarioReadinessFacts.js';
const MAP = Object.freeze({
  LEARNING_EXPECTATION_NOT_OBSERVED: 'EXPECTATION_STATUS_NOT_OBSERVED',
  LEARNING_HYPOTHESIS_UNVERIFIED: 'EXPECTATION_HYPOTHESIS_UNVERIFIED',
  LEARNING_LITERAL_EXPECTATION_UNVERIFIED: 'EXPECTATION_LITERAL_UNVERIFIED',
  LEARNING_PATH_DATA_TO_RESOLVE: 'PATH_PARAM_UNRESOLVED',
  LEARNING_UNAUTHENTICATED_INTENT: 'EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED',
  LEARNING_ASSERTION_COVERAGE_GAP: 'ASSERTION_TYPE_REQUIRED',
  LEARNING_RESPONSE_KNOWLEDGE_REQUIRED: 'EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED',
  LEARNING_AUTH_STRATEGY_NOT_MODELED: 'AUTH_STRATEGY_NOT_MODELED',
  LEARNING_NONEXISTENT_RESOURCE_NOT_ESTABLISHED: 'NEGATIVE_CONDITION_NOT_MODELED',
  LEARNING_EMPTY_STATE_NOT_ESTABLISHED: 'NEGATIVE_CONDITION_NOT_MODELED',
  NEGATIVE_REQUEST_STRATEGY_REQUIRED: 'NEGATIVE_CONDITION_NOT_MODELED',
  NEGATIVE_REQUEST_TARGET_BINDING_CONFLICT: 'NEGATIVE_CONDITION_NOT_MODELED',
  OBSERVED_BASELINE_RUNTIME_REQUIRED: 'RUNTIME_TARGET_MISSING',
  OBSERVED_BASELINE_AUTH_REQUIRED: 'AUTH_PROFILE_REQUIRED',
  OBSERVED_BASELINE_REQUEST_INCOMPLETE: 'OBSERVED_BASELINE_REQUEST_INCOMPLETE',
  OBSERVED_BASELINE_RESPONSE_INCOMPLETE: 'OBSERVED_BASELINE_RESPONSE_INCOMPLETE',
  OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE: 'OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE',
  OBSERVED_BASELINE_SOURCE_EXPIRED: 'OBSERVED_BASELINE_SOURCE_EXPIRED',
  OBSERVED_BASELINE_SOURCE_UNAVAILABLE: 'OBSERVED_BASELINE_SOURCE_UNAVAILABLE',
});
/** The ONLY readiness-v2 path interpreting legacy blocker text. Never mutates a
 * stored version. Unknown reasons fail closed even when the old label was READY.
 */
export function adaptLegacyScenarioReadiness(scenario, { nowMs = null, derivedVersion = false } = {}) {
  const issues = collectScenarioReadinessIssues(scenario, { source: 'LEGACY_ADAPTER', nowMs });
  const add = code => issues.push(buildReadinessIssue(code, 'LEGACY_ADAPTER'));
  for (const code of learningBlockerCodes(scenario)) add(MAP[code] || 'LEGACY_REASON_UNCLASSIFIED');
  const state = scenario?.automation?.readiness;
  if (!['READY', 'REVIEW_REQUIRED', 'NEEDS_DATA', 'NEEDS_AUTH', 'NEEDS_ENVIRONMENT'].includes(state)) add('LEGACY_READINESS_UNKNOWN');
  if (state === 'NEEDS_AUTH' && !issues.some(i => i.kind === 'AUTH_STRATEGY')) add('AUTH_PROFILE_REQUIRED');
  if (state === 'NEEDS_ENVIRONMENT' && !issues.some(i => ['RUNTIME_TARGET_MISSING', 'ENVIRONMENT_UNAVAILABLE'].includes(i.code))) add('RUNTIME_TARGET_MISSING');
  if (state === 'NEEDS_DATA' && !issues.some(i => i.kind === 'DATA_DEPENDENCY' || i.blocksExecution || i.kind === 'EXPECTATION_KNOWLEDGE')) add('SHARED_BINDING_MISSING');
  if (state === 'REVIEW_REQUIRED' && !issues.length && scenario?.grounding?.level !== 'ASSUMED') add('LEGACY_REASON_UNCLASSIFIED');
  // Existing derivation provenance does not prove the changed expectation.
  // Read model supplies this fact from the immutable version origin, not from a client.
  if (derivedVersion) add('EXPECTATION_REVALIDATION_REQUIRED');
  const expectation = derivedVersion ? { status: 'HYPOTHESIS', basis: 'DERIVATION_PENDING_VERIFICATION' } : legacyExpectation(scenario, issues);
  return evaluateScenarioReadinessV2({ basis: 'LEGACY_PROJECTION', issues: normalizeReadinessIssues(issues),
    expectation, learningPolicyAllows: isSafeReadinessMethod(scenario) && scenario?.generationClass !== 'OBSERVED_BASELINE' });
}
export function readScenarioReadinessV2(scenario, options = {}) {
  // Present-but-invalid v2 must fail closed, never silently downgrade to legacy.
  if (Object.hasOwn(scenario || {}, 'readinessV2')) return structuredClone(validateScenarioReadinessV2(scenario.readinessV2));
  return adaptLegacyScenarioReadiness(scenario, options);
}

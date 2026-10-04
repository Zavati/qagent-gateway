/** 08.1.7-C: immutable snapshots + explicitly scoped, ephemeral evidence projections.
 * No model text, storage, HTTP, authentication or mutation permission is an input here.
 * Evidence and ledger facts MUST be validated by the internal Evolution boundary.
 */
import { buildReadinessIssue, normalizeReadinessIssues } from './readinessIssues.js';
import { evaluateScenarioReadinessV2, projectLegacyReadiness, scenarioReadinessV2Enabled, validateScenarioReadinessV2 } from './scenarioReadinessV2.js';
import { readScenarioReadinessV2 } from './legacyReadinessAdapter.js';
import { collectScenarioReadinessIssues, isSafeReadinessMethod } from './scenarioReadinessFacts.js';
export const READINESS_RECONCILIATION_CONTRACT = 'qagent.readiness-reconciliation.v1';
export const READINESS_DERIVATION_CONTRACT = 'qagent.readiness-derivation.v1';
export function readinessReconciliationEnabled(env = {}) {
  return scenarioReadinessV2Enabled(env) && ['true', '1'].includes(String(env.SCENARIO_READINESS_RECONCILIATION_ENABLED ?? 'false').trim().toLowerCase());
}
export function canonicalReadinessJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalReadinessJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalReadinessJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function readinessScenarioHash(scenario) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalReadinessJson(scenario)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const uniq = xs => [...new Set(xs)].sort();
const issue = code => buildReadinessIssue(code, 'EVIDENCE_RECONCILIATION');
const STATIC_RECOMPUTABLE = new Set(['PATH_PARAM_UNRESOLVED', 'SHARED_BINDING_MISSING', 'RUNTIME_TARGET_MISSING',
  'ASSERTION_TYPE_REQUIRED', 'ASSERTION_PATH_REQUIRED', 'ASSERTION_PAGINATION_BOUND_REQUIRED', 'ASSERTION_STATUS_REQUIRED']);
/** Called only AFTER the Registry validates the approved changes/proofs.
 * A derived version is never VERIFIED by the run that proposed its creation.
 */
export function buildPendingDerivedReadiness(source, derived, { coverageExtension = false } = {}) {
  if (!isSafeReadinessMethod(derived) || source?.generationClass === 'OBSERVED_BASELINE' || source?.baseline || derived?.baseline) return null;
  const previous = readScenarioReadinessV2(source);
  const current = collectScenarioReadinessIssues(derived);
  const currentCodes = new Set(current.map(i => i.code));
  const retained = previous.issues.filter(i => i.kind !== 'EXPECTATION_KNOWLEDGE'
    && i.code !== 'ASSERTION_COVERAGE_VERIFICATION_REQUIRED'
    && !(STATIC_RECOMPUTABLE.has(i.code) && !currentCodes.has(i.code)));
  const issues = [...retained, ...current, issue('EXPECTATION_REVALIDATION_REQUIRED')];
  if (coverageExtension) issues.push(issue('ASSERTION_COVERAGE_VERIFICATION_REQUIRED'));
  return evaluateScenarioReadinessV2({ basis: 'NATIVE_V2', issues,
    expectation: { status: 'HYPOTHESIS', basis: 'DERIVATION_PENDING_VERIFICATION' },
    learningPolicyAllows: isSafeReadinessMethod(derived) });
}
/** Pure maturity reducer. `verificationMatched` is not a browser-supplied boolean:
 * reconciliationService constructs it only from the scoped ledger + validated rerun.
 */
export function reconcileReadinessFacts({ scenario, base = readScenarioReadinessV2(scenario),
  evidence = null, proposalAvailable = false, verificationMatched = false, derivedVersion = false, nowMs = null } = {}) {
  validateScenarioReadinessV2(base);
  const protectedMutation = !isSafeReadinessMethod(scenario);
  const protectedBaseline = scenario?.generationClass === 'OBSERVED_BASELINE' || Boolean(scenario?.baseline);
  let issues = normalizeReadinessIssues([...base.issues, ...collectScenarioReadinessIssues(scenario, { nowMs })]);
  let expectation = { ...base.expectation };
  let state = 'UNCHANGED';
  const pending = derivedVersion || base.expectation.basis === 'DERIVATION_PENDING_VERIFICATION' || scenario?.learning?.phase === 'PENDING_VERIFICATION'
    || scenario?.requestManagement?.phase === 'PENDING_VERIFICATION' || scenario?.scenarioLifecycle?.kind === 'SCENARIO_CLONE';
  if (pending && !protectedBaseline && !protectedMutation) {
    expectation = { status: 'HYPOTHESIS', basis: 'DERIVATION_PENDING_VERIFICATION' };
    issues = normalizeReadinessIssues([...issues, issue('EXPECTATION_REVALIDATION_REQUIRED')]);
    state = 'PENDING_VERIFICATION';
  }
  if (!protectedBaseline && !protectedMutation && evidence?.kind === 'CONTRADICTED') {
    // Reliable failure changes the read projection, never the expected assertion.
    expectation = { status: 'CONTRADICTED', basis: 'COMPATIBLE_CONTRADICTION' };
    issues = normalizeReadinessIssues([...issues.filter(i => i.kind !== 'EXPECTATION_KNOWLEDGE'), issue('EXPECTATION_CONTRADICTION_REQUIRES_REVIEW')]);
    state = 'CONTRADICTED';
  } else if (!protectedBaseline && !protectedMutation && evidence?.kind === 'PASSED') {
    const withoutPending = issues.filter(i => i.kind !== 'EXPECTATION_KNOWLEDGE' && i.code !== 'ASSERTION_COVERAGE_VERIFICATION_REQUIRED');
    const full = evidence.coverageComplete !== false && !withoutPending.some(i => i.blocksExecution || i.humanRequired || ['ASSERTION_COVERAGE', 'UNSUPPORTED_CAPABILITY'].includes(i.kind));
    if (verificationMatched && full) {
      issues = withoutPending;
      expectation = { status: 'VERIFIED', basis: 'VERSION_VERIFICATION' };
      state = 'VERIFIED';
    } else if (!pending) {
      const needsApproval = ['HYPOTHESIS','UNKNOWN','CONTRADICTED'].includes(base.expectation.status)
        || base.issues.some(i => i.kind === 'EXPECTATION_KNOWLEDGE');
      issues = issues.filter(i => i.kind !== 'EXPECTATION_KNOWLEDGE');
      if (needsApproval) issues.push(issue('EXPECTATION_APPROVAL_REQUIRED'));
      expectation = { status: 'EVIDENCED', basis: 'COMPATIBLE_EXECUTION' };
      state = proposalAvailable ? 'PROPOSAL_AVAILABLE' : 'EVIDENCED';
    }
  }
  if (protectedBaseline) state = 'BASELINE_PROTECTED';
  if (protectedMutation) state = 'MUTATION_POLICY_PRESERVED';
  const value = evaluateScenarioReadinessV2({ basis: base.basis, evaluationScope: 'EVIDENCE_RECONCILED', issues,
    expectation, proposalAvailable: !protectedBaseline && !protectedMutation && proposalAvailable,
    learningPolicyAllows: !protectedBaseline && !protectedMutation && expectation.status !== 'CONTRADICTED' && isSafeReadinessMethod(scenario) });
  if (state === 'UNCHANGED' && proposalAvailable && !protectedBaseline && !protectedMutation) state = 'PROPOSAL_AVAILABLE';
  return { readinessV2: value, state, effectiveLegacyReadiness: projectLegacyReadiness(value),
    resolvedIssueCodes: uniq(base.issues.filter(i => !value.issues.some(j => j.code === i.code)).map(i => i.code)) };
}

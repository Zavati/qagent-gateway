import { assertionCoverageGaps } from '../coverageAssertions.js';
import { negativePreparationGate } from '../negativeRequestStrategy.js';
import { buildReadinessIssue, normalizeReadinessIssues, ScenarioReadinessError } from './readinessIssues.js';
import { validateScenarioReadinessAttachment } from './scenarioReadinessV2.js';
const own = (v, k) => Object.prototype.hasOwnProperty.call(v || {}, k);
const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const SECRET = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const isSafeReadinessMethod = scenario => ['GET', 'HEAD', 'OPTIONS'].includes(scenario?.spec?.target?.method);
export function invalidAuthStrategyIntent(scenario) {
  return /(?:autenticacao|credencia(?:l|is)|authentication|credential|token|cookie).{0,30}(?:invalid|expirad)|(?:invalid|expired).{0,30}(?:authentication|credential|token|cookie)/
    .test(norm(`${scenario?.title || ''} ${scenario?.objective || ''}`));
}
function inlineSecret(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return false;
  return Object.entries(value).some(([key, child]) => (SECRET.test(key) && child != null) || inlineSecret(child, depth + 1));
}
function materializedLiteral(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value))
    && (typeof value !== 'string' || (value.trim().length > 0 && !/\{|\}|REDACTED|TRUNCATED/.test(value)));
}
export function scenarioExpectedStatuses(scenario) {
  return [...new Set((scenario?.spec?.assertions || []).filter(a => a?.type === 'STATUS').flatMap(a =>
    Array.isArray(a.expectedStatusCodes) ? a.expectedStatusCodes : Number.isInteger(a.expected) ? [a.expected] : []))];
}
/** Only structural facts available in the immutable design. Runtime resolution and
 * mutation authorization remain independent, mandatory checks at execution time.
 * nowMs is explicit: projections do not consult a clock from inside the pure evaluator.
 */
export function collectScenarioReadinessIssues(scenario, { source = 'READINESS_EVALUATOR', nowMs = null } = {}) {
  const issues = [], add = code => issues.push(buildReadinessIssue(code, source));
  const spec = scenario?.spec || {}, target = spec.target || {}, auth = spec.auth || {};
  if (!target.apiServiceKey) add('RUNTIME_TARGET_MISSING');
  if (!METHODS.includes(target.method) || typeof target.path !== 'string' || !target.path.startsWith('/')
    || target.path.startsWith('//') || /[?#\\\s]/.test(target.path)) add('REQUEST_MODEL_INVALID');
  if (!['NONE', 'REQUIRED', 'UNAUTHENTICATED'].includes(auth.requirement)) add('AUTH_STRATEGY_NOT_MODELED');
  if (auth.requirement === 'REQUIRED' && !auth.authProfileRef) add('AUTH_PROFILE_REQUIRED');
  if (auth.requirement === 'UNAUTHENTICATED' && auth.authProfileRef) add('AUTH_INTENT_CONFLICT');
  if (invalidAuthStrategyIntent(scenario)) add('AUTH_STRATEGY_NOT_MODELED');
  let negative;
  try { negative = negativePreparationGate(scenario); }
  catch { negative = { allowed: false }; }
  if (!negative.allowed) issues.push(buildReadinessIssue('NEGATIVE_CONDITION_NOT_MODELED', 'NEGATIVE_INTENT_GUARD'));
  if (scenario?.generationClass === 'OBSERVED_BASELINE' || scenario?.baseline) {
    const b = scenario?.baseline;
    if (!b?.source?.evidenceId || !b?.baselineId || !Number.isFinite(Date.parse(b?.expiresAt || ''))) add('OBSERVED_BASELINE_PROVENANCE_INVALID');
    if (b && Number.isFinite(nowMs) && Date.parse(b.expiresAt) <= nowMs) add('OBSERVED_BASELINE_SOURCE_EXPIRED');
    if (b?.requestCoverage?.status !== 'COMPLETE') add('OBSERVED_BASELINE_REQUEST_INCOMPLETE');
    // Existing reviewed enrichment remains protected; this is not evidence reconciliation.
    const enriched = b?.enrichment?.selfCheck === 'PASSED';
    if (!enriched && !['COMPLETE', 'NO_BODY'].includes(b?.responseCoverage?.status)) {
      add('OBSERVED_BASELINE_RESPONSE_INCOMPLETE'); add('ASSERTION_SCHEMA_INCOMPLETE');
    }
    if (!enriched && !['PASSED', 'NO_BODY'].includes(b?.selfCheck)) add('OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE');
  } else {
    const bindings = Array.isArray(spec.testData?.bindings) ? spec.testData.bindings : [];
    const omitted = negative.allowed && negative.strategy?.operation === 'OMIT_PATH_SEGMENT' ? negative.strategy.selector : null;
    const placeholders = [...String(target.path || '').matchAll(/\{([A-Za-z_][A-Za-z0-9_-]*)\}|(?:^|\/)\:([A-Za-z_][A-Za-z0-9_-]*)/g)].map(m => m[1] || m[2]);
    for (const key of placeholders) {
      if (key === omitted) continue;
      const binding = bindings.find(b => b?.target === 'PATH_PARAM' && b.selector === key);
      const configured = binding && (binding.source === 'GENERATED' ? !!binding.generator?.kind : ['FIXED', 'OBSERVED', 'SECRET'].includes(binding.source) && !!binding.bindingKey);
      if (!configured && !(own(spec.request?.pathParams, key) && materializedLiteral(spec.request.pathParams[key]))) add('PATH_PARAM_UNRESOLVED');
    }
    for (const binding of bindings) {
      if (!binding || !['BODY', 'QUERY', 'PATH_PARAM'].includes(binding.target)) { add('REQUEST_MODEL_INVALID'); continue; }
      if (binding.source === 'SECRET' && !binding.bindingKey) add('SECRET_REQUIRED');
      else if (['FIXED', 'OBSERVED'].includes(binding.source) && !binding.bindingKey) add('SHARED_BINDING_MISSING');
      else if (binding.source === 'GENERATED' && !binding.generator?.kind) add('REQUEST_MODEL_INVALID');
      else if (!['GENERATED', 'FIXED', 'OBSERVED', 'SECRET'].includes(binding.source)) add('REQUEST_MODEL_INVALID');
    }
  }
  if (inlineSecret(spec.request)) add('SECRET_REQUIRED');
  if (!Array.isArray(spec.assertions) || !spec.assertions.length) { add('REQUEST_MODEL_INVALID'); add('ASSERTION_STATUS_REQUIRED'); }
  else {
    if (!spec.assertions.some(a => a?.type === 'STATUS')) add('ASSERTION_STATUS_REQUIRED');
    for (const gap of assertionCoverageGaps(scenario)) add(gap.kind === 'PAGINATION_BOUND' ? 'ASSERTION_PAGINATION_BOUND_REQUIRED' : 'ASSERTION_TYPE_REQUIRED');
  }
  return normalizeReadinessIssues(issues);
}
export function legacyExpectation(scenario, issues = []) {
  if (scenario?.learning?.phase === 'PENDING_VERIFICATION' || scenario?.requestManagement?.phase === 'PENDING_VERIFICATION'
    || scenario?.scenarioLifecycle?.kind === 'SCENARIO_CLONE') return { status: 'HYPOTHESIS', basis: 'DERIVATION_PENDING_VERIFICATION' };
  if (scenario?.grounding?.level === 'ASSUMED') return { status: 'HYPOTHESIS', basis: 'LEGACY_ASSUMED' };
  if (issues.some(i => i.kind === 'EXPECTATION_KNOWLEDGE')) return { status: 'HYPOTHESIS', basis: 'LEGACY_UNVERIFIED' };
  if (scenario?.generationClass === 'OBSERVED_BASELINE' && scenario?.baseline?.source?.evidenceId) return { status: 'EVIDENCED', basis: 'OBSERVED_BASELINE' };
  if (['OBSERVED', 'INFERRED'].includes(scenario?.grounding?.level) && scenario.grounding.evidenceRefs?.length) return { status: 'EVIDENCED', basis: 'LEGACY_OBSERVED_EVIDENCE' };
  return { status: 'UNKNOWN', basis: 'UNDETERMINED' };
}
/** Registry verifies structural coherence, NOT Gateway semantic/evidence classification. */
export function validateReadinessAgainstScenario(scenario, options = {}) {
  if (!validateScenarioReadinessAttachment(scenario, options)) return false;
  if (scenario.readinessV2.basis !== 'NATIVE_V2') return true;
  const codes = new Set(scenario.readinessV2.issues.map(i => i.code));
  for (const issue of collectScenarioReadinessIssues(scenario)) {
    if (!codes.has(issue.code)) throw new ScenarioReadinessError(`${options.path || 'scenario'}.readinessV2.issues`);
  }
  if (scenario.readinessV2.expectation.status === 'EVIDENCED' && !scenario?.baseline?.source?.evidenceId
    && !scenario?.grounding?.evidenceRefs?.length) throw new ScenarioReadinessError(`${options.path || 'scenario'}.readinessV2.expectation`);
  return true;
}

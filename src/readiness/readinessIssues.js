/** 08.1.7-A. Closed, value-free issues. Labels are presentation, never authority.
 * Mirrored in Gateway/Registry intentionally; parity is checked by the delivery tests.
 */
export const READINESS_ISSUE_VERSION = 'qagent.readiness-issue.v1';
export const READINESS_ISSUE_KINDS = Object.freeze([
  'OPERATIONAL_BLOCKER', 'DATA_DEPENDENCY', 'EXPECTATION_KNOWLEDGE',
  'ASSERTION_COVERAGE', 'AUTH_STRATEGY', 'UNSUPPORTED_CAPABILITY', 'HUMAN_POLICY_REVIEW',
]);
export const READINESS_ISSUE_SOURCES = Object.freeze([
  'SEMANTIC_GUARD', 'AUTH_BRIDGE', 'TEST_DATA_PLANNER', 'SECRET_GUARD',
  'NEGATIVE_INTENT_GUARD', 'READINESS_EVALUATOR', 'LEGACY_ADAPTER', 'REGISTRY_COMPATIBILITY', 'EVIDENCE_RECONCILIATION',
]);
export const READINESS_RESOLUTIONS = Object.freeze([
  'REQUEST_DESIGNER', 'TEST_DATA_CONFIGURATION', 'AUTH_CONFIGURATION',
  'ENVIRONMENT_CONFIGURATION', 'SECRET_CONFIGURATION', 'POLICY_REVIEW',
  'LEARNING', 'HUMAN_REVIEW',
]);
export class ScenarioReadinessError extends Error {
  constructor(path = 'readinessV2', code = 'SCENARIO_READINESS_V2_INVALID') {
    super('Invalid or inconsistent structured readiness contract.');
    this.name = 'ScenarioReadinessError'; this.code = code; this.path = path; this.status = 400;
  }
}
const definitions = {};
function define(codes, kind, blocksExecution, humanRequired, resolution) {
  for (const code of codes.split(' ')) definitions[code] = Object.freeze({
    kind, severity: blocksExecution || humanRequired ? 'ERROR' : 'WARNING',
    blocksExecution, blocksRegression: true, humanRequired, resolution,
  });
}
define('RUNTIME_TARGET_MISSING ENVIRONMENT_UNAVAILABLE', 'OPERATIONAL_BLOCKER', true, false, 'ENVIRONMENT_CONFIGURATION');
define('REQUEST_MODEL_INVALID NEGATIVE_CONDITION_NOT_MODELED', 'OPERATIONAL_BLOCKER', true, false, 'REQUEST_DESIGNER');
define('MUTATION_POLICY_BLOCKED NETWORK_POLICY_BLOCKED', 'OPERATIONAL_BLOCKER', true, true, 'POLICY_REVIEW');
define('OPERATIONAL_BLOCKER LEGACY_REASON_UNCLASSIFIED LEGACY_READINESS_UNKNOWN READINESS_SOURCE_INCOMPLETE', 'OPERATIONAL_BLOCKER', true, true, 'HUMAN_REVIEW');
define('PATH_PARAM_UNRESOLVED BODY_VALUE_REQUIRED QUERY_VALUE_REQUIRED', 'DATA_DEPENDENCY', true, false, 'REQUEST_DESIGNER');
define('SHARED_BINDING_MISSING OBSERVED_VALUE_UNAVAILABLE OBSERVED_RUNTIME_VALUE_PENDING', 'DATA_DEPENDENCY', true, false, 'TEST_DATA_CONFIGURATION');
define('SECRET_REQUIRED', 'DATA_DEPENDENCY', true, false, 'SECRET_CONFIGURATION');
define('EXPECTATION_STATUS_NOT_OBSERVED EXPECTATION_CONTENT_TYPE_NOT_OBSERVED EXPECTATION_LITERAL_UNVERIFIED EXPECTATION_HYPOTHESIS_UNVERIFIED EXPECTATION_RESPONSE_KNOWLEDGE_REQUIRED EXPECTATION_UNKNOWN EXPECTATION_REVALIDATION_REQUIRED', 'EXPECTATION_KNOWLEDGE', false, false, 'LEARNING');
define('ASSERTION_TYPE_REQUIRED ASSERTION_PATH_REQUIRED ASSERTION_PAGINATION_BOUND_REQUIRED ASSERTION_STATUS_REQUIRED ASSERTION_CONTENT_TYPE_REQUIRED ASSERTION_SCHEMA_INCOMPLETE', 'ASSERTION_COVERAGE', false, false, 'LEARNING');
define('AUTH_PROFILE_REQUIRED', 'AUTH_STRATEGY', true, false, 'AUTH_CONFIGURATION');
define('AUTH_STRATEGY_NOT_MODELED AUTH_OBSERVATION_MIXED INVALID_AUTH_STRATEGY_REQUIRED AUTH_INTENT_CONFLICT', 'AUTH_STRATEGY', true, true, 'HUMAN_REVIEW');
define('UNSUPPORTED_FAULT_INJECTION UNSUPPORTED_METHOD_MUTATION UNSUPPORTED_PATH_MUTATION UNSUPPORTED_ASSERTION_SELECTOR', 'UNSUPPORTED_CAPABILITY', true, true, 'HUMAN_REVIEW');
define('UNSUPPORTED_LATENCY_ASSERTION UNSUPPORTED_BUSINESS_RELATION_ASSERTION', 'UNSUPPORTED_CAPABILITY', false, true, 'HUMAN_REVIEW');
define('HUMAN_BUSINESS_RULE_REQUIRED HUMAN_BASELINE_POLICY_REVIEW HUMAN_CONFLICT_RESOLUTION_REQUIRED HUMAN_HIGH_RISK_REQUEST_CHANGE SENSITIVE_INTENT_REQUIRES_REVIEW', 'HUMAN_POLICY_REVIEW', true, true, 'HUMAN_REVIEW');
define('OBSERVED_BASELINE_REQUEST_INCOMPLETE OBSERVED_BASELINE_SOURCE_EXPIRED OBSERVED_BASELINE_SOURCE_UNAVAILABLE', 'DATA_DEPENDENCY', true, false, 'TEST_DATA_CONFIGURATION');
define('OBSERVED_BASELINE_RESPONSE_INCOMPLETE OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE', 'DATA_DEPENDENCY', true, false, 'LEARNING');
define('OBSERVED_BASELINE_PROVENANCE_INVALID', 'OPERATIONAL_BLOCKER', true, true, 'HUMAN_REVIEW');
// C: approval and version-bound verification remain distinct from static coverage.
define('EXPECTATION_APPROVAL_REQUIRED', 'EXPECTATION_KNOWLEDGE', false, false, 'LEARNING');
define('ASSERTION_COVERAGE_VERIFICATION_REQUIRED', 'ASSERTION_COVERAGE', false, false, 'LEARNING');
define('EXPECTATION_CONTRADICTION_REQUIRES_REVIEW', 'EXPECTATION_KNOWLEDGE', false, true, 'HUMAN_REVIEW');
export const READINESS_ISSUE_DEFINITIONS = Object.freeze(definitions);
export const READINESS_ISSUE_CODES = Object.freeze(Object.keys(definitions));
export const isPlainReadinessObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function assertReadinessKeys(value, keys, path) {
  if (!isPlainReadinessObject(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some(k => !keys.includes(k))) throw new ScenarioReadinessError(path);
}
export function buildReadinessIssue(code, source = 'READINESS_EVALUATOR') {
  if (!Object.hasOwn(definitions, code) || !READINESS_ISSUE_SOURCES.includes(source)) throw new ScenarioReadinessError('issue');
  return { contractVersion: READINESS_ISSUE_VERSION, code, source, ...definitions[code] };
}
export function validateReadinessIssue(issue, path = 'issue') {
  assertReadinessKeys(issue, ['contractVersion', 'code', 'source', 'kind', 'severity',
    'blocksExecution', 'blocksRegression', 'humanRequired', 'resolution'], path);
  if (issue.contractVersion !== READINESS_ISSUE_VERSION || !Object.hasOwn(definitions, issue.code)
    || !READINESS_ISSUE_SOURCES.includes(issue.source)) throw new ScenarioReadinessError(path);
  for (const [key, value] of Object.entries(definitions[issue.code])) {
    if (issue[key] !== value) throw new ScenarioReadinessError(`${path}.${key}`);
  }
  return issue;
}
export function normalizeReadinessIssues(issues = []) {
  if (!Array.isArray(issues) || issues.length > 2048) throw new ScenarioReadinessError('issues');
  const unique = new Map();
  for (const issue of issues) { validateReadinessIssue(issue); unique.set(`${issue.code}:${issue.source}`, { ...issue }); }
  const result = [...unique.values()].sort((a, b) => `${a.code}:${a.source}`.localeCompare(`${b.code}:${b.source}`, 'en'));
  if (result.length > 128) throw new ScenarioReadinessError('issues'); // fail closed, never truncate authority
  return result;
}

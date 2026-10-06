/** 08.1.7-C-FIX-1. Pure policy/identity; never accepts a browser readiness claim.
 * An ordinal belongs to one proposal + applied version. Run persistence owns
 * concurrency via its existing tenant/project/idempotency UNIQUE constraint.
 */
export const VERIFICATION_ATTEMPT_CONTRACT = 'qagent.evolution-verification-attempt.v1';
export const MAX_VERIFICATION_ATTEMPTS = 3; // original + two explicit retries
export const VERIFICATION_RETRY_COOLDOWN_MS = 30_000;
export const EVOLUTION_RERUN_PREFIX = 'test-evolution-rerun:';
export const SAFE_VERIFICATION_METHODS = Object.freeze(['GET', 'HEAD', 'OPTIONS']);
const ID = /^[A-Za-z0-9_-]{1,160}$/;

export function verificationRetryError(code, status = 409, publicDetails = null) {
  const error = new Error('Verificação não pode ser repetida com esta entrada ou evidência.');
  Object.assign(error, { code, status });
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

export function isEvolutionVerificationNamespace(key) {
  return typeof key === 'string' && key.startsWith(EVOLUTION_RERUN_PREFIX);
}

export function evolutionVerificationKey(proposalId, versionId, attemptNumber = 1) {
  if (!ID.test(proposalId || '') || !String(proposalId).startsWith('tep_')
    || !ID.test(versionId || '') || !String(versionId).startsWith('tdv_')
    || !Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > MAX_VERIFICATION_ATTEMPTS) {
    verificationRetryError('LEARNING_VERIFICATION_LINK_INVALID', 400);
  }
  const root = `${EVOLUTION_RERUN_PREFIX}${proposalId}:${versionId}`;
  return attemptNumber === 1 ? root : `${root}:attempt:${attemptNumber}`;
}

/** Strictly canonical; trailing data/leading zeros/unknown ordinals are not links. */
export function parseEvolutionVerificationKey(key) {
  if (!isEvolutionVerificationNamespace(key)) return null;
  const p = key.split(':');
  if (p.length !== 3 && p.length !== 5) return null;
  const attemptNumber = p.length === 3 ? 1 : Number(p[4]);
  if (p.length === 5 && (p[3] !== 'attempt' || !['2', '3'].includes(p[4]))) return null;
  try {
    return evolutionVerificationKey(p[1], p[2], attemptNumber) === key
      ? { proposalId: p[1], testDesignVersionId: p[2], attemptNumber } : null;
  } catch { return null; }
}

/** Only used at the public Run boundary; internal creators retain their namespace. */
export function assertPublicRunIdempotencyKey(key) {
  if (isEvolutionVerificationNamespace(key)) verificationRetryError('RUN_IDEMPOTENCY_NAMESPACE_RESERVED', 400);
  return key;
}

export function normalizeVerificationRetryInput(input) {
  if (!Object.hasOwn(input, 'retryOfRunId')) return null;
  if (typeof input.retryOfRunId !== 'string' || !ID.test(input.retryOfRunId)
    || !input.retryOfRunId.startsWith('run_') || input.proposalIds?.length !== 1) {
    verificationRetryError('LEARNING_VERIFICATION_RETRY_INPUT_INVALID', 400);
  }
  return input.retryOfRunId;
}

const finiteTime = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const count = (x, n) => typeof x === 'number' && Number.isInteger(x) && x === n;

/** ERROR alone is never sufficient. Authentication, functional failures, generic
 * network errors and incomplete Runner/Results processing are NOT retryable here.
 * Attempt.status may legitimately be RECEIVED; terminalAt + Run lifecycle matter.
 */
export function assertTerminalHttpTimeout(bundle, { nowMs = Date.now(), cooldown = true } = {}) {
  const r = bundle?.run, a = bundle?.latestAttempt;
  if (!r) verificationRetryError('LEARNING_VERIFICATION_RETRY_STATE_UNAVAILABLE');
  if (['CREATED', 'QUEUED', 'RUNNING'].includes(r.status)) {
    verificationRetryError('LEARNING_VERIFICATION_RETRY_RUN_NOT_TERMINAL');
  }
  if (!a) verificationRetryError('LEARNING_VERIFICATION_RETRY_STATE_UNAVAILABLE');
  if (!a.terminalAt) {
    verificationRetryError('LEARNING_VERIFICATION_RETRY_RUN_NOT_TERMINAL');
  }
  const n = a.assertionCount;
  if (r.status !== 'ERROR' || a.runId !== r.runId || a.organizationId !== r.organizationId || a.projectId !== r.projectId
    || r.scenarioCount !== 1 || r.scenarioIds?.length !== 1
    || a.runtimeReadinessStatus !== 'READY' || a.httpExecutionStatus !== 'COMPLETED'
    || !count(a.httpRequestCount, 1) || !count(a.httpResponseCount, 0)
    || !count(a.httpTimeoutCount, 1) || !count(a.httpNetworkErrorCount, 0) || !count(a.httpRedirectCount, 0)
    || a.httpPrimaryDiagnosticKind !== 'TIMEOUT' || a.httpPrimaryErrorCode !== 'RUNNER_HTTP_TIMEOUT'
    || a.httpPrimaryScenarioId !== r.scenarioIds[0] || a.httpPrimaryStatusCode != null
    || a.assertionExecutionStatus !== 'COMPLETED' || a.assertionOutcome !== 'ERROR'
    || !Number.isInteger(n) || n < 1 || !count(a.assertionNotEvaluatedCount, n)
    || !count(a.assertionPassedCount, 0) || !count(a.assertionFailedCount, 0)
    || !count(a.assertionScenarioCount, 1) || !count(a.assertionScenarioNotEvaluatedCount, 1)
    || !count(a.assertionScenarioPassedCount, 0) || !count(a.assertionScenarioFailedCount, 0)
    || a.assertionPrimaryErrorCode !== 'ASSERTION_HTTP_RESPONSE_UNAVAILABLE'
    || !finiteTime(r.createdAt) || !finiteTime(a.terminalAt)
    || Date.parse(a.terminalAt) < Date.parse(r.createdAt) || !Number.isFinite(nowMs) || Date.parse(a.terminalAt) > nowMs) {
    verificationRetryError('LEARNING_VERIFICATION_RETRY_NOT_ELIGIBLE');
  }
  const remaining = VERIFICATION_RETRY_COOLDOWN_MS - (nowMs - Date.parse(a.terminalAt));
  if (cooldown && remaining > 0) verificationRetryError('LEARNING_VERIFICATION_RETRY_COOLDOWN', 409, { retryAfterSeconds: Math.ceil(remaining / 1000) });
  return 'RUNNER_HTTP_TIMEOUT';
}

/** Corroborate the terminal control-plane summary with the immutable Results row.
 * Only references/codes escape this function, never request/response/secret values.
 */
export function assertHttpTimeoutResult(data, bundle) {
  const r = bundle.run, rs = data?.resultSet;
  const s = data?.scenarios?.length === 1 ? data.scenarios[0] : null;
  const expected = bundle.executionPlan?.plan?.scenarios?.[0]?.spec?.assertions;
  const assertions = s?.assertions;
  if (!rs || !s || rs.runId !== r.runId || rs.organizationId !== r.organizationId || rs.projectId !== r.projectId
    || rs.endpointId !== r.endpointId || rs.testDesignId !== r.testDesignId || rs.testDesignVersionId !== r.testDesignVersionId
    || Number(rs.testDesignVersion) !== r.testDesignVersion || rs.environmentId !== r.environmentId || rs.outcome !== 'ERROR'
    || !finiteTime(rs.completedAt) || Date.parse(rs.completedAt) < Date.parse(r.createdAt)
    || !ID.test(rs.resultSetId || '') || !rs.resultSetId.startsWith('rset_')
    || s.scenarioId !== r.scenarioIds[0] || s.outcome !== 'NOT_EVALUATED'
    || s.http?.outcome !== 'TIMEOUT' || s.http?.statusCode != null
    || !SAFE_VERIFICATION_METHODS.includes(s.http?.method)
    || s.http.method !== bundle.executionPlan?.plan?.scenarios?.[0]?.spec?.target?.method
    || !Array.isArray(expected) || !expected.length || bundle.latestAttempt.assertionCount !== expected.length || !Array.isArray(assertions) || assertions.length !== expected.length
    || new Set(assertions.map(a => a.assertionIndex)).size !== expected.length
    || assertions.some(a => !Number.isInteger(a.assertionIndex) || a.assertionIndex < 0
      || expected[a.assertionIndex]?.type !== a.type || a.outcome !== 'NOT_EVALUATED'
      || a.errorCode !== 'ASSERTION_HTTP_RESPONSE_UNAVAILABLE')
    || s.assertionFailedCount !== 0 || s.assertionPassedCount !== 0 || s.assertionNotEvaluatedCount !== expected.length) {
    verificationRetryError('LEARNING_VERIFICATION_RETRY_EVIDENCE_INVALID');
  }
  return { resultSetId: rs.resultSetId, runId: rs.runId };
}

export function verificationAttemptMetadata(link, { retryOfRunId = null, idempotentReplay = false } = {}) {
  return {
    contractVersion: VERIFICATION_ATTEMPT_CONTRACT,
    attemptNumber: link.attemptNumber,
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
    retryOfRunId,
    retryReason: link.attemptNumber > 1 ? 'RUNNER_HTTP_TIMEOUT' : null,
    idempotentReplay: idempotentReplay === true,
  };
}

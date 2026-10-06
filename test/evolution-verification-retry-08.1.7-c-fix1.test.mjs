import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { retryFixture } from './helpers/verificationRetryD1.mjs';
import { evolutionVerificationKey, parseEvolutionVerificationKey, assertPublicRunIdempotencyKey,
  normalizeVerificationRetryInput, assertTerminalHttpTimeout, assertHttpTimeoutResult, verificationAttemptMetadata } from '../src/lib/evolutionVerificationRetry.js';

globalThis.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
let f, bundle, data;
before(async () => { f = await retryFixture(); bundle = await f.bundle(f.initialRunId); data = f.results.get(f.initialRunId); });
after(() => f?.close());
test('initial key stays compatible; new ordinals are canonical', () => {
  for (const n of [1, 2, 3]) {
    const key = evolutionVerificationKey('tep_retry', 'tdv_applied', n), parsed = parseEvolutionVerificationKey(key);
    assert.deepEqual(parsed, { proposalId: 'tep_retry', testDesignVersionId: 'tdv_applied', attemptNumber: n });
    if (n === 1) assert.equal(key, 'test-evolution-rerun:tep_retry:tdv_applied');
  }
});
for (const suffix of [':attempt:1', ':attempt:0', ':attempt:4', ':attempt:02', ':attempt:2:x', ':retry:2', ':attempt:-2', ':', ' ']) {
  test('reject malformed link ' + suffix, () => assert.equal(parseEvolutionVerificationKey('test-evolution-rerun:tep_retry:tdv_applied' + suffix), null));
}
test('public Run namespace cannot forge initial or retry association', () => {
  for (const key of [evolutionVerificationKey('tep_retry', 'tdv_applied'), evolutionVerificationKey('tep_retry', 'tdv_applied', 2), 'test-evolution-rerun:bad'])
    assert.throws(() => assertPublicRunIdempotencyKey(key), { code: 'RUN_IDEMPOTENCY_NAMESPACE_RESERVED' });
  assert.equal(assertPublicRunIdempotencyKey('manual-v17-timeout-check-01'), 'manual-v17-timeout-check-01');
});
test('one predecessor, one proposal, no implicit retry on omitted field', () => {
  assert.equal(normalizeVerificationRetryInput({ proposalIds: ['tep_retry'] }), null);
  assert.equal(normalizeVerificationRetryInput({ proposalIds: ['tep_retry'], retryOfRunId: 'run_initial' }), 'run_initial');
  for (const x of [null, '', ' run_initial', 'run_initial ', 'tdv_bad', {}, true])
    assert.throws(() => normalizeVerificationRetryInput({ proposalIds: ['tep_retry'], retryOfRunId: x }), { code: 'LEARNING_VERIFICATION_RETRY_INPUT_INVALID' });
  assert.throws(() => normalizeVerificationRetryInput({ proposalIds: ['tep_a', 'tep_b'], retryOfRunId: 'run_initial' }), { code: 'LEARNING_VERIFICATION_RETRY_INPUT_INVALID' });
});
test('observed ERROR/RECEIVED transport timeout is eligible, not a failed assertion', () => {
  assert.equal(bundle.latestAttempt.status, 'RECEIVED');
  assert.equal(assertTerminalHttpTimeout(bundle), 'RUNNER_HTTP_TIMEOUT');
  assert.equal(assertHttpTimeoutResult(data, bundle).runId, bundle.run.runId);
});
const bad = {
  'functional failure': b => { b.run.status = 'FAILED'; },
  'passed result': b => { b.run.status = 'PASSED'; },
  'cancelled': b => { b.run.status = 'CANCELLED'; },
  'network error not allowlisted': b => { b.latestAttempt.httpNetworkErrorCount = 1; b.latestAttempt.httpPrimaryErrorCode = 'RUNNER_HTTP_NETWORK_ERROR'; },
  'error without timeout': b => { b.latestAttempt.httpTimeoutCount = 0; },
  'HTTP response exists': b => { b.latestAttempt.httpResponseCount = 1; },
  'received 401': b => { b.latestAttempt.httpPrimaryStatusCode = 401; },
  'auth setup failed': b => { b.latestAttempt.runtimeReadinessStatus = 'BLOCKED'; },
  'assertion failed': b => { b.latestAttempt.assertionFailedCount = 1; },
  'some assertion passed': b => { b.latestAttempt.assertionPassedCount = 1; },
  'assertion not completed': b => { b.latestAttempt.assertionExecutionStatus = 'PENDING'; },
  'unknown assertion error': b => { b.latestAttempt.assertionPrimaryErrorCode = 'SOMETHING_ELSE'; },
  'different attempt run': b => { b.latestAttempt.runId = 'run_other'; },
  'different attempt tenant': b => { b.latestAttempt.organizationId = 'org_other'; },
  'multiple scenarios': b => { b.run.scenarioCount = 2; b.run.scenarioIds.push('other'); },
  'null not-evaluated count': b => { b.latestAttempt.assertionNotEvaluatedCount = null; },
  'string counter': b => { b.latestAttempt.httpResponseCount = '0'; },
  'redirect path': b => { b.latestAttempt.httpRedirectCount = 1; },
  'invalid terminal date': b => { b.latestAttempt.terminalAt = 'garbled'; },
  'future terminal date': b => { b.latestAttempt.terminalAt = new Date(Date.now() + 60000).toISOString(); },
};
for (const [name, mutate] of Object.entries(bad)) test('deny ' + name, () => {
  const b = structuredClone(bundle); mutate(b);
  assert.throws(() => assertTerminalHttpTimeout(b), { code: 'LEARNING_VERIFICATION_RETRY_NOT_ELIGIBLE' });
});
for (const status of ['CREATED', 'QUEUED', 'RUNNING']) test('deny active lifecycle ' + status, () => {
  const b = structuredClone(bundle); b.run.status = status;
  assert.throws(() => assertTerminalHttpTimeout(b), { code: 'LEARNING_VERIFICATION_RETRY_RUN_NOT_TERMINAL' });
});
test('cooldown is bounded, explicit and carries only retry seconds', () => {
  const b = structuredClone(bundle); b.latestAttempt.terminalAt = new Date(Date.now() - 1000).toISOString();
  assert.throws(() => assertTerminalHttpTimeout(b), e => e.code === 'LEARNING_VERIFICATION_RETRY_COOLDOWN' && e.publicDetails.retryAfterSeconds <= 29);
});
for (const [name, mutate] of Object.entries({
  'other Run': d => { d.resultSet.runId = 'run_manual'; },
  'other tenant': d => { d.resultSet.organizationId = 'org_other'; },
  'other environment': d => { d.resultSet.environmentId = 'env_other'; },
  'source version reused': d => { d.resultSet.testDesignVersionId = 'tdv_retry_16'; },
  'other version number': d => { d.resultSet.testDesignVersion = 16; },
  'HTTP response mismatch': d => { d.scenarios[0].http.outcome = 'RESPONSE'; },
  'mutation': d => { d.scenarios[0].http.method = 'POST'; },
  'functional result': d => { d.scenarios[0].outcome = 'FAILED'; },
  'assertions empty': d => { d.scenarios[0].assertions = []; },
  'assertion actually passed': d => { d.scenarios[0].assertions[0].outcome = 'PASSED'; },
  'duplicate assertion index': d => { d.scenarios[0].assertions.push(d.scenarios[0].assertions[0]); },
  'assertion type changed': d => { d.scenarios[0].assertions[0].type = 'SCHEMA'; },
  'unrelated error': d => { d.scenarios[0].assertions[0].errorCode = 'SECRET_MISSING'; },
  'timestamp before creation': d => { d.resultSet.completedAt = '2020-01-01T00:00:00Z'; },
})) test('Results corroboration rejects ' + name, () => {
  const d = structuredClone(data); mutate(d);
  assert.throws(() => assertHttpTimeoutResult(d, bundle), { code: 'LEARNING_VERIFICATION_RETRY_EVIDENCE_INVALID' });
});
test('attempt response uses closed metadata, no values or payload', () => {
  const m = verificationAttemptMetadata({ attemptNumber: 2 }, { retryOfRunId: 'run_a', idempotentReplay: true });
  assert.deepEqual(m, { contractVersion: 'qagent.evolution-verification-attempt.v1', attemptNumber: 2, maxAttempts: 3, retryOfRunId: 'run_a', retryReason: 'RUNNER_HTTP_TIMEOUT', idempotentReplay: true });
});

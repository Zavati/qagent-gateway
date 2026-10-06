import test from 'node:test';
import assert from 'node:assert/strict';
import { retryFixture } from './helpers/verificationRetryD1.mjs';
import { postConsoleLearningResolutionVerify } from '../src/handlers/consoleLearningResolution.js';
import { postConsoleEvolutionVerifyOutcome } from '../src/handlers/consoleTestEvolution.js';
import { postConsoleRun } from '../src/handlers/consoleRuns.js';
import { handleTestEvolutionQueue } from '../src/handlers/testEvolutionQueue.js';
import { retryEvolutionVerification } from '../src/services/evolutionVerificationRetryService.js';
import { evolutionVerificationKey } from '../src/lib/evolutionVerificationRetry.js';
globalThis.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const req = body => new Request('https://console.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const use = (name, fn) => test(name, async t => { const f = await retryFixture(); t.after(() => f.close()); await fn(f, t); });
const auth = f => ({ requireTenant: async () => ({ organizationId: f.scope.organizationId, organizationRole: 'owner', user: { userId: 'usr_retry' } }), getProject: async () => ({}) });
const handlerDeps = f => ({ ...auth(f), getProposal: async () => f.proposal,
  getResult: async () => f.results.get(f.proposal.source.runId), createRerun: f.deps.createRerun, retryDeps: f.deps });
const body = f => ({ proposalIds: [f.proposal.proposalId], confirmExecution: true, retryOfRunId: f.initialRunId });
use('API creates attempt 2 and reports REUSED on identical resubmission', async f => {
  const a = await postConsoleLearningResolutionVerify(req(body(f)), f.env, f.scope, handlerDeps(f));
  const b = await postConsoleLearningResolutionVerify(req(body(f)), f.env, f.scope, handlerDeps(f));
  assert.equal(a.data.items[0].status, 'CREATED'); assert.equal(b.data.items[0].status, 'REUSED');
  assert.equal(a.data.items[0].runId, b.data.items[0].runId); assert.equal(a.data.items[0].verificationAttempt.attemptNumber, 2);
});
use('original verify request no longer calls an idempotent replay CREATED', async f => {
  const a = await postConsoleLearningResolutionVerify(req({ proposalIds: ['tep_retry'], confirmExecution: true }), f.env, f.scope, handlerDeps(f));
  assert.equal(a.data.items[0].status, 'REUSED'); assert.equal(a.data.items[0].runStatus, 'ERROR'); assert.equal(a.data.items[0].runId, f.initialRunId);
  assert.equal(a.data.items[0].verificationAttempt.attemptNumber, 1); assert.equal(f.sent.length, 0);
});
use('retry contract checks precede proposal/Run writes', async f => {
  let reads = 0; const deps = { ...handlerDeps(f), getProposal: async () => { reads++; return f.proposal; } };
  for (const invalid of [
    { ...body(f), confirmExecution: false }, { ...body(f), environmentId: 'env_other' }, { ...body(f), attemptNumber: 2 },
    { ...body(f), idempotencyKey: 'arbitrary' }, { ...body(f), retryOfRunId: '' }, { ...body(f), proposalIds: ['tep_a', 'tep_b'] },
  ]) await assert.rejects(postConsoleLearningResolutionVerify(req(invalid), f.env, f.scope, deps));
  assert.equal(reads, 0); assert.equal(f.sent.length, 0);
});
use('viewer cannot request retry even with valid IDs', async f => {
  const deps = handlerDeps(f); deps.requireTenant = async () => ({ organizationId: f.scope.organizationId, organizationRole: 'viewer', user: { userId: 'usr_viewer' } });
  await assert.rejects(postConsoleLearningResolutionVerify(req(body(f)), f.env, f.scope, deps), { code: 'LEARNING_RESOLUTION_FORBIDDEN' });
});
use('ordinary Run route reserves internal keys, including batch requests', async f => {
  let calls = 0;
  for (const contractVersion of ['qagent.run-create.v1', 'qagent.run-batch-create.v1']) {
    const request = new Request('https://console.invalid', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': evolutionVerificationKey('tep_retry', 'tdv_retry_17', 2) },
      body: JSON.stringify({ contractVersion, testDesignVersionId: 'tdv_retry_17', environmentId: 'env_retry', scenarioIds: ['test_002'] }) });
    await assert.rejects(postConsoleRun(request, f.env, f.scope, { ...auth(f), createRun: async () => { calls++; }, createRunBatch: async () => { calls++; } }), { code: 'RUN_IDEMPOTENCY_NAMESPACE_RESERVED' });
  }
  assert.equal(calls, 0);
});
use('API sanitizes unexpected exceptions without leaking values', async f => {
  const deps = { ...handlerDeps(f), retryVerification: async () => { throw Error('Bearer PRIVATE_SECRET_VALUE'); } };
  const response = await postConsoleLearningResolutionVerify(req(body(f)), f.env, f.scope, deps);
  assert.equal(response.data.items[0].status, 'ERROR'); assert.equal(response.data.items[0].errorCode, 'LEARNING_RESOLUTION_DEPENDENCY_FAILED');
  assert.ok(!JSON.stringify(response).includes('PRIVATE_SECRET_VALUE'));
});
use('old non-success receipt is not falsely labelled VERIFIED', async f => {
  f.proposal.outcomeVerification = { outcome: 'VERIFICATION_BLOCKED', rerun: {}, source: {}, evolved: {} };
  const response = await postConsoleLearningResolutionVerify(req({ proposalIds: ['tep_retry'], confirmExecution: true }), f.env, f.scope, handlerDeps(f));
  assert.equal(response.data.items[0].status, 'VERIFICATION_RECORDED'); assert.equal(f.sent.length, 0);
});
use('manual outcome verification requires validated retry association', async f => {
  const a = await retryEvolutionVerification(f.args); await f.finish(a.run.runId, { outcome: 'PASSED' }); let called = 0;
  const result = await postConsoleEvolutionVerifyOutcome(req({ rerunRunId: a.run.runId, rerunResultSetId: 'rset_' + a.run.runId }), f.env,
    { ...f.scope, proposalId: f.proposal.proposalId }, { ...auth(f), retryDeps: f.deps, verifyOutcome: async ({ input }) => { called++; return { received: input }; } });
  assert.equal(called, 1); assert.equal(result.data.received.rerunRunId, a.run.runId);
});
use('manual check rejects lookalike root suffix without invoking Evolution', async f => {
  const fake = { runId: 'run_fake', idempotencyKey: evolutionVerificationKey('tep_retry', 'tdv_retry_17') + ':forged' };
  await assert.rejects(postConsoleEvolutionVerifyOutcome(req({ rerunRunId: fake.runId }), f.env, { ...f.scope, proposalId: 'tep_retry' },
    { ...auth(f), getRun: async () => fake, verifyOutcome: async () => { throw Error('MUST_NOT_CALL'); } }), { code: 'TEST_EVOLUTION_OUTCOME_RUN_NOT_LINKED' });
});
function message(f, runId) {
  const result = f.results.get(runId);
  return { id: 'msg_retry', body: { contractVersion: 'qagent.test-evolution-result-trigger.v1', ...f.scope, runId,
    resultSetId: result.resultSet.resultSetId, testDesignVersionId: 'tdv_retry_17', scenarioIds: ['test_002'] },
    acked: false, retried: false, ack() { this.acked = true; }, retry() { this.retried = true; } };
}
use('result queue recognizes new link and verifies it instead of starting AI/proposal analysis', async f => {
  const a = await retryEvolutionVerification(f.args); await f.finish(a.run.runId, { outcome: 'PASSED' }); const calls = [];
  f.env.TEST_EVOLUTION_SERVICE = { async fetch(request) {
    calls.push({ method: request.method, path: new URL(request.url).pathname });
    if (request.method === 'GET' && request.url.endsWith('/test-evolution-proposals/tep_retry')) return Response.json({ status: 'ok', data: f.proposal });
    if (request.url.endsWith('/verify-outcome')) {
      const input = await request.json(); assert.equal(input.rerunRunId, a.run.runId);
      return Response.json({ status: 'ok', data: { outcome: 'HYPOTHESIS_VERIFIED', recoveryConfirmed: false } });
    }
    throw Error('UNEXPECTED_EVOLUTION_OR_AI_CALL');
  } };
  const m = message(f, a.run.runId); await handleTestEvolutionQueue({ messages: [m] }, f.env);
  assert.equal(m.acked, true); assert.equal(m.retried, false); assert.equal(calls.filter(x => x.path.endsWith('/verify-outcome')).length, 1);
  assert.ok(!calls.some(x => x.path.endsWith('/assess') || x.path.endsWith('/evolution-inspection')));
});
use('invalid reserved key is acknowledged without creating a new evolution chain', async f => {
  const a = await retryEvolutionVerification(f.args); await f.finish(a.run.runId, { outcome: 'PASSED' });
  f.db.raw.prepare('UPDATE runs SET idempotency_key=? WHERE run_id=?').run(evolutionVerificationKey('tep_retry', 'tdv_retry_17') + ':attempt:999', a.run.runId);
  f.env.TEST_EVOLUTION_SERVICE = { fetch: async () => { throw Error('NO_EVOLUTION_ALLOWED'); } };
  const m = message(f, a.run.runId); await handleTestEvolutionQueue({ messages: [m] }, f.env); assert.equal(m.acked, true); assert.equal(m.retried, false);
});
use('retry verification stays disabled after C rollback, without adopting manual results', async f => {
  const a = await retryEvolutionVerification(f.args); await f.finish(a.run.runId, { outcome: 'PASSED' });
  f.env.SCENARIO_READINESS_RECONCILIATION_ENABLED = 'false';
  await assert.rejects(postConsoleEvolutionVerifyOutcome(req({ rerunRunId: a.run.runId }), f.env, { ...f.scope, proposalId: 'tep_retry' },
    { ...auth(f), retryDeps: f.deps }), { code: 'LEARNING_VERIFICATION_RETRY_DISABLED' });
});

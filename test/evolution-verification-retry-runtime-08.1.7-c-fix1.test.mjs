import test from 'node:test';
import assert from 'node:assert/strict';
import { retryFixture } from './helpers/verificationRetryD1.mjs';
import { retryEvolutionVerification, assertLinkedVerificationRetry } from '../src/services/evolutionVerificationRetryService.js';
import { evolutionVerificationKey } from '../src/lib/evolutionVerificationRetry.js';
import { fingerprintRunCreateInput, sha256Hex } from '../src/lib/runContracts.js';
import { getRunByIdempotencyKey } from '../src/repositories/runRepository.js';
globalThis.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const count = f => f.db.raw.prepare('SELECT count(*) n FROM runs').get().n;
const use = (name, fn) => test(name, async t => { const f = await retryFixture(); t.after(() => f.close()); await fn(f, t); });
use('timeout -> real Run persistence/materialization -> explicit successor without changing source', async f => {
  const before = JSON.stringify(await f.bundle(f.initialRunId)), resultBefore = JSON.stringify(f.results.get(f.initialRunId));
  const created = await retryEvolutionVerification(f.args);
  assert.equal(created.run.status, 'QUEUED'); assert.notEqual(created.run.runId, f.initialRunId);
  assert.equal(created.run.testDesignVersionId, f.proposal.result.testDesignVersionId); assert.deepEqual(created.run.scenarioIds, ['test_002']);
  assert.equal(created.run.purpose, 'LEARNING'); assert.equal(created.verificationAttempt.attemptNumber, 2);
  assert.equal(count(f), 3); assert.equal(f.sent.length, 1);
  assert.equal(JSON.stringify(await f.bundle(f.initialRunId)), before); assert.equal(JSON.stringify(f.results.get(f.initialRunId)), resultBefore);
  const b = await f.bundle(created.run.runId); assert.deepEqual(b.executionPlan.plan.scenarios[0].spec.assertions, f.scenario.spec.assertions);
  assert.equal(b.executionPlan.plan.scenarios[0].spec.auth.requirement, 'UNAUTHENTICATED');
  assert.equal(created.evolutionRuntimeReuse.sourceRunId, f.proposal.source.runId);
});
use('same retry request is one persistent attempt, not an unbounded next attempt', async f => {
  const a = await retryEvolutionVerification(f.args), b = await retryEvolutionVerification(f.args);
  assert.equal(a.run.runId, b.run.runId); assert.equal(b.idempotentReplay, true); assert.equal(count(f), 3); assert.equal(f.sent.length, 1);
});
use('concurrent requests converge on the database UNIQUE winner', async f => {
  const out = await Promise.all(Array.from({ length: 6 }, () => retryEvolutionVerification(f.args)));
  assert.equal(new Set(out.map(x => x.run.runId)).size, 1); assert.equal(count(f), 3);
  assert.equal(out.filter(x => !x.idempotentReplay).length, 1);
  assert.equal(new Set(f.sent.map(x => x.runId)).size, 1); // transport is at-least-once, never different Runs
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM execution_plans').get().n, 3);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM runtime_snapshots').get().n, 3);
});
use('in-progress successor cannot be retried; replay of predecessor returns it', async f => {
  const a = await retryEvolutionVerification(f.args);
  await assert.rejects(retryEvolutionVerification({ ...f.args, retryOfRunId: a.run.runId }), { code: 'LEARNING_VERIFICATION_RETRY_RUN_NOT_TERMINAL' });
  assert.equal((await retryEvolutionVerification(f.args)).run.runId, a.run.runId); assert.equal(count(f), 3);
});
use('send failure resumes the same persisted Run on replay, without a new version', async f => {
  f.failSends(); await assert.rejects(retryEvolutionVerification(f.args), { code: 'RUN_QUEUE_DISPATCH_FAILED' });
  assert.equal(count(f), 3);
  const stored = await getRunByIdempotencyKey(f.env, f.scope.organizationId, f.scope.projectId, evolutionVerificationKey('tep_retry', 'tdv_retry_17', 2));
  const recovered = await retryEvolutionVerification(f.args);
  assert.equal(recovered.run.runId, stored.runId); assert.equal(recovered.idempotentReplay, true); assert.equal(recovered.run.status, 'QUEUED'); assert.equal(f.sent.length, 1);
});
use('Run with a manual key cannot become a verification retry', async f => {
  const manual = await f.seed('run_manual', 'manual-v17-timeout-check-01', 'tdv_retry_17', 17, new Date(Date.now() - 120000).toISOString());
  await f.finish(manual.run.runId, { completedAt: new Date(Date.now() - 60000).toISOString() });
  await assert.rejects(retryEvolutionVerification({ ...f.args, retryOfRunId: manual.run.runId }), { code: 'LEARNING_VERIFICATION_RETRY_RUN_NOT_LINKED' });
});
use('existing receipt is never overwritten, including an old blocked receipt', async f => {
  for (const outcome of ['VERIFICATION_BLOCKED', 'HYPOTHESIS_VERIFIED', 'HYPOTHESIS_NOT_VERIFIED']) {
    f.proposal.outcomeVerification = { outcome, rerun: { runId: 'run_other' } };
    await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_RECEIPT_EXISTS' });
  }
  assert.equal(count(f), 2);
});
use('successful child replay remains the same Run after receipt, without new execution', async f => {
  const a = await retryEvolutionVerification(f.args); await f.finish(a.run.runId, { outcome: 'PASSED' });
  f.proposal.outcomeVerification = { outcome: 'HYPOTHESIS_VERIFIED', rerun: { runId: a.run.runId } };
  const again = await retryEvolutionVerification(f.args);
  assert.equal(again.run.runId, a.run.runId); assert.equal(again.run.status, 'PASSED'); assert.equal(again.idempotentReplay, true); assert.equal(f.sent.length, 1);
});
use('up to two retries, no third retry, with per-attempt idempotency', async (f, t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const a = await retryEvolutionVerification(f.args); t.mock.timers.tick(1000); await f.finish(a.run.runId);
  await assert.rejects(retryEvolutionVerification({ ...f.args, retryOfRunId: a.run.runId }), { code: 'LEARNING_VERIFICATION_RETRY_COOLDOWN' });
  t.mock.timers.tick(31000);
  const b = await retryEvolutionVerification({ ...f.args, retryOfRunId: a.run.runId }); assert.equal(b.verificationAttempt.attemptNumber, 3);
  const replay = await retryEvolutionVerification({ ...f.args, retryOfRunId: a.run.runId }); assert.equal(replay.run.runId, b.run.runId);
  t.mock.timers.tick(1000); await f.finish(b.run.runId); t.mock.timers.tick(31000);
  await assert.rejects(retryEvolutionVerification({ ...f.args, retryOfRunId: b.run.runId }), { code: 'LEARNING_VERIFICATION_RETRY_LIMIT_REACHED' });
  assert.equal(count(f), 4); assert.equal(f.sent.length, 2);
});
use('different namespace/version/scope never allocates a successor', async f => {
  const bad = structuredClone(f.proposal); bad.proposalId = 'tep_other';
  await assert.rejects(retryEvolutionVerification({ ...f.args, proposal: bad }), { code: 'LEARNING_VERIFICATION_RETRY_RUN_NOT_LINKED' });
  await assert.rejects(retryEvolutionVerification({ ...f.args, projectId: 'prj_other' }), { code: 'LEARNING_VERIFICATION_RETRY_RUN_NOT_LINKED' });
  bad.proposalId = f.proposal.proposalId; bad.result.testDesignVersionId = 'tdv_other';
  await assert.rejects(retryEvolutionVerification({ ...f.args, proposal: bad }), { code: 'LEARNING_VERIFICATION_RETRY_RUN_NOT_LINKED' });
  assert.equal(count(f), 2);
});
for (const field of ['SCENARIO_READINESS_V2_ENABLED', 'SCENARIO_READINESS_RECONCILIATION_ENABLED']) use('flag required ' + field, async f => {
  f.env[field] = 'false'; await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_DISABLED' }); assert.equal(count(f), 2);
});
use('mutation or protected baseline never retries under safe-read recovery', async f => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) { f.scenario.spec.target.method = method;
    await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_METHOD_NOT_ALLOWED' }); }
  f.scenario.spec.target.method = 'GET'; f.scenario.generationClass = 'OBSERVED_BASELINE';
  await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_BASELINE_PROTECTED' }); assert.equal(count(f), 2);
});
use('source Results environment mismatch cannot change target environment', async f => {
  f.results.get(f.proposal.source.runId).resultSet.environmentId = 'env_other';
  await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_SCOPE_MISMATCH' }); assert.equal(count(f), 2);
});
use('stored plan/hash mismatch cannot authorize recovery', async f => {
  f.db.raw.prepare("UPDATE execution_plans SET plan_hash=? WHERE run_id=?").run('0'.repeat(64), f.initialRunId);
  await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_ARTIFACT_MISMATCH' }); assert.equal(count(f), 2);
});
use('immutable Results missing/incomplete prevents creation', async f => {
  f.results.delete(f.initialRunId);
  await assert.rejects(retryEvolutionVerification(f.args), { code: 'LEARNING_VERIFICATION_RETRY_EVIDENCE_INVALID' }); assert.equal(count(f), 2);
});
use('public identifiers are not sufficient without a complete persisted chain', async f => {
  const row = await f.seed('run_orphan_retry', evolutionVerificationKey('tep_retry', 'tdv_retry_17', 3), 'tdv_retry_17', 17, new Date().toISOString());
  await assert.rejects(assertLinkedVerificationRetry({ ...f.scope, env: f.env, run: row.run, proposal: f.proposal, deps: f.deps }), { code: 'LEARNING_VERIFICATION_RETRY_CHAIN_INCOMPLETE' });
});
use('new retry can be validated for automatic/manual outcome attribution', async f => {
  const a = await retryEvolutionVerification(f.args); const r = (await f.bundle(a.run.runId)).run;
  const proof = await assertLinkedVerificationRetry({ ...f.scope, env: f.env, run: r, proposal: f.proposal, deps: f.deps });
  assert.equal(proof.link.attemptNumber, 2); assert.equal(proof.retryOfRunId, f.initialRunId);
  await assert.rejects(assertLinkedVerificationRetry({ ...f.scope, env: f.env, run: { ...r, runId: 'run_manual' }, proposal: f.proposal, deps: f.deps }), { code: 'LEARNING_VERIFICATION_RETRY_LINK_MISMATCH' });
});

use('pre-C REGRESSION timeout root converts to pending LEARNING, with verifiable replay chain', async f => {
  const b = await f.bundle(f.initialRunId), plan = structuredClone(b.executionPlan.plan);
  delete plan.purpose; delete plan.planHash; plan.planHash = await sha256Hex(plan);
  f.db.raw.prepare('UPDATE execution_plans SET plan_json=?,plan_hash=? WHERE run_id=?').run(JSON.stringify(plan), plan.planHash, f.initialRunId);
  const input = {contractVersion:'qagent.run-create.v1',testDesignVersionId:b.run.testDesignVersionId,environmentId:b.run.environmentId,scenarioIds:b.run.scenarioIds,confirmDiscoveredRuntime:false};
  f.db.raw.prepare('UPDATE runs SET request_fingerprint=? WHERE run_id=?').run(await fingerprintRunCreateInput(input),f.initialRunId);
  const next=await retryEvolutionVerification(f.args); assert.equal(next.run.purpose,'LEARNING');
  const link=await assertLinkedVerificationRetry({...f.scope,env:f.env,run:(await f.bundle(next.run.runId)).run,proposal:f.proposal,deps:f.deps});
  assert.equal(link.retryOfRunId,f.initialRunId);
  assert.equal((await retryEvolutionVerification(f.args)).run.runId,next.run.runId);
});

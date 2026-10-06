/** 08.1.7-C-FIX-1. Explicit recovery of a bounded verification, Gateway-owned.
 * No new table: immutable Run artifacts + one canonical idempotency key per
 * ordinal form a bounded chain. The unique Run insert is the concurrency winner.
 * Results, proposal, approved version and old Run are never rewritten here.
 */
import { getRunBundle, getRunByIdempotencyKey } from '../repositories/runRepository.js';
import { createRunV1, getRunV1 } from './runService.js';
import { createEvolutionRerunV1 } from './evolutionRerunService.js';
import { getEvolutionProposal } from './testEvolutionClient.js';
import { getResultsProjectResultSet, getResultsLatestRunResultSet } from './resultsReadClient.js';
import { getRunnerTestArtifact } from './testRegistryClient.js';
import { fingerprintRunCreateInput, canonicalizeJson, sha256Hex } from '../lib/runContracts.js';
import { readinessReconciliationEnabled } from '../readiness/readinessReconciliation.js';
import {
  MAX_VERIFICATION_ATTEMPTS, SAFE_VERIFICATION_METHODS,
  evolutionVerificationKey, parseEvolutionVerificationKey,
  assertTerminalHttpTimeout, assertHttpTimeoutResult,
  verificationRetryError as fail, verificationAttemptMetadata,
} from '../lib/evolutionVerificationRetry.js';

const successfulVerification = v => ['HYPOTHESIS_VERIFIED', 'COVERAGE_VERIFIED', 'REQUEST_REPAIR_VERIFIED', 'RECOVERED_BY_EVOLUTION'].includes(v?.outcome);
export { successfulVerification };
const validTime = t => typeof t === 'string' && Number.isFinite(Date.parse(t));

function retryEnabled(env) {
  if (!readinessReconciliationEnabled(env)) fail('LEARNING_VERIFICATION_RETRY_DISABLED');
}
function appliedProposal(p) {
  if (p?.status !== 'APPLIED' || !p.result?.testDesignVersionId || !Number.isInteger(p.result?.testDesignVersion)
    || !p.source?.runId || !p.source?.scenarioId || !validTime(p.appliedAt)) fail('LEARNING_PROPOSAL_NOT_APPLIED');
  evolutionVerificationKey(p.proposalId, p.result.testDesignVersionId);
}
function runInput(bundle) {
  return {
    contractVersion: 'qagent.run-create.v1',
    testDesignVersionId: bundle.run.testDesignVersionId,
    environmentId: bundle.run.environmentId,
    scenarioIds: bundle.run.scenarioIds.slice(),
    ...(bundle.executionPlan.plan.purpose === 'LEARNING' ? { purpose: 'LEARNING' } : {}),
    confirmDiscoveredRuntime: false,
  };
}
// Mirror the existing C rerun rule: a pre-C REGRESSION root may need a
// LEARNING successor while its derived version is pending verification.
function childPurpose(parent, scenario) {
  if (parent.executionPlan.plan.purpose === 'LEARNING') return 'LEARNING';
  return scenario.readinessV2?.expectation?.basis === 'DERIVATION_PENDING_VERIFICATION'
    || scenario.learning?.phase === 'PENDING_VERIFICATION'
    || scenario.requestManagement?.phase === 'PENDING_VERIFICATION' ? 'LEARNING' : 'REGRESSION';
}
async function contextFor(common, proposal, deps) {
  appliedProposal(proposal);
  const [sourceData, sourceBundle, artifact] = await Promise.all([
    (deps.getSourceResult || getResultsProjectResultSet)({ ...common, resultSetId: proposal.source.resultSetId }),
    (deps.getRunBundle || getRunBundle)(common.env, common.organizationId, common.projectId, proposal.source.runId),
    (deps.getArtifact || getRunnerTestArtifact)({ ...common, testDesignVersionId: proposal.result.testDesignVersionId }),
  ]);
  const rs = sourceData?.resultSet, source = sourceBundle?.run;
  const result = sourceData?.scenarios?.find(s => s.scenarioResultId === proposal.source.scenarioResultId);
  const scenario = artifact?.specification?.scenarios?.find(s => s.scenarioId === proposal.source.scenarioId);
  if (!source || !rs || !result || !scenario || ['organizationId', 'projectId'].some(k => rs[k] !== common[k] || source[k] !== common[k] || artifact[k] !== common[k])
    || rs.resultSetId !== proposal.source.resultSetId || rs.runId !== proposal.source.runId
    || rs.testDesignId !== proposal.source.testDesignId || source.testDesignId !== proposal.source.testDesignId
    || rs.testDesignVersionId !== proposal.source.testDesignVersionId || source.testDesignVersionId !== proposal.source.testDesignVersionId
    || Number(rs.testDesignVersion) !== proposal.source.testDesignVersion || source.testDesignVersion !== proposal.source.testDesignVersion
    || rs.endpointId !== proposal.source.endpointId || source.endpointId !== proposal.source.endpointId
    || !rs.environmentId || rs.environmentId !== source.environmentId || !source.scenarioIds?.includes(proposal.source.scenarioId)
    || result.scenarioId !== proposal.source.scenarioId || result.http?.outcome !== 'RESPONSE'
    || artifact.testDesignId !== proposal.source.testDesignId || artifact.endpointId !== proposal.source.endpointId
    || artifact.testDesignVersionId !== proposal.result.testDesignVersionId || artifact.version !== proposal.result.testDesignVersion) {
    fail('LEARNING_VERIFICATION_RETRY_SCOPE_MISMATCH');
  }
  if (!SAFE_VERIFICATION_METHODS.includes(result.http.method) || !SAFE_VERIFICATION_METHODS.includes(scenario.spec?.target?.method)
    || result.http.method !== scenario.spec.target.method) fail('LEARNING_VERIFICATION_RETRY_METHOD_NOT_ALLOWED');
  if (scenario.generationClass === 'OBSERVED_BASELINE' || scenario.baseline) fail('LEARNING_VERIFICATION_RETRY_BASELINE_PROTECTED');
  return { ...common, proposal, sourceBundle, artifact, scenario, environmentId: rs.environmentId };
}

async function assertBundleScope(bundle, ctx, ordinal) {
  const r = bundle?.run, p = ctx.proposal, plan = bundle?.executionPlan?.plan, snapshot = bundle?.runtimeSnapshot?.snapshot;
  if (!r || !plan || !snapshot || ['organizationId', 'projectId'].some(k => r[k] !== ctx[k] || plan[k] !== ctx[k] || snapshot[k] !== ctx[k])
    || r.idempotencyKey !== evolutionVerificationKey(p.proposalId, p.result.testDesignVersionId, ordinal)
    || r.testDesignId !== p.source.testDesignId || r.endpointId !== p.source.endpointId
    || r.testDesignVersionId !== p.result.testDesignVersionId || r.testDesignVersion !== p.result.testDesignVersion
    || r.environmentId !== ctx.environmentId || r.scenarioCount !== 1 || r.scenarioIds?.length !== 1 || r.scenarioIds[0] !== p.source.scenarioId
    || r.runId === p.source.runId || !validTime(r.createdAt) || Date.parse(r.createdAt) < Date.parse(p.appliedAt)
    || plan.runId !== r.runId || plan.executionPlanId !== r.executionPlanId || plan.runtimeSnapshotId !== r.runtimeSnapshotId
    || plan.testDesign?.testDesignVersionId !== r.testDesignVersionId || plan.testDesign?.version !== r.testDesignVersion
    || plan.testDesign?.testDesignId !== r.testDesignId || plan.testDesign?.endpointId !== r.endpointId
    || plan.environmentId !== r.environmentId || plan.scenarios?.length !== 1 || plan.scenarios[0].scenarioId !== p.source.scenarioId
    || plan.scenarios[0].spec?.target?.method !== ctx.scenario.spec.target.method
    || plan.scenarios[0].spec?.auth?.requirement !== ctx.scenario.spec?.auth?.requirement
    || canonicalizeJson(plan.scenarios[0].spec?.assertions) !== canonicalizeJson(ctx.scenario.spec?.assertions)
    || ![undefined, 'LEARNING', 'REGRESSION'].includes(plan.purpose)
    || snapshot.runId !== r.runId || snapshot.runtimeSnapshotId !== r.runtimeSnapshotId || snapshot.environment?.environmentId !== r.environmentId
    || bundle.executionPlan.executionPlanId !== r.executionPlanId || bundle.runtimeSnapshot.runtimeSnapshotId !== r.runtimeSnapshotId
    || (ordinal > 1 && (typeof r.createdByUserId !== 'string' || !r.createdByUserId.startsWith('usr_')))) {
    fail('LEARNING_VERIFICATION_RETRY_LINK_MISMATCH');
  }
  const { planHash, ...planBody } = plan, { snapshotHash, ...snapshotBody } = snapshot;
  if (planHash !== bundle.executionPlan.planHash || snapshotHash !== bundle.runtimeSnapshot.snapshotHash
    || planHash !== await sha256Hex(planBody) || snapshotHash !== await sha256Hex(snapshotBody)
    || r.requestFingerprint !== await fingerprintRunCreateInput(runInput(bundle))) {
    fail('LEARNING_VERIFICATION_RETRY_ARTIFACT_MISMATCH');
  }
}

/** Exactly one row per ordinal. Ancestors must be terminal timeouts; a manual Run
 * cannot be adopted just because its version/scenario happened to match.
 */
async function loadChain(ctx, through, deps) {
  const chain = [], load = deps.getRunBundle || getRunBundle, find = deps.findRun || getRunByIdempotencyKey;
  for (let ordinal = 1; ordinal <= through; ordinal++) {
    const row = await find(ctx.env, ctx.organizationId, ctx.projectId,
      evolutionVerificationKey(ctx.proposal.proposalId, ctx.proposal.result.testDesignVersionId, ordinal));
    if (!row) fail('LEARNING_VERIFICATION_RETRY_CHAIN_INCOMPLETE');
    const bundle = await load(ctx.env, ctx.organizationId, ctx.projectId, row.runId);
    if (bundle?.run?.runId !== row.runId) fail('LEARNING_VERIFICATION_RETRY_LINK_MISMATCH');
    await assertBundleScope(bundle, ctx, ordinal);
    if (chain.length) {
      const parent = chain.at(-1);
      assertTerminalHttpTimeout(parent, { cooldown: false });
      if (Date.parse(bundle.run.createdAt) < Date.parse(parent.latestAttempt.terminalAt)
        || (bundle.executionPlan.plan.purpose || 'REGRESSION') !== childPurpose(parent, ctx.scenario)) {
        fail('LEARNING_VERIFICATION_RETRY_CHAIN_INCONSISTENT');
      }
    }
    chain.push(bundle);
  }
  return chain;
}

/** For both explicit verify-outcome and the result queue. Does not create a Run,
 * mutate a proposal or trust claims in the request. Legacy root links retain
 * their existing verification path; new retry links are validated fully here.
 */
export async function assertLinkedVerificationRetry({ env, organizationId, projectId, run, proposal = null, deps = {} }) {
  retryEnabled(env);
  const link = parseEvolutionVerificationKey(run?.idempotencyKey);
  if (!link || link.attemptNumber < 2) fail('LEARNING_VERIFICATION_RETRY_LINK_MISMATCH');
  const common = { env, organizationId, projectId };
  const p = proposal || await (deps.getProposal || getEvolutionProposal)({ ...common, proposalId: link.proposalId });
  if (p.proposalId !== link.proposalId || p.result?.testDesignVersionId !== link.testDesignVersionId) fail('LEARNING_VERIFICATION_RETRY_LINK_MISMATCH');
  const ctx = await contextFor(common, p, deps), chain = await loadChain(ctx, link.attemptNumber, deps);
  const current = chain.at(-1);
  if (current.run.runId !== run.runId) fail('LEARNING_VERIFICATION_RETRY_LINK_MISMATCH');
  return { link, proposal: p, bundle: current, retryOfRunId: chain.at(-2).run.runId };
}

export async function retryEvolutionVerification({ env, organizationId, projectId, userId, proposal, retryOfRunId, deps = {} }) {
  retryEnabled(env);
  if (typeof userId !== 'string' || !/^usr_[A-Za-z0-9_-]+$/.test(userId)) fail('LEARNING_VERIFICATION_RETRY_ACTOR_REQUIRED', 403);
  appliedProposal(proposal);
  const common = { env, organizationId, projectId, userId };
  const previous = await (deps.getRunBundle || getRunBundle)(env, organizationId, projectId, retryOfRunId);
  const link = parseEvolutionVerificationKey(previous?.run?.idempotencyKey);
  if (!link || previous.run.runId !== retryOfRunId || link.proposalId !== proposal.proposalId
    || link.testDesignVersionId !== proposal.result.testDesignVersionId) fail('LEARNING_VERIFICATION_RETRY_RUN_NOT_LINKED');
  if (link.attemptNumber >= MAX_VERIFICATION_ATTEMPTS) fail('LEARNING_VERIFICATION_RETRY_LIMIT_REACHED');
  const ctx = await contextFor(common, proposal, deps);
  const chain = await loadChain(ctx, link.attemptNumber, deps), parent = chain.at(-1);
  if (parent.run.runId !== retryOfRunId) fail('LEARNING_VERIFICATION_RETRY_RUN_NOT_LINKED');
  const nextLink = { ...link, attemptNumber: link.attemptNumber + 1 };
  const key = evolutionVerificationKey(link.proposalId, link.testDesignVersionId, nextLink.attemptNumber);
  const existing = await (deps.findRun || getRunByIdempotencyKey)(env, organizationId, projectId, key);
  let created;
  if (existing) {
    const child = await (deps.getRunBundle || getRunBundle)(env, organizationId, projectId, existing.runId);
    await assertBundleScope(child, ctx, nextLink.attemptNumber);
    assertTerminalHttpTimeout(parent, { cooldown: false });
    if (Date.parse(child.run.createdAt) < Date.parse(parent.latestAttempt.terminalAt)
      || (child.executionPlan.plan.purpose || 'REGRESSION') !== childPurpose(parent, ctx.scenario)) fail('LEARNING_VERIFICATION_RETRY_CHAIN_INCONSISTENT');
    // Replay remains the same child, even after it finishes. A send failure can
    // resume its existing pending dispatch; terminal Runs are never redispatched.
    if (child.run.status === 'CREATED' && child.dispatch?.status === 'PENDING' && !child.latestAttempt) {
      created = await (deps.resumeRun || createRunV1)({ ...common, input: runInput(child), idempotencyKey: key, deps: deps.runDeps || {} });
    } else {
      created = await (deps.readRun || getRunV1)({ ...common, runId: child.run.runId });
    }
    created = { ...created, idempotentReplay: true };
  } else {
    // Never replace an existing immutable verification, even VERIFICATION_BLOCKED
    // produced by an older deployment. This fix recovers pending/null receipts.
    if (proposal.outcomeVerification) fail('LEARNING_VERIFICATION_RETRY_RECEIPT_EXISTS');
    assertTerminalHttpTimeout(parent, { nowMs: deps.nowMs?.() ?? Date.now() });
    const previousResult = await (deps.getFailedResult || getResultsLatestRunResultSet)({ ...common, runId: retryOfRunId });
    assertHttpTimeoutResult(previousResult, parent);
    created = await (deps.createRerun || createEvolutionRerunV1)({
      ...common,
      sourceRunId: proposal.source.runId, // original successful source, NOT the timeout Run
      testDesignVersionId: proposal.result.testDesignVersionId,
      environmentId: ctx.environmentId,
      scenarioId: proposal.source.scenarioId,
      purpose: childPurpose(parent, ctx.scenario),
      idempotencyKey: key,
      deps: deps.rerunDeps || {},
    });
  }
  const metadata = verificationAttemptMetadata(nextLink, { retryOfRunId, idempotentReplay: created.idempotentReplay });
  // Only safe identifiers/outcomes. Do not log Results payloads or runtime reuse.
  console.info(JSON.stringify({ event: 'evolution_verification_retry', projectId, proposalId: proposal.proposalId,
    runId: created.run?.runId || null, retryOfRunId, attemptNumber: metadata.attemptNumber,
    idempotentReplay: metadata.idempotentReplay, reasonCode: metadata.retryReason }));
  return { ...created, verificationAttempt: metadata };
}

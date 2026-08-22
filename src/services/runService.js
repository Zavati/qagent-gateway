import {
  RUN_CONTRACT_VERSION,
  fingerprintRunCreateInput,
} from '../lib/runContracts.js';
import {
  createRunArtifacts,
  getRun,
  getRunBundle,
  getRunByIdempotencyKey,
} from '../repositories/runRepository.js';
import { getRunnerTestArtifact } from './testRegistryClient.js';
import { materializeExecutionPlanV1 } from './executionPlanMaterializerService.js';
import { dispatchRunToQueueV1 } from './runQueueDispatchService.js';

function logger(env) {
  if (typeof env?.log === 'function') return env.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

function runError(message, code, status = 409, publicDetails = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

function isUniqueConflict(error) {
  return String(error?.message || '').includes('UNIQUE constraint failed');
}

function safeRunEnvelope(bundle, { idempotentReplay = false } = {}) {
  const run = bundle?.run;
  const plan = bundle?.executionPlan;
  const snapshot = bundle?.runtimeSnapshot;
  if (!run) return null;

  return {
    contractVersion: RUN_CONTRACT_VERSION,
    run: {
      runId: run.runId,
      status: run.status,
      projectId: run.projectId,
      testDesignId: run.testDesignId,
      testDesignVersionId: run.testDesignVersionId,
      testDesignVersion: run.testDesignVersion,
      endpointId: run.endpointId,
      environmentId: run.environmentId,
      executionPlanId: run.executionPlanId,
      runtimeSnapshotId: run.runtimeSnapshotId,
      scenarioIds: run.scenarioIds,
      scenarioCount: run.scenarioCount,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    executionPlan: plan ? {
      contractVersion: plan.contractVersion,
      executionPlanId: plan.executionPlanId,
      planHash: plan.planHash,
      scenarioCount: plan.scenarioCount,
      schemaSnapshotCount: plan.schemaSnapshotCount,
      createdAt: plan.createdAt,
    } : null,
    runtime: snapshot ? {
      contractVersion: snapshot.contractVersion,
      runtimeSnapshotId: snapshot.runtimeSnapshotId,
      snapshotHash: snapshot.snapshotHash,
      resolution: {
        source: snapshot.resolutionSource,
        confidence: snapshot.resolutionConfidence,
        requiresExecutionConfirmation: snapshot.requiresExecutionConfirmation,
      },
      environment: snapshot.snapshot?.environment ? {
        environmentId: snapshot.snapshot.environment.environmentId,
        name: snapshot.snapshot.environment.name,
        slug: snapshot.snapshot.environment.slug,
        environmentType: snapshot.snapshot.environment.environmentType,
      } : null,
      apiServiceKeys: Object.keys(snapshot.snapshot?.apiServices || {}).sort(),
      authProfileRefs: Object.keys(snapshot.snapshot?.authProfiles || {}).sort(),
      createdAt: snapshot.createdAt,
    } : null,
    queue: bundle?.dispatch ? {
      status: bundle.dispatch.status,
      dispatchAttemptCount: bundle.dispatch.dispatchAttemptCount,
      publishedAt: bundle.dispatch.publishedAt || null,
      runnerReceivedAt: bundle.dispatch.runnerReceivedAt || null,
    } : null,
    executionAttempt: bundle?.latestAttempt ? {
      attemptId: bundle.latestAttempt.attemptId,
      attemptNumber: bundle.latestAttempt.attemptNumber,
      status: bundle.latestAttempt.status,
      leaseAcquiredAt: bundle.latestAttempt.leaseAcquiredAt,
      leaseExpiresAt: bundle.latestAttempt.leaseExpiresAt,
      heartbeatAt: bundle.latestAttempt.heartbeatAt || null,
      heartbeatCount: bundle.latestAttempt.heartbeatCount,
      queueDeliveryAttempt: bundle.latestAttempt.queueDeliveryAttempt,
      lastErrorCode: bundle.latestAttempt.lastErrorCode || null,
      nextRetryAt: bundle.latestAttempt.nextRetryAt || null,
      receivedAt: bundle.latestAttempt.receivedAt || null,
      terminalAt: bundle.latestAttempt.terminalAt || null,
      runtimeReadinessStatus: bundle.latestAttempt.runtimeReadinessStatus || null,
      runtimePlanHash: bundle.latestAttempt.runtimePlanHash || null,
      runtimeTargetCount: bundle.latestAttempt.runtimeTargetCount == null ? null : Number(bundle.latestAttempt.runtimeTargetCount),
      runtimeResolutionSource: bundle.latestAttempt.runtimeResolutionSource || null,
      runtimeResolutionConfidence: bundle.latestAttempt.runtimeResolutionConfidence || null,
      runtimeMaterializedAt: bundle.latestAttempt.runtimeMaterializedAt || null,
      httpExecutionStatus: bundle.latestAttempt.httpExecutionStatus || null,
      httpRequestCount: bundle.latestAttempt.httpRequestCount == null ? null : Number(bundle.latestAttempt.httpRequestCount),
      httpResponseCount: bundle.latestAttempt.httpResponseCount == null ? null : Number(bundle.latestAttempt.httpResponseCount),
      httpNetworkErrorCount: bundle.latestAttempt.httpNetworkErrorCount == null ? null : Number(bundle.latestAttempt.httpNetworkErrorCount),
      httpTimeoutCount: bundle.latestAttempt.httpTimeoutCount == null ? null : Number(bundle.latestAttempt.httpTimeoutCount),
      httpRedirectCount: bundle.latestAttempt.httpRedirectCount == null ? null : Number(bundle.latestAttempt.httpRedirectCount),
      httpDurationMs: bundle.latestAttempt.httpDurationMs == null ? null : Number(bundle.latestAttempt.httpDurationMs),
      httpExecutedAt: bundle.latestAttempt.httpExecutedAt || null,
      httpResponseStatusCounts: bundle.latestAttempt.httpExecutionStatus ? {
        response2xxCount: Number(bundle.latestAttempt.httpResponse2xxCount || 0),
        response3xxCount: Number(bundle.latestAttempt.httpResponse3xxCount || 0),
        response4xxCount: Number(bundle.latestAttempt.httpResponse4xxCount || 0),
        response5xxCount: Number(bundle.latestAttempt.httpResponse5xxCount || 0),
      } : null,
      httpDiagnostic: bundle.latestAttempt.httpPrimaryDiagnosticKind ? {
        kind: bundle.latestAttempt.httpPrimaryDiagnosticKind,
        scenarioId: bundle.latestAttempt.httpPrimaryScenarioId || null,
        statusCode: bundle.latestAttempt.httpPrimaryStatusCode == null ? null : Number(bundle.latestAttempt.httpPrimaryStatusCode),
        errorCode: bundle.latestAttempt.httpPrimaryErrorCode || null,
        errorCategory: bundle.latestAttempt.httpPrimaryErrorCategory || null,
        errorName: bundle.latestAttempt.httpPrimaryErrorName || null,
        causeCode: bundle.latestAttempt.httpPrimaryCauseCode || null,
      } : null,
    } : null,
    idempotentReplay,
  };
}

function assertBundleComplete(bundle) {
  if (!bundle?.run || !bundle?.executionPlan || !bundle?.runtimeSnapshot) {
    runError('Run persistido está incompleto.', 'RUN_PERSISTED_STATE_INVALID', 500);
  }
  if (
    bundle.run.executionPlanId !== bundle.executionPlan.executionPlanId
    || bundle.run.runtimeSnapshotId !== bundle.runtimeSnapshot.runtimeSnapshotId
    || bundle.executionPlan.runtimeSnapshotId !== bundle.runtimeSnapshot.runtimeSnapshotId
  ) {
    runError('Run persistido possui referências inconsistentes.', 'RUN_PERSISTED_STATE_INVALID', 500);
  }
}

export async function createRunV1({
  env,
  organizationId,
  projectId,
  userId = null,
  input,
  idempotencyKey,
  deps = {},
} = {}) {
  const log = logger(env);
  const requestFingerprint = await fingerprintRunCreateInput(input);
  const findByIdempotency = deps.getRunByIdempotencyKey || getRunByIdempotencyKey;
  const loadBundle = deps.getRunBundle || getRunBundle;
  const loadArtifact = deps.getRunnerTestArtifact || getRunnerTestArtifact;
  const materializePlan = deps.materializeExecutionPlan || materializeExecutionPlanV1;
  const persistArtifacts = deps.createRunArtifacts || createRunArtifacts;
  const dispatchRun = deps.dispatchRun || dispatchRunToQueueV1;

  const existing = await findByIdempotency(env, organizationId, projectId, idempotencyKey);
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) {
      runError('Idempotency-Key já foi usado com outro payload de Run.', 'RUN_IDEMPOTENCY_CONFLICT', 409);
    }
    let bundle = await loadBundle(env, organizationId, projectId, existing.runId);
    assertBundleComplete(bundle);
    log('run_idempotent_replay', {
      runId: existing.runId,
      organizationId,
      projectId,
      testDesignVersionId: existing.testDesignVersionId,
      environmentId: existing.environmentId,
    });
    bundle = await dispatchRun({ env, bundle });
    assertBundleComplete(bundle);
    return safeRunEnvelope(bundle, { idempotentReplay: true });
  }

  const artifact = await loadArtifact({
    env,
    organizationId,
    projectId,
    testDesignVersionId: input.testDesignVersionId,
  });

  const now = new Date().toISOString();
  const runId = `run_${crypto.randomUUID()}`;
  const executionPlanId = `xplan_${crypto.randomUUID()}`;
  const runtimeSnapshotId = `rts_${crypto.randomUUID()}`;

  const materialized = await materializePlan({
    env,
    organizationId,
    projectId,
    artifact,
    environmentId: input.environmentId,
    requestedScenarioIds: input.scenarioIds,
    confirmDiscoveredRuntime: input.confirmDiscoveredRuntime === true,
    runId,
    executionPlanId,
    runtimeSnapshotId,
    createdAt: now,
  });

  const run = {
    contractVersion: RUN_CONTRACT_VERSION,
    runId,
    organizationId,
    projectId,
    testDesignId: artifact.testDesignId,
    testDesignVersionId: artifact.testDesignVersionId,
    testDesignVersion: artifact.version,
    endpointId: artifact.endpointId,
    environmentId: input.environmentId,
    executionPlanId,
    runtimeSnapshotId,
    status: 'CREATED',
    scenarioCount: materialized.selectedScenarioIds.length,
    scenarioIds: materialized.selectedScenarioIds,
    idempotencyKey,
    requestFingerprint,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };

  let bundle;
  try {
    bundle = await persistArtifacts(env, {
      run,
      runtimeSnapshot: materialized.runtimeSnapshot,
      executionPlan: materialized.executionPlan,
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;

    // Concurrent retry with the same idempotency key. Re-read instead of producing another Run.
    const replay = await findByIdempotency(env, organizationId, projectId, idempotencyKey);
    if (!replay || replay.requestFingerprint !== requestFingerprint) {
      throw error;
    }
    bundle = await loadBundle(env, organizationId, projectId, replay.runId);
    assertBundleComplete(bundle);
    bundle = await dispatchRun({ env, bundle });
    assertBundleComplete(bundle);
    return safeRunEnvelope(bundle, { idempotentReplay: true });
  }

  assertBundleComplete(bundle);
  log('run_created', {
    runId,
    organizationId,
    projectId,
    testDesignVersionId: artifact.testDesignVersionId,
    environmentId: input.environmentId,
    executionPlanId,
    runtimeSnapshotId,
    scenarioCount: materialized.selectedScenarioIds.length,
    schemaSnapshotCount: materialized.executionPlan.schemaSnapshots.length,
    runtimeResolutionSource: materialized.runtimeSnapshot.resolution.source,
  });

  bundle = await dispatchRun({ env, bundle });
  assertBundleComplete(bundle);
  return safeRunEnvelope(bundle, { idempotentReplay: false });
}

export async function getRunV1({
  env,
  organizationId,
  projectId,
  runId,
  deps = {},
} = {}) {
  const loadBundle = deps.getRunBundle || getRunBundle;
  const bundle = await loadBundle(env, organizationId, projectId, runId);
  if (!bundle?.run) {
    runError('Run não encontrado.', 'RUN_NOT_FOUND', 404);
  }
  assertBundleComplete(bundle);
  return safeRunEnvelope(bundle);
}

// Internal helper reserved for the Queue/Runner foundation. Not exposed by Console in 07.7.2.
export async function getRunRecordV1(env, organizationId, projectId, runId) {
  return getRun(env, organizationId, projectId, runId);
}

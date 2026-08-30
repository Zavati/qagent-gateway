import {
  RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
  RUNNER_HEARTBEAT_CONTRACT_VERSION,
  RUNNER_RECEIVED_CONTRACT_VERSION,
  RUNNER_RECEIVED_V2_CONTRACT_VERSION,
  RUNNER_RETRY_CONTRACT_VERSION,
  RUNNER_RUN_BUNDLE_CONTRACT_VERSION,
  normalizeRunnerClaimInput,
  normalizeRunnerHeartbeatInput,
  normalizeRunnerReceivedInput,
  normalizeRunnerReceivedV2Input,
  normalizeRunnerRetryInput,
  normalizeRunnerRuntimeReadyInput,
  normalizeRunnerHttpExecutedInput,
  normalizeRunnerAssertionsEvaluatedInput,
  normalizeRunnerAuthMaterialRequestInput,
  normalizeRunnerAuthResolvedInput,
  normalizeRunnerTestDataMaterialRequestInput,
  normalizeRunnerTestDataResolvedInput,
  normalizeRunnerRejectedInput,
  RUNNER_AUTH_MATERIAL_CONTRACT_VERSION,
  RUNNER_AUTH_RESOLVED_CONTRACT_VERSION,
  RUNNER_TEST_DATA_MATERIAL_CONTRACT_VERSION,
  RUNNER_TEST_DATA_RESOLVED_CONTRACT_VERSION,
  sha256Hex,
} from '../lib/runContracts.js';
import {
  getRunBundleByRunId,
  markRunRunnerReceived,
} from '../repositories/runRepository.js';
import {
  heartbeatRunExecution,
  markRunExecutionCancelled,
  markRunExecutionReceived,
  markRunExecutionRetry,
  markRunExecutionRuntimeReady,
  markRunExecutionHttpExecuted,
  markRunAssertionsEvaluated,
  markRunAuthResolved,
  markRunTestDataResolved,
  markRunExecutionRejected,
  getRunExecutionClaim,
  tryClaimRunExecution,
} from '../repositories/runExecutionClaimRepository.js';
import { verifyRunnerControlRequest } from '../security/runnerControlAuth.js';
import { resolveAuthProfileCredentialsJit } from '../services/authProfileRuntimeService.js';
import { resolveProjectSecretValue } from '../services/secretVaultService.js';
import { refreshSuiteRunByChildRunId } from '../repositories/suiteRunRepository.js';
import { normalizeMutationPreflightInput, normalizeMutationDispatchInput, normalizeMutationResponseInput, normalizeMutationCompleteInput, normalizeMutationUnknownInput, normalizeMutationFailedBeforeDispatchInput, MUTATION_METHODS } from '../lib/mutationContracts.js';
import { preflightMutationExecution, markMutationDispatching, markMutationResponseReceived, markMutationCompleted, markMutationUnknown, markMutationFailedBeforeDispatch } from '../services/mutationExecutionJournalService.js';

function internalError(message, code, status = 409, publicDetails = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

function normalizeRunId(value) {
  const runId = String(value ?? '').trim();
  if (!/^run_[A-Za-z0-9_-]{8,220}$/.test(runId)) {
    internalError('runId inválido.', 'RUNNER_CONTROL_RUN_ID_INVALID', 400);
  }
  return runId;
}

async function readRawJson(req, maxBytes = 8_192) {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) internalError('Payload obrigatório.', 'RUNNER_CONTROL_BODY_REQUIRED', 400);
  if (buffer.byteLength > maxBytes) internalError('Payload grande demais.', 'RUNNER_CONTROL_BODY_TOO_LARGE', 413);
  const rawBody = new TextDecoder().decode(buffer);
  let body;
  try { body = JSON.parse(rawBody); } catch { internalError('JSON inválido.', 'RUNNER_CONTROL_JSON_INVALID', 400); }
  return { rawBody, body };
}

function assertBundle(bundle, runId) {
  const run = bundle?.run;
  const plan = bundle?.executionPlan;
  const snapshot = bundle?.runtimeSnapshot;
  if (!run || !plan || !snapshot || run.runId !== runId) {
    internalError('Run bundle não encontrado.', 'RUNNER_CONTROL_RUN_NOT_FOUND', 404);
  }
  if (
    run.executionPlanId !== plan.executionPlanId
    || run.runtimeSnapshotId !== snapshot.runtimeSnapshotId
    || plan.runtimeSnapshotId !== snapshot.runtimeSnapshotId
  ) {
    internalError('Run bundle inconsistente.', 'RUNNER_CONTROL_BUNDLE_INVALID', 500);
  }
}

function assertReferences(bundle, input) {
  if (
    bundle.run.executionPlanId !== input.executionPlanId
    || bundle.run.runtimeSnapshotId !== input.runtimeSnapshotId
  ) {
    internalError('Runner referencia artefatos divergentes.', 'RUNNER_CONTROL_REFERENCE_MISMATCH', 409);
  }
}

function intEnv(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function leaseSeconds(env) {
  return intEnv(env?.RUNNER_LEASE_SECONDS, 60, 15, 600);
}

function addSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + (seconds * 1000)).toISOString();
}

function retryAfterForLease(leaseExpiresAt, nowIso) {
  const remainingMs = Math.max(0, Date.parse(leaseExpiresAt || '') - Date.parse(nowIso));
  return Math.max(1, Math.min(600, Math.ceil(remainingMs / 1000) + 1));
}

function randomBase64Url(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = '';
  for (const item of data) binary += String.fromCharCode(item);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeAttempt(attempt) {
  if (!attempt) return null;
  return {
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    leaseAcquiredAt: attempt.leaseAcquiredAt,
    leaseExpiresAt: attempt.leaseExpiresAt,
    heartbeatAt: attempt.heartbeatAt || null,
    heartbeatCount: attempt.heartbeatCount,
    queueMessageId: attempt.queueMessageId || null,
    queueDeliveryAttempt: attempt.queueDeliveryAttempt,
    lastErrorCode: attempt.lastErrorCode || null,
    nextRetryAt: attempt.nextRetryAt || null,
    receivedAt: attempt.receivedAt || null,
    terminalAt: attempt.terminalAt || null,
    runtimeReadinessStatus: attempt.runtimeReadinessStatus || null,
    runtimePlanHash: attempt.runtimePlanHash || null,
    runtimeTargetCount: attempt.runtimeTargetCount == null ? null : Number(attempt.runtimeTargetCount),
    runtimeResolutionSource: attempt.runtimeResolutionSource || null,
    runtimeResolutionConfidence: attempt.runtimeResolutionConfidence || null,
    runtimeMaterializedAt: attempt.runtimeMaterializedAt || null,
    httpExecutionStatus: attempt.httpExecutionStatus || null,
    httpRequestCount: attempt.httpRequestCount == null ? null : Number(attempt.httpRequestCount),
    httpResponseCount: attempt.httpResponseCount == null ? null : Number(attempt.httpResponseCount),
    httpNetworkErrorCount: attempt.httpNetworkErrorCount == null ? null : Number(attempt.httpNetworkErrorCount),
    httpTimeoutCount: attempt.httpTimeoutCount == null ? null : Number(attempt.httpTimeoutCount),
    httpRedirectCount: attempt.httpRedirectCount == null ? null : Number(attempt.httpRedirectCount),
    httpDurationMs: attempt.httpDurationMs == null ? null : Number(attempt.httpDurationMs),
    httpExecutedAt: attempt.httpExecutedAt || null,
    assertionExecutionStatus: attempt.assertionExecutionStatus || null,
    assertionOutcome: attempt.assertionOutcome || null,
    assertionScenarioCount: attempt.assertionScenarioCount == null ? null : Number(attempt.assertionScenarioCount),
    assertionScenarioPassedCount: attempt.assertionScenarioPassedCount == null ? null : Number(attempt.assertionScenarioPassedCount),
    assertionScenarioFailedCount: attempt.assertionScenarioFailedCount == null ? null : Number(attempt.assertionScenarioFailedCount),
    assertionScenarioNotEvaluatedCount: attempt.assertionScenarioNotEvaluatedCount == null ? null : Number(attempt.assertionScenarioNotEvaluatedCount),
    assertionCount: attempt.assertionCount == null ? null : Number(attempt.assertionCount),
    assertionPassedCount: attempt.assertionPassedCount == null ? null : Number(attempt.assertionPassedCount),
    assertionFailedCount: attempt.assertionFailedCount == null ? null : Number(attempt.assertionFailedCount),
    assertionNotEvaluatedCount: attempt.assertionNotEvaluatedCount == null ? null : Number(attempt.assertionNotEvaluatedCount),
    assertionDurationMs: attempt.assertionDurationMs == null ? null : Number(attempt.assertionDurationMs),
    assertionEvaluatedAt: attempt.assertionEvaluatedAt || null,
    authRuntimeStatus: attempt.authRuntimeStatus || null,
    authRequiredScenarioCount: attempt.authRequiredScenarioCount == null ? null : Number(attempt.authRequiredScenarioCount),
    authResolvedProfileCount: attempt.authResolvedProfileCount == null ? null : Number(attempt.authResolvedProfileCount),
    authDynamicExchangeCount: attempt.authDynamicExchangeCount == null ? null : Number(attempt.authDynamicExchangeCount),
    authCacheHitCount: attempt.authCacheHitCount == null ? null : Number(attempt.authCacheHitCount),
    authDurationMs: attempt.authDurationMs == null ? null : Number(attempt.authDurationMs),
    authResolvedAt: attempt.authResolvedAt || null,
    testDataRuntimeStatus: attempt.testDataRuntimeStatus || null,
    testDataBindingCount: attempt.testDataBindingCount == null ? null : Number(attempt.testDataBindingCount),
    testDataGeneratedCount: attempt.testDataGeneratedCount == null ? null : Number(attempt.testDataGeneratedCount),
    testDataFixedCount: attempt.testDataFixedCount == null ? null : Number(attempt.testDataFixedCount),
    testDataSecretCount: attempt.testDataSecretCount == null ? null : Number(attempt.testDataSecretCount),
    testDataDurationMs: attempt.testDataDurationMs == null ? null : Number(attempt.testDataDurationMs),
    testDataResolvedAt: attempt.testDataResolvedAt || null,
  };
}

function safeInternalBundle(bundle) {
  const run = bundle.run;
  return {
    contractVersion: RUNNER_RUN_BUNDLE_CONTRACT_VERSION,
    run: {
      runId: run.runId,
      status: run.status,
      organizationId: run.organizationId,
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
    executionPlan: bundle.executionPlan.plan,
    runtimeSnapshot: bundle.runtimeSnapshot.snapshot,
    queue: bundle.dispatch ? {
      status: bundle.dispatch.status,
      dispatchAttemptCount: bundle.dispatch.dispatchAttemptCount,
      publishedAt: bundle.dispatch.publishedAt || null,
      runnerReceivedAt: bundle.dispatch.runnerReceivedAt || null,
    } : null,
    latestAttempt: safeAttempt(bundle.latestAttempt),
  };
}

export async function getInternalRunnerRunBundle(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
  } = {},
) {
  await verifyRequest(req, env, { rawBody: '' });
  const normalizedRunId = normalizeRunId(runId);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  return { status: 'ok', data: safeInternalBundle(bundle) };
}

export async function postInternalRunnerClaim(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    tryClaim = tryClaimRunExecution,
    now = () => new Date().toISOString(),
    newAttemptId = () => `runatt_${crypto.randomUUID()}`,
    newLeaseToken = () => randomBase64Url(32),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerClaimInput(body);

  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  assertReferences(bundle, input);

  if (bundle.dispatch?.status === 'RECEIVED') {
    return {
      status: 'ok',
      data: {
        contractVersion: RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
        claimStatus: 'ALREADY_RECEIVED',
        runId: normalizedRunId,
        latestAttempt: safeAttempt(bundle.latestAttempt),
      },
    };
  }

  if (bundle.run.status === 'CANCELLED') {
    return {
      status: 'ok',
      data: {
        contractVersion: RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
        claimStatus: 'CANCELLED',
        runId: normalizedRunId,
      },
    };
  }
  if (['PASSED', 'FAILED', 'ERROR'].includes(bundle.run.status)) {
    return {
      status: 'ok',
      data: {
        contractVersion: RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
        claimStatus: 'TERMINAL',
        runId: normalizedRunId,
        runStatus: bundle.run.status,
      },
    };
  }
  if (!['CREATED', 'QUEUED', 'RUNNING'].includes(bundle.run.status)) {
    internalError(`Run não pode ser claimed em status ${bundle.run.status}.`, 'RUNNER_CONTROL_RUN_STATUS_INVALID', 409);
  }

  const acquiredAt = now();
  const expiresAt = addSeconds(acquiredAt, leaseSeconds(env));
  const attemptId = newAttemptId();
  const leaseToken = newLeaseToken();
  const leaseTokenHash = await sha256Hex(leaseToken);

  const claim = await tryClaim(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId,
    leaseOwnerId: input.leaseOwnerId,
    leaseTokenHash,
    leaseAcquiredAt: acquiredAt,
    leaseExpiresAt: expiresAt,
    queueMessageId: input.queueMessageId,
    queueDeliveryAttempt: input.queueDeliveryAttempt,
  });

  if (!claim?.acquired) {
    const activeExpiry = claim?.claim?.leaseExpiresAt || expiresAt;
    return {
      status: 'ok',
      data: {
        contractVersion: RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
        claimStatus: 'ACTIVE_LEASE',
        runId: normalizedRunId,
        activeAttemptId: claim?.claim?.currentAttemptId || null,
        attemptNumber: claim?.claim?.currentAttemptNumber || null,
        leaseExpiresAt: activeExpiry,
        retryAfterSeconds: retryAfterForLease(activeExpiry, acquiredAt),
      },
    };
  }

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_CLAIM_RESULT_CONTRACT_VERSION,
      claimStatus: 'CLAIMED',
      runId: normalizedRunId,
      attemptId,
      attemptNumber: claim.attempt?.attemptNumber || claim.claim?.currentAttemptNumber || 1,
      leaseToken,
      leaseAcquiredAt: acquiredAt,
      leaseExpiresAt: expiresAt,
    },
  };
}

export async function postInternalRunnerHeartbeat(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    heartbeat = heartbeatRunExecution,
    cancelAttempt = markRunExecutionCancelled,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerHeartbeatInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);

  const heartbeatAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  if (bundle.run.status === 'CANCELLED') {
    await cancelAttempt(env, {
      organizationId: bundle.run.organizationId,
      projectId: bundle.run.projectId,
      runId: normalizedRunId,
      attemptId: input.attemptId,
      leaseTokenHash,
      cancelledAt: heartbeatAt,
    });
    return {
      status: 'ok',
      data: {
        contractVersion: RUNNER_HEARTBEAT_CONTRACT_VERSION,
        heartbeatStatus: 'CANCELLED',
        runId: normalizedRunId,
        attemptId: input.attemptId,
      },
    };
  }

  const expiresAt = addSeconds(heartbeatAt, leaseSeconds(env));
  const result = await heartbeat(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    heartbeatAt,
    leaseExpiresAt: expiresAt,
  });
  if (!result?.updated) {
    internalError('Lease não está ativa ou expirou.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_HEARTBEAT_CONTRACT_VERSION,
      heartbeatStatus: 'EXTENDED',
      runId: normalizedRunId,
      attemptId: input.attemptId,
      heartbeatAt,
      leaseExpiresAt: expiresAt,
      heartbeatCount: result.attempt?.heartbeatCount || null,
    },
  };
}

export async function postInternalRunnerRetry(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markRetry = markRunExecutionRetry,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerRetryInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);

  const retryAt = now();
  const nextRetryAt = addSeconds(retryAt, input.retryAfterSeconds);
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markRetry(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    errorCode: input.errorCode,
    retryAt,
    nextRetryAt,
  });
  if (!result?.updated) {
    internalError('Retry não pôde liberar a lease ativa.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_RETRY_CONTRACT_VERSION,
      retryStatus: 'SCHEDULED',
      runId: normalizedRunId,
      attemptId: input.attemptId,
      errorCode: input.errorCode,
      retryAfterSeconds: input.retryAfterSeconds,
      nextRetryAt,
    },
  };
}

export async function postInternalRunnerReceived(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markReceived = markRunRunnerReceived,
    markReceivedWithLease = markRunExecutionReceived,
    refreshSuiteRun = refreshSuiteRunByChildRunId,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });

  if (body?.contractVersion === RUNNER_RECEIVED_V2_CONTRACT_VERSION) {
    const input = normalizeRunnerReceivedV2Input(body);
    let bundle = await getBundle(env, normalizedRunId);
    assertBundle(bundle, normalizedRunId);
    assertReferences(bundle, input);

    if (
      bundle.dispatch?.status === 'RECEIVED'
      && bundle.latestAttempt?.attemptId === input.attemptId
      && bundle.latestAttempt?.status === 'RECEIVED'
    ) {
      return {
        status: 'ok',
        data: {
          contractVersion: RUNNER_RECEIVED_V2_CONTRACT_VERSION,
          runId: normalizedRunId,
          executionPlanId: input.executionPlanId,
          runtimeSnapshotId: input.runtimeSnapshotId,
          attemptId: input.attemptId,
          queueStatus: 'RECEIVED',
          runnerReceivedAt: bundle.dispatch?.runnerReceivedAt || null,
          idempotentReplay: true,
        },
      };
    }

    const leaseTokenHash = await sha256Hex(input.leaseToken);
    const result = await markReceivedWithLease(env, {
      organizationId: bundle.run.organizationId,
      projectId: bundle.run.projectId,
      runId: normalizedRunId,
      attemptId: input.attemptId,
      leaseTokenHash,
      receivedAt: now(),
    });
    if (!result?.updated) {
      internalError('Confirmação não possui lease ativa válida.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
    }

    bundle = await getBundle(env, normalizedRunId);
    assertBundle(bundle, normalizedRunId);
    try { await refreshSuiteRun(env, normalizedRunId); } catch {}
    return {
      status: 'ok',
      data: {
        contractVersion: RUNNER_RECEIVED_V2_CONTRACT_VERSION,
        runId: normalizedRunId,
        executionPlanId: input.executionPlanId,
        runtimeSnapshotId: input.runtimeSnapshotId,
        attemptId: input.attemptId,
        queueStatus: bundle.dispatch?.status || 'RECEIVED',
        runnerReceivedAt: bundle.dispatch?.runnerReceivedAt || null,
        idempotentReplay: false,
      },
    };
  }

  // Rolling-deploy compatibility with Foundation 07.7.3 runners.
  const input = normalizeRunnerReceivedInput(body);
  let bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  assertReferences(bundle, input);

  bundle = await markReceived(
    env,
    bundle.run.organizationId,
    bundle.run.projectId,
    normalizedRunId,
  );
  assertBundle(bundle, normalizedRunId);
  try { await refreshSuiteRun(env, normalizedRunId); } catch {}

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_RECEIVED_CONTRACT_VERSION,
      runId: normalizedRunId,
      executionPlanId: input.executionPlanId,
      runtimeSnapshotId: input.runtimeSnapshotId,
      queueStatus: bundle.dispatch?.status || 'RECEIVED',
      runnerReceivedAt: bundle.dispatch?.runnerReceivedAt || null,
    },
  };
}


export async function postInternalRunnerRuntimeReady(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markRuntimeReady = markRunExecutionRuntimeReady,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerRuntimeReadyInput(body);

  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  if (bundle.run.status === 'CANCELLED') {
    internalError('Run cancelado antes da materialização do runtime.', 'RUNNER_CONTROL_RUN_CANCELLED', 409);
  }
  if (['PASSED', 'FAILED', 'ERROR'].includes(bundle.run.status)) {
    internalError('Run já está terminal.', 'RUNNER_CONTROL_RUN_TERMINAL', 409);
  }

  const materializedAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markRuntimeReady(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    runtimePlanHash: input.runtimePlanHash,
    targetCount: input.targetCount,
    resolutionSource: input.resolutionSource,
    resolutionConfidence: input.resolutionConfidence,
    materializedAt,
  });
  if (!result.updated) {
    internalError('Lease não está ativa para registrar runtime readiness.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  return {
    status: 'ok',
    data: {
      runId: normalizedRunId,
      attemptId: input.attemptId,
      runtimeReadinessStatus: 'READY',
      runtimePlanHash: input.runtimePlanHash,
      targetCount: input.targetCount,
      resolutionSource: input.resolutionSource,
      resolutionConfidence: input.resolutionConfidence,
      runtimeMaterializedAt: materializedAt,
    },
  };
}




export async function postInternalRunnerMutationPreflight(
  req, env, { runId },
  { verifyRequest = verifyRunnerControlRequest, getBundle = getRunBundleByRunId, getClaim = getRunExecutionClaim, preflight = preflightMutationExecution, now = () => new Date().toISOString() } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req, 12_288);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeMutationPreflightInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  if (!Array.isArray(bundle.run.scenarioIds) || bundle.run.scenarioIds.length !== 1 || bundle.run.scenarioIds[0] !== input.scenarioId) {
    internalError('Business mutation exige um único cenário isolado por Run.', 'RUNNER_MUTATION_REQUIRES_SINGLE_SCENARIO', 409);
  }
  const scenario = (bundle.executionPlan?.plan?.scenarios || []).find((x) => x?.scenarioId === input.scenarioId);
  const method = String(scenario?.spec?.target?.method || '').toUpperCase();
  const canonicalPath = String(scenario?.spec?.target?.path || '');
  if (!MUTATION_METHODS.includes(method) || method !== input.method || canonicalPath !== input.canonicalPath) {
    internalError('Mutation preflight diverge do Execution Plan imutável.', 'RUNNER_MUTATION_PLAN_MISMATCH', 409);
  }
  const attempt = bundle.latestAttempt;
  if (!attempt || attempt.attemptId !== input.attemptId || attempt.runtimeReadinessStatus !== 'READY' || attempt.runtimePlanHash !== input.runtimePlanHash) {
    internalError('Mutation preflight exige o attempt/runtime READY atual.', 'RUNNER_MUTATION_RUNTIME_STATE_INVALID', 409);
  }
  const claim = await getClaim(env, bundle.run.organizationId, bundle.run.projectId, normalizedRunId);
  const nowIso = now();
  const leaseHash = await sha256Hex(input.leaseToken);
  if (!claim || claim.state !== 'ACTIVE' || claim.currentAttemptId !== input.attemptId || claim.leaseTokenHash !== leaseHash || !claim.leaseExpiresAt || claim.leaseExpiresAt <= nowIso) {
    internalError('Lease não está ativa para Mutation Preflight.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }
  const data = await preflight({ env, bundle, input });
  return { status: 'ok', data };
}


async function assertMutationControlBoundary(req, env, runId, scenarioId, normalizeInput, { verifyRequest=verifyRunnerControlRequest,getBundle=getRunBundleByRunId,getClaim=getRunExecutionClaim,now=()=>new Date().toISOString() }={}) {
  const normalizedRunId=normalizeRunId(runId);const {rawBody,body}=await readRawJson(req,12_288);await verifyRequest(req,env,{rawBody});const input=normalizeInput(body);const bundle=await getBundle(env,normalizedRunId);assertBundle(bundle,normalizedRunId);
  if(!Array.isArray(bundle.run.scenarioIds)||bundle.run.scenarioIds.length!==1||bundle.run.scenarioIds[0]!==scenarioId)internalError('Mutation control exige o cenário isolado do Run.','RUNNER_MUTATION_REQUIRES_SINGLE_SCENARIO',409);
  const scenario=(bundle.executionPlan?.plan?.scenarios||[]).find((x)=>x?.scenarioId===scenarioId);const method=String(scenario?.spec?.target?.method||'').toUpperCase();if(!MUTATION_METHODS.includes(method))internalError('Mutation control não corresponde a método mutável.','RUNNER_MUTATION_PLAN_MISMATCH',409);
  const attempt=bundle.latestAttempt;if(!attempt||attempt.attemptId!==input.attemptId||attempt.runtimeReadinessStatus!=='READY'||attempt.runtimePlanHash!==input.runtimePlanHash)internalError('Mutation control exige attempt/runtime READY atual.','RUNNER_MUTATION_RUNTIME_STATE_INVALID',409);
  const claim=await getClaim(env,bundle.run.organizationId,bundle.run.projectId,normalizedRunId);const nowIso=now();const leaseHash=await sha256Hex(input.leaseToken);if(!claim||claim.state!=='ACTIVE'||claim.currentAttemptId!==input.attemptId||claim.leaseTokenHash!==leaseHash||!claim.leaseExpiresAt||claim.leaseExpiresAt<=nowIso)internalError('Lease não está ativa para Mutation control.','RUNNER_CONTROL_LEASE_NOT_ACTIVE',409);
  return {normalizedRunId,input,bundle,method};
}
export async function postInternalRunnerMutationDispatching(req,env,{runId,scenarioId},deps={}){const c=await assertMutationControlBoundary(req,env,runId,scenarioId,normalizeMutationDispatchInput,deps);const journal=await (deps.markDispatching||markMutationDispatching)({env,runId:c.normalizedRunId,scenarioId,mutationExecutionId:c.input.mutationExecutionId,attemptId:c.input.attemptId,dispatchFingerprint:c.input.dispatchFingerprint,idempotencyKeyHash:c.input.idempotencyKeyHash});return {status:'ok',data:{contractVersion:'qagent.runner-mutation-state.v1',mutationExecutionId:journal.mutationExecutionId,state:journal.state,retryMode:journal.retryMode}};}
export async function postInternalRunnerMutationResponseReceived(req,env,{runId,scenarioId},deps={}){const c=await assertMutationControlBoundary(req,env,runId,scenarioId,normalizeMutationResponseInput,deps);const journal=await (deps.markResponse||markMutationResponseReceived)({env,runId:c.normalizedRunId,scenarioId,mutationExecutionId:c.input.mutationExecutionId,attemptId:c.input.attemptId,httpStatusCode:c.input.httpStatusCode});return {status:'ok',data:{contractVersion:'qagent.runner-mutation-state.v1',mutationExecutionId:journal.mutationExecutionId,state:journal.state,httpStatusCode:journal.httpStatusCode}};}
export async function postInternalRunnerMutationCompleted(req,env,{runId,scenarioId},deps={}){const c=await assertMutationControlBoundary(req,env,runId,scenarioId,normalizeMutationCompleteInput,deps);const journal=await (deps.markComplete||markMutationCompleted)({env,runId:c.normalizedRunId,scenarioId,mutationExecutionId:c.input.mutationExecutionId,attemptId:c.input.attemptId,assertionOutcome:c.input.assertionOutcome});return {status:'ok',data:{contractVersion:'qagent.runner-mutation-state.v1',mutationExecutionId:journal.mutationExecutionId,state:journal.state,assertionOutcome:journal.assertionOutcome}};}
export async function postInternalRunnerMutationUnknown(req,env,{runId,scenarioId},deps={}){const c=await assertMutationControlBoundary(req,env,runId,scenarioId,normalizeMutationUnknownInput,deps);const journal=await (deps.markUnknown||markMutationUnknown)({env,runId:c.normalizedRunId,scenarioId,mutationExecutionId:c.input.mutationExecutionId,attemptId:c.input.attemptId,lastErrorCode:c.input.errorCode});return {status:'ok',data:{contractVersion:'qagent.runner-mutation-state.v1',mutationExecutionId:journal.mutationExecutionId,state:journal.state}};}
export async function postInternalRunnerMutationFailedBeforeDispatch(req,env,{runId,scenarioId},deps={}){const c=await assertMutationControlBoundary(req,env,runId,scenarioId,normalizeMutationFailedBeforeDispatchInput,deps);const journal=await (deps.markFailed||markMutationFailedBeforeDispatch)({env,runId:c.normalizedRunId,scenarioId,mutationExecutionId:c.input.mutationExecutionId,attemptId:c.input.attemptId,lastErrorCode:c.input.errorCode});return {status:'ok',data:{contractVersion:'qagent.runner-mutation-state.v1',mutationExecutionId:journal.mutationExecutionId,state:journal.state}};}

function assertAuthMaterialLease(bundle, claim, input, nowIso) {
  const attempt = bundle?.latestAttempt;
  if (
    !attempt
    || attempt.attemptId !== input.attemptId
    || attempt.status !== 'CLAIMED'
    || attempt.runtimeReadinessStatus !== 'READY'
    || attempt.runtimePlanHash !== input.runtimePlanHash
  ) {
    internalError('Auth Material request não corresponde ao attempt READY atual.', 'RUNNER_CONTROL_AUTH_RUNTIME_STATE_INVALID', 409);
  }
  if (
    !claim
    || claim.state !== 'ACTIVE'
    || claim.currentAttemptId !== input.attemptId
    || !claim.leaseTokenHash
    || claim.leaseExpiresAt <= nowIso
  ) {
    internalError('Lease não está ativa para resolução de Auth Material.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }
}

function findSnapshotAuthProfile(bundle, authProfileRef) {
  const profiles = bundle?.runtimeSnapshot?.snapshot?.authProfiles || {};
  const direct = profiles[authProfileRef];
  if (direct) return direct;
  return Object.values(profiles).find((profile) => profile?.authProfileId === authProfileRef || profile?.profileKey === authProfileRef) || null;
}

function authProfileIsReferenced(bundle, authProfileRef) {
  return (bundle?.executionPlan?.plan?.scenarios || []).some((scenario) => {
    const auth = scenario?.spec?.auth || {};
    return auth.requirement === 'REQUIRED' && String(auth.authProfileRef || '').trim() === authProfileRef;
  });
}

export async function postInternalRunnerAuthMaterial(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    getClaim = getRunExecutionClaim,
    resolveRuntimeAuth = resolveAuthProfileCredentialsJit,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req, 12_288);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerAuthMaterialRequestInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);

  const nowIso = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const claim = await getClaim(env, bundle.run.organizationId, bundle.run.projectId, normalizedRunId);
  assertAuthMaterialLease(bundle, claim, input, nowIso);
  if (claim.leaseTokenHash !== leaseTokenHash) {
    internalError('Lease token inválido para Auth Material.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  const snapshotProfile = findSnapshotAuthProfile(bundle, input.authProfileRef);
  if (!snapshotProfile || snapshotProfile.credentialsConfigured !== true) {
    internalError('Auth Profile não existe no Runtime Snapshot.', 'RUNNER_CONTROL_AUTH_PROFILE_NOT_IN_SNAPSHOT', 409);
  }
  if (!authProfileIsReferenced(bundle, input.authProfileRef)) {
    internalError('Auth Profile não é referenciado pelo Execution Plan.', 'RUNNER_CONTROL_AUTH_PROFILE_NOT_REFERENCED', 409);
  }

  const resolved = await resolveRuntimeAuth(
    env,
    bundle.run.organizationId,
    bundle.run.projectId,
    bundle.run.environmentId,
    snapshotProfile.authProfileId,
  );
  if (!resolved || resolved.authProfileId !== snapshotProfile.authProfileId || resolved.type !== snapshotProfile.type) {
    internalError('Auth Profile mudou de tipo desde o Runtime Snapshot.', 'RUNNER_CONTROL_AUTH_PROFILE_DRIFT', 409);
  }
  if (!['basic', 'api_key', 'oauth2_client_credentials', 'login_http_json'].includes(snapshotProfile.type)) {
    internalError('Auth Profile REQUIRED possui tipo não executável.', 'RUNNER_CONTROL_AUTH_TYPE_UNSUPPORTED', 409);
  }
  if (!resolved.credentials || typeof resolved.credentials !== 'object' || Array.isArray(resolved.credentials)) {
    internalError('Credenciais do Auth Profile não estão disponíveis para execução.', 'RUNNER_CONTROL_AUTH_CREDENTIALS_UNAVAILABLE', 409);
  }

  let target = null;
  if (['oauth2_client_credentials', 'login_http_json'].includes(snapshotProfile.type)) {
    const frozenTarget = snapshotProfile?.target && typeof snapshotProfile.target === 'object' ? snapshotProfile.target : null;
    const serviceKey = String(frozenTarget?.apiServiceKey || snapshotProfile?.config?.apiServiceKey || '').trim();
    const service = bundle?.runtimeSnapshot?.snapshot?.apiServices?.[serviceKey];
    const targetPath = String(frozenTarget?.path || snapshotProfile?.config?.path || '').trim();
    if (!service?.baseUrl || !targetPath) {
      internalError('Auth target não está congelado no Runtime Snapshot.', 'RUNNER_CONTROL_AUTH_TARGET_NOT_IN_SNAPSHOT', 409);
    }
    target = {
      ...(frozenTarget?.source ? { source: frozenTarget.source } : {}),
      apiServiceKey: serviceKey,
      apiServiceId: service.apiServiceId || null,
      baseUrl: service.baseUrl,
      path: targetPath,
      method: 'POST',
    };
  }

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_AUTH_MATERIAL_CONTRACT_VERSION,
      runId: normalizedRunId,
      attemptId: input.attemptId,
      runtimePlanHash: input.runtimePlanHash,
      authProfileRef: input.authProfileRef,
      authProfileId: snapshotProfile.authProfileId,
      profileKey: snapshotProfile.profileKey || null,
      type: snapshotProfile.type,
      config: structuredClone(snapshotProfile.config || {}),
      target,
      credentials: resolved.credentials,
    },
  };
}


function testDataSecretIsReferenced(bundle, bindingKey) {
  return (bundle?.executionPlan?.plan?.scenarios || []).some((scenario) => (
    (scenario?.spec?.testData?.bindings || []).some((binding) => binding?.source === 'SECRET' && String(binding?.bindingKey || '').trim() === bindingKey)
  ));
}

export async function postInternalRunnerTestDataMaterial(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    getClaim = getRunExecutionClaim,
    resolveSecret = resolveProjectSecretValue,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req, 12_288);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerTestDataMaterialRequestInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);

  const nowIso = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const claim = await getClaim(env, bundle.run.organizationId, bundle.run.projectId, normalizedRunId);
  assertAuthMaterialLease(bundle, claim, input, nowIso);
  if (claim.leaseTokenHash !== leaseTokenHash) internalError('Lease token inválido para Test Data Material.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);

  const secretEntry = bundle?.runtimeSnapshot?.snapshot?.testData?.secrets?.[input.bindingKey] || null;
  if (!secretEntry?.secretId || secretEntry.configured !== true) internalError('Test Data SECRET não existe no Runtime Snapshot.', 'RUNNER_CONTROL_TEST_DATA_SECRET_NOT_IN_SNAPSHOT', 409);
  if (!testDataSecretIsReferenced(bundle, input.bindingKey)) internalError('Test Data SECRET não é referenciado pelo Execution Plan.', 'RUNNER_CONTROL_TEST_DATA_SECRET_NOT_REFERENCED', 409);

  const resolved = await resolveSecret(env, bundle.run.organizationId, bundle.run.projectId, secretEntry.secretId);
  if (!resolved?.metadata || resolved.metadata.kind !== 'generic') internalError('Secret de Test Data possui tipo incompatível.', 'RUNNER_CONTROL_TEST_DATA_SECRET_KIND_MISMATCH', 409);
  const value = resolved?.value?.value;
  if (value == null || typeof value === 'object') internalError('Secret de Test Data não contém valor escalar executável.', 'RUNNER_CONTROL_TEST_DATA_SECRET_INVALID', 409);

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_TEST_DATA_MATERIAL_CONTRACT_VERSION,
      runId: normalizedRunId,
      attemptId: input.attemptId,
      runtimePlanHash: input.runtimePlanHash,
      bindingKey: input.bindingKey,
      valueType: secretEntry.valueType || 'STRING',
      value,
    },
  };
}

export async function postInternalRunnerTestDataResolved(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markResolved = markRunTestDataResolved,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerTestDataResolvedInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  const resolvedAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markResolved(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    runtimePlanHash: input.runtimePlanHash,
    bindingCount: input.bindingCount,
    generatedCount: input.generatedCount,
    fixedCount: input.fixedCount,
    secretCount: input.secretCount,
    durationMs: input.durationMs,
    resolvedAt,
  });
  if (!result.updated) internalError('Lease não está ativa para registrar Test Data Runtime.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_TEST_DATA_RESOLVED_CONTRACT_VERSION,
      runId: normalizedRunId,
      attemptId: input.attemptId,
      runtimePlanHash: input.runtimePlanHash,
      testDataRuntimeStatus: 'COMPLETED',
      bindingCount: input.bindingCount,
      generatedCount: input.generatedCount,
      fixedCount: input.fixedCount,
      secretCount: input.secretCount,
      durationMs: input.durationMs,
      resolvedAt,
    },
  };
}

export async function postInternalRunnerAuthResolved(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markAuthResolved = markRunAuthResolved,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerAuthResolvedInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);

  const resolvedAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markAuthResolved(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    runtimePlanHash: input.runtimePlanHash,
    requiredScenarioCount: input.requiredScenarioCount,
    resolvedProfileCount: input.resolvedProfileCount,
    dynamicExchangeCount: input.dynamicExchangeCount,
    cacheHitCount: input.cacheHitCount,
    durationMs: input.durationMs,
    resolvedAt,
  });
  if (!result?.updated) {
    internalError('Auth Runtime summary não possui lease/runtime válidos.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  return {
    status: 'ok',
    data: {
      contractVersion: RUNNER_AUTH_RESOLVED_CONTRACT_VERSION,
      runId: normalizedRunId,
      attemptId: input.attemptId,
      authRuntimeStatus: 'COMPLETED',
      requiredScenarioCount: input.requiredScenarioCount,
      resolvedProfileCount: input.resolvedProfileCount,
      dynamicExchangeCount: input.dynamicExchangeCount,
      cacheHitCount: input.cacheHitCount,
      durationMs: input.durationMs,
      resolvedAt,
    },
  };
}

export async function postInternalRunnerHttpExecuted(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markHttpExecuted = markRunExecutionHttpExecuted,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerHttpExecutedInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  if (bundle.run.status === 'CANCELLED') {
    internalError('Run cancelado antes do HTTP execution summary.', 'RUNNER_CONTROL_RUN_CANCELLED', 409);
  }
  if (['PASSED', 'FAILED', 'ERROR'].includes(bundle.run.status)) {
    internalError('Run já está terminal.', 'RUNNER_CONTROL_RUN_TERMINAL', 409);
  }

  const executedAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markHttpExecuted(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    runtimePlanHash: input.runtimePlanHash,
    requestCount: input.requestCount,
    responseCount: input.responseCount,
    networkErrorCount: input.networkErrorCount,
    timeoutCount: input.timeoutCount,
    redirectCount: input.redirectCount,
    durationMs: input.durationMs,
    responseStatusCounts: input.responseStatusCounts,
    primaryDiagnostic: input.primaryDiagnostic,
    executedAt,
  });
  if (!result.updated) {
    internalError('Lease/runtime readiness inválidos para registrar HTTP execution.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  return {
    status: 'ok',
    data: {
      runId: normalizedRunId,
      attemptId: input.attemptId,
      httpExecutionStatus: 'COMPLETED',
      requestCount: input.requestCount,
      responseCount: input.responseCount,
      networkErrorCount: input.networkErrorCount,
      timeoutCount: input.timeoutCount,
      redirectCount: input.redirectCount,
      durationMs: input.durationMs,
      responseStatusCounts: input.responseStatusCounts,
      primaryDiagnostic: input.primaryDiagnostic,
      httpExecutedAt: executedAt,
    },
  };
}



export async function postInternalRunnerAssertionsEvaluated(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markAssertionsEvaluated = markRunAssertionsEvaluated,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerAssertionsEvaluatedInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  if (bundle.run.status === 'CANCELLED') {
    internalError('Run cancelado antes do assertion summary.', 'RUNNER_CONTROL_RUN_CANCELLED', 409);
  }
  if (['PASSED', 'FAILED', 'ERROR'].includes(bundle.run.status)) {
    if (
      bundle.latestAttempt?.attemptId === input.attemptId
      && bundle.latestAttempt?.assertionExecutionStatus === 'COMPLETED'
      && bundle.latestAttempt?.assertionOutcome === input.outcome
    ) {
      return {
        status: 'ok',
        data: {
          runId: normalizedRunId,
          attemptId: input.attemptId,
          assertionExecutionStatus: 'COMPLETED',
          outcome: input.outcome,
          assertionEvaluatedAt: bundle.latestAttempt.assertionEvaluatedAt || null,
          idempotentReplay: true,
        },
      };
    }
    internalError('Run já está terminal.', 'RUNNER_CONTROL_RUN_TERMINAL', 409);
  }

  const evaluatedAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markAssertionsEvaluated(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    runtimePlanHash: input.runtimePlanHash,
    outcome: input.outcome,
    scenarioCount: input.scenarioCount,
    scenarioPassedCount: input.scenarioPassedCount,
    scenarioFailedCount: input.scenarioFailedCount,
    scenarioNotEvaluatedCount: input.scenarioNotEvaluatedCount,
    assertionCount: input.assertionCount,
    assertionPassedCount: input.assertionPassedCount,
    assertionFailedCount: input.assertionFailedCount,
    assertionNotEvaluatedCount: input.assertionNotEvaluatedCount,
    durationMs: input.durationMs,
    primaryDiagnostic: input.primaryDiagnostic,
    evaluatedAt,
  });
  if (!result.updated) {
    internalError('Lease/runtime/http inválidos para registrar assertion summary.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }

  return {
    status: 'ok',
    data: {
      runId: normalizedRunId,
      attemptId: input.attemptId,
      assertionExecutionStatus: 'COMPLETED',
      outcome: input.outcome,
      scenarioCount: input.scenarioCount,
      scenarioPassedCount: input.scenarioPassedCount,
      scenarioFailedCount: input.scenarioFailedCount,
      scenarioNotEvaluatedCount: input.scenarioNotEvaluatedCount,
      assertionCount: input.assertionCount,
      assertionPassedCount: input.assertionPassedCount,
      assertionFailedCount: input.assertionFailedCount,
      assertionNotEvaluatedCount: input.assertionNotEvaluatedCount,
      durationMs: input.durationMs,
      primaryDiagnostic: input.primaryDiagnostic,
      assertionEvaluatedAt: evaluatedAt,
      idempotentReplay: false,
    },
  };
}

export async function postInternalRunnerRejected(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markRejected = markRunExecutionRejected,
    refreshSuiteRun = refreshSuiteRunByChildRunId,
    now = () => new Date().toISOString(),
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerRejectedInput(body);
  const bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);

  const rejectedAt = now();
  const leaseTokenHash = await sha256Hex(input.leaseToken);
  const result = await markRejected(env, {
    organizationId: bundle.run.organizationId,
    projectId: bundle.run.projectId,
    runId: normalizedRunId,
    attemptId: input.attemptId,
    leaseTokenHash,
    errorCode: input.errorCode,
    rejectedAt,
  });
  if (!result.updated) {
    internalError('Lease não está ativa para registrar rejection.', 'RUNNER_CONTROL_LEASE_NOT_ACTIVE', 409);
  }
  try { await refreshSuiteRun(env, normalizedRunId); } catch {}
  return {
    status: 'ok',
    data: {
      runId: normalizedRunId,
      attemptId: input.attemptId,
      status: 'REJECTED',
      errorCode: input.errorCode,
      phase: input.phase,
      rejectedAt,
    },
  };
}

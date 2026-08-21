import {
  RUNNER_RECEIVED_CONTRACT_VERSION,
  RUNNER_RUN_BUNDLE_CONTRACT_VERSION,
  normalizeRunnerReceivedInput,
} from '../lib/runContracts.js';
import {
  getRunBundleByRunId,
  markRunRunnerReceived,
} from '../repositories/runRepository.js';
import { verifyRunnerControlRequest } from '../security/runnerControlAuth.js';

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

export async function postInternalRunnerReceived(
  req,
  env,
  { runId },
  {
    verifyRequest = verifyRunnerControlRequest,
    getBundle = getRunBundleByRunId,
    markReceived = markRunRunnerReceived,
  } = {},
) {
  const normalizedRunId = normalizeRunId(runId);
  const { rawBody, body } = await readRawJson(req);
  await verifyRequest(req, env, { rawBody });
  const input = normalizeRunnerReceivedInput(body);

  let bundle = await getBundle(env, normalizedRunId);
  assertBundle(bundle, normalizedRunId);
  if (
    bundle.run.executionPlanId !== input.executionPlanId
    || bundle.run.runtimeSnapshotId !== input.runtimeSnapshotId
  ) {
    internalError('Confirmação do Runner referencia artefatos divergentes.', 'RUNNER_CONTROL_REFERENCE_MISMATCH', 409);
  }

  bundle = await markReceived(
    env,
    bundle.run.organizationId,
    bundle.run.projectId,
    normalizedRunId,
  );
  assertBundle(bundle, normalizedRunId);

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

import { buildRunRequestedMessage } from '../lib/runContracts.js';
import {
  ensureRunQueueDispatch,
  getRunBundle,
  markRunDispatchAttempt,
  markRunDispatchFailed,
  markRunQueued,
} from '../repositories/runRepository.js';

function dispatchError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.retryable = true;
  if (cause) error.cause = cause;
  throw error;
}

function logger(env) {
  if (typeof env?.log === 'function') return env.log;
  return (...args) => { try { console.log(...args); } catch {} };
}

export async function dispatchRunToQueueV1({
  env,
  bundle,
  deps = {},
} = {}) {
  const log = logger(env);
  const run = bundle?.run;
  if (!run) dispatchError('Run ausente para publicação na fila.', 'RUN_QUEUE_RUN_MISSING');

  const ensureDispatch = deps.ensureRunQueueDispatch || ensureRunQueueDispatch;
  const incrementAttempt = deps.markRunDispatchAttempt || markRunDispatchAttempt;
  const markFailed = deps.markRunDispatchFailed || markRunDispatchFailed;
  const markQueued = deps.markRunQueued || markRunQueued;
  const loadBundle = deps.getRunBundle || getRunBundle;
  const queue = deps.queue || env?.RUN_QUEUE;

  let dispatch = bundle.dispatch || await ensureDispatch(env, bundle);
  if (!dispatch) dispatchError('Estado de dispatch do Run não pôde ser criado.', 'RUN_QUEUE_DISPATCH_STATE_MISSING');

  if (dispatch.status === 'PUBLISHED' || dispatch.status === 'RECEIVED') {
    return loadBundle(env, run.organizationId, run.projectId, run.runId);
  }

  if (!queue || typeof queue.send !== 'function') {
    dispatchError('Run Queue não configurada no Gateway.', 'RUN_QUEUE_NOT_CONFIGURED');
  }

  dispatch = await incrementAttempt(env, run.organizationId, run.projectId, run.runId);
  const message = buildRunRequestedMessage(run);

  try {
    await queue.send(message);
  } catch (error) {
    await markFailed(env, run.organizationId, run.projectId, run.runId, 'RUN_QUEUE_DISPATCH_FAILED');
    log('run_queue_dispatch_failed', {
      runId: run.runId,
      projectId: run.projectId,
      executionPlanId: run.executionPlanId,
      attempt: dispatch?.dispatchAttemptCount || null,
    });
    dispatchError('Falha ao publicar Run na fila de execução.', 'RUN_QUEUE_DISPATCH_FAILED', error);
  }

  const queuedBundle = await markQueued(env, run.organizationId, run.projectId, run.runId);
  log('run_queue_published', {
    runId: run.runId,
    projectId: run.projectId,
    executionPlanId: run.executionPlanId,
    runtimeSnapshotId: run.runtimeSnapshotId,
    attempt: dispatch?.dispatchAttemptCount || null,
  });
  return queuedBundle;
}

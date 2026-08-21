export const RUN_CREATE_CONTRACT_VERSION = 'qagent.run-create.v1';
export const RUN_CONTRACT_VERSION = 'qagent.run.v1';
export const RUNTIME_SNAPSHOT_CONTRACT_VERSION = 'qagent.runtime-snapshot.v1';
export const EXECUTION_PLAN_CONTRACT_VERSION = 'qagent.execution-plan.v1';
export const RUN_REQUESTED_CONTRACT_VERSION = 'qagent.run-requested.v1';
export const RUNNER_RUN_BUNDLE_CONTRACT_VERSION = 'qagent.runner-run-bundle.v1';
export const RUNNER_RECEIVED_CONTRACT_VERSION = 'qagent.runner-received.v1';
export const RUNNER_RECEIVED_V2_CONTRACT_VERSION = 'qagent.runner-received.v2';
export const RUNNER_CLAIM_CONTRACT_VERSION = 'qagent.runner-claim.v1';
export const RUNNER_CLAIM_RESULT_CONTRACT_VERSION = 'qagent.runner-claim-result.v1';
export const RUNNER_HEARTBEAT_CONTRACT_VERSION = 'qagent.runner-heartbeat.v1';
export const RUNNER_RETRY_CONTRACT_VERSION = 'qagent.runner-retry.v1';
export const RUNNER_RUNTIME_READY_CONTRACT_VERSION = 'qagent.runner-runtime-ready.v1';
export const RUNNER_REJECTED_CONTRACT_VERSION = 'qagent.runner-rejected.v1';

export const RUN_STATUSES = Object.freeze([
  'CREATED', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED',
]);

export const RUNTIME_RESOLUTION_SOURCES = Object.freeze([
  'EXPLICIT_CONFIG',
  'DISCOVERED_OBSERVATION',
]);

export const RUNTIME_RESOLUTION_CONFIDENCE = Object.freeze([
  'CONFIRMED', 'HIGH', 'MEDIUM', 'LOW',
]);

function fail(message, code, status = 400, publicDetails = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

function cleanId(value, { field, prefix, max = 180, code = 'RUN_CREATE_CONTRACT_INVALID', status = 400 }) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > max || !new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(normalized)) {
    fail(`${field} inválido.`, code, status, { field });
  }
  return normalized;
}

function normalizeScenarioIds(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    fail('scenarioIds deve ser um array.', 'RUN_CREATE_CONTRACT_INVALID', 400, { field: 'scenarioIds' });
  }
  if (value.length > 50) {
    fail('scenarioIds excede o limite permitido.', 'RUN_CREATE_CONTRACT_INVALID', 400, { field: 'scenarioIds' });
  }
  const ids = value.map((item) => String(item ?? '').trim());
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      fail('scenarioIds contém um identificador inválido.', 'RUN_CREATE_CONTRACT_INVALID', 400, { field: 'scenarioIds' });
    }
  }
  return [...new Set(ids)].sort();
}

export function normalizeRunCreateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de Run inválido.', 'RUN_CREATE_CONTRACT_INVALID');
  }

  const allowed = new Set(['contractVersion', 'testDesignVersionId', 'environmentId', 'scenarioIds']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      fail(`Campo não permitido no Run: ${key}.`, 'RUN_CREATE_CONTRACT_INVALID', 400, { field: key });
    }
  }

  if (input.contractVersion !== RUN_CREATE_CONTRACT_VERSION) {
    fail(
      `contractVersion deve ser '${RUN_CREATE_CONTRACT_VERSION}'.`,
      'RUN_CREATE_CONTRACT_INVALID',
      400,
      { field: 'contractVersion' },
    );
  }

  return {
    contractVersion: RUN_CREATE_CONTRACT_VERSION,
    testDesignVersionId: cleanId(input.testDesignVersionId, {
      field: 'testDesignVersionId', prefix: 'tdv_', max: 200,
    }),
    environmentId: cleanId(input.environmentId, {
      field: 'environmentId', prefix: 'env_', max: 200,
    }),
    scenarioIds: normalizeScenarioIds(input.scenarioIds),
  };
}

export function normalizeIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (key.length < 8 || key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    fail(
      'Idempotency-Key é obrigatório e deve possuir entre 8 e 160 caracteres seguros.',
      'RUN_IDEMPOTENCY_KEY_INVALID',
      400,
    );
  }
  return key;
}

export function canonicalizeJson(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonicalizeJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintRunCreateInput(input) {
  return sha256Hex({
    contractVersion: RUN_CREATE_CONTRACT_VERSION,
    testDesignVersionId: input.testDesignVersionId,
    environmentId: input.environmentId,
    scenarioIds: input.scenarioIds,
  });
}

export function buildRunRequestedMessage(runOrRunId) {
  const source = typeof runOrRunId === 'string' ? { runId: runOrRunId } : (runOrRunId || {});
  const runId = cleanId(source.runId, {
    field: 'runId', prefix: 'run_', max: 220, code: 'RUN_REQUEST_MESSAGE_INVALID', status: 500,
  });
  const executionPlanId = source.executionPlanId == null ? null : cleanId(source.executionPlanId, {
    field: 'executionPlanId', prefix: 'xplan_', max: 220, code: 'RUN_REQUEST_MESSAGE_INVALID', status: 500,
  });
  const runtimeSnapshotId = source.runtimeSnapshotId == null ? null : cleanId(source.runtimeSnapshotId, {
    field: 'runtimeSnapshotId', prefix: 'rts_', max: 220, code: 'RUN_REQUEST_MESSAGE_INVALID', status: 500,
  });

  // Backward-compatible helper shape for legacy unit tests that only pass runId.
  if (!executionPlanId || !runtimeSnapshotId) {
    return { contractVersion: RUN_REQUESTED_CONTRACT_VERSION, runId };
  }

  return {
    contractVersion: RUN_REQUESTED_CONTRACT_VERSION,
    runId,
    executionPlanId,
    runtimeSnapshotId,
  };
}

export function normalizeRunnerReceivedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de confirmação do Runner inválido.', 'RUNNER_RECEIVED_CONTRACT_INVALID', 400);
  }
  const allowed = new Set(['contractVersion', 'executionPlanId', 'runtimeSnapshotId']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      fail(`Campo não permitido na confirmação do Runner: ${key}.`, 'RUNNER_RECEIVED_CONTRACT_INVALID', 400, { field: key });
    }
  }
  if (input.contractVersion !== RUNNER_RECEIVED_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_RECEIVED_CONTRACT_VERSION}'.`, 'RUNNER_RECEIVED_CONTRACT_INVALID', 400);
  }
  return {
    contractVersion: RUNNER_RECEIVED_CONTRACT_VERSION,
    executionPlanId: cleanId(input.executionPlanId, {
      field: 'executionPlanId', prefix: 'xplan_', max: 220, code: 'RUNNER_RECEIVED_CONTRACT_INVALID', status: 400,
    }),
    runtimeSnapshotId: cleanId(input.runtimeSnapshotId, {
      field: 'runtimeSnapshotId', prefix: 'rts_', max: 220, code: 'RUNNER_RECEIVED_CONTRACT_INVALID', status: 400,
    }),
  };
}


function normalizeLeaseOwnerId(value, code = 'RUNNER_CLAIM_CONTRACT_INVALID') {
  const normalized = String(value ?? '').trim();
  if (!/^rlo_[A-Za-z0-9_-]{8,220}$/.test(normalized)) {
    fail('leaseOwnerId inválido.', code, 400, { field: 'leaseOwnerId' });
  }
  return normalized;
}

function normalizeAttemptId(value, code = 'RUNNER_LEASE_CONTRACT_INVALID') {
  return cleanId(value, {
    field: 'attemptId', prefix: 'runatt_', max: 220, code, status: 400,
  });
}

function normalizeLeaseToken(value, code = 'RUNNER_LEASE_CONTRACT_INVALID') {
  const token = String(value ?? '').trim();
  if (token.length < 32 || token.length > 180 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    fail('leaseToken inválido.', code, 400, { field: 'leaseToken' });
  }
  return token;
}

function normalizeExecutionReferences(input, code) {
  return {
    executionPlanId: cleanId(input.executionPlanId, {
      field: 'executionPlanId', prefix: 'xplan_', max: 220, code, status: 400,
    }),
    runtimeSnapshotId: cleanId(input.runtimeSnapshotId, {
      field: 'runtimeSnapshotId', prefix: 'rts_', max: 220, code, status: 400,
    }),
  };
}

export function normalizeRunnerClaimInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de claim do Runner inválido.', 'RUNNER_CLAIM_CONTRACT_INVALID', 400);
  }
  const allowed = new Set([
    'contractVersion', 'executionPlanId', 'runtimeSnapshotId', 'leaseOwnerId',
    'queueMessageId', 'queueDeliveryAttempt',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no claim: ${key}.`, 'RUNNER_CLAIM_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_CLAIM_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_CLAIM_CONTRACT_VERSION}'.`, 'RUNNER_CLAIM_CONTRACT_INVALID', 400);
  }
  const refs = normalizeExecutionReferences(input, 'RUNNER_CLAIM_CONTRACT_INVALID');
  const queueMessageId = input.queueMessageId == null ? null : String(input.queueMessageId).trim();
  if (queueMessageId != null && (!queueMessageId || queueMessageId.length > 220 || !/^[A-Za-z0-9._:-]+$/.test(queueMessageId))) {
    fail('queueMessageId inválido.', 'RUNNER_CLAIM_CONTRACT_INVALID', 400, { field: 'queueMessageId' });
  }
  const queueDeliveryAttempt = input.queueDeliveryAttempt == null ? null : Number(input.queueDeliveryAttempt);
  if (queueDeliveryAttempt != null && (!Number.isInteger(queueDeliveryAttempt) || queueDeliveryAttempt < 1 || queueDeliveryAttempt > 10_000)) {
    fail('queueDeliveryAttempt inválido.', 'RUNNER_CLAIM_CONTRACT_INVALID', 400, { field: 'queueDeliveryAttempt' });
  }
  return {
    contractVersion: RUNNER_CLAIM_CONTRACT_VERSION,
    ...refs,
    leaseOwnerId: normalizeLeaseOwnerId(input.leaseOwnerId),
    queueMessageId,
    queueDeliveryAttempt,
  };
}

export function normalizeRunnerHeartbeatInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de heartbeat inválido.', 'RUNNER_HEARTBEAT_CONTRACT_INVALID', 400);
  }
  const allowed = new Set(['contractVersion', 'attemptId', 'leaseToken']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no heartbeat: ${key}.`, 'RUNNER_HEARTBEAT_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_HEARTBEAT_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_HEARTBEAT_CONTRACT_VERSION}'.`, 'RUNNER_HEARTBEAT_CONTRACT_INVALID', 400);
  }
  return {
    contractVersion: RUNNER_HEARTBEAT_CONTRACT_VERSION,
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_HEARTBEAT_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_HEARTBEAT_CONTRACT_INVALID'),
  };
}

export function normalizeRunnerRetryInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de retry inválido.', 'RUNNER_RETRY_CONTRACT_INVALID', 400);
  }
  const allowed = new Set(['contractVersion', 'attemptId', 'leaseToken', 'errorCode', 'retryAfterSeconds']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no retry: ${key}.`, 'RUNNER_RETRY_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_RETRY_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_RETRY_CONTRACT_VERSION}'.`, 'RUNNER_RETRY_CONTRACT_INVALID', 400);
  }
  const errorCode = String(input.errorCode ?? 'RUNNER_TRANSIENT_ERROR').trim();
  if (!/^[A-Z0-9_]{3,120}$/.test(errorCode)) {
    fail('errorCode inválido.', 'RUNNER_RETRY_CONTRACT_INVALID', 400, { field: 'errorCode' });
  }
  const retryAfterSeconds = Number(input.retryAfterSeconds);
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86_400) {
    fail('retryAfterSeconds inválido.', 'RUNNER_RETRY_CONTRACT_INVALID', 400, { field: 'retryAfterSeconds' });
  }
  return {
    contractVersion: RUNNER_RETRY_CONTRACT_VERSION,
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_RETRY_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_RETRY_CONTRACT_INVALID'),
    errorCode,
    retryAfterSeconds,
  };
}

export function normalizeRunnerReceivedV2Input(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de confirmação do Runner inválido.', 'RUNNER_RECEIVED_CONTRACT_INVALID', 400);
  }
  const allowed = new Set(['contractVersion', 'executionPlanId', 'runtimeSnapshotId', 'attemptId', 'leaseToken']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido na confirmação do Runner: ${key}.`, 'RUNNER_RECEIVED_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_RECEIVED_V2_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_RECEIVED_V2_CONTRACT_VERSION}'.`, 'RUNNER_RECEIVED_CONTRACT_INVALID', 400);
  }
  return {
    contractVersion: RUNNER_RECEIVED_V2_CONTRACT_VERSION,
    ...normalizeExecutionReferences(input, 'RUNNER_RECEIVED_CONTRACT_INVALID'),
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_RECEIVED_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_RECEIVED_CONTRACT_INVALID'),
  };
}


export function normalizeRunnerRuntimeReadyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de runtime readiness inválido.', 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400);
  }
  const allowed = new Set([
    'contractVersion', 'attemptId', 'leaseToken', 'runtimePlanHash', 'targetCount',
    'resolutionSource', 'resolutionConfidence',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no runtime readiness: ${key}.`, 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_RUNTIME_READY_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_RUNTIME_READY_CONTRACT_VERSION}'.`, 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400);
  }
  const runtimePlanHash = String(input.runtimePlanHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(runtimePlanHash)) {
    fail('runtimePlanHash inválido.', 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400, { field: 'runtimePlanHash' });
  }
  const targetCount = Number(input.targetCount);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 50) {
    fail('targetCount inválido.', 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400, { field: 'targetCount' });
  }
  const resolutionSource = String(input.resolutionSource || '').trim();
  if (!RUNTIME_RESOLUTION_SOURCES.includes(resolutionSource)) {
    fail('resolutionSource inválido.', 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400, { field: 'resolutionSource' });
  }
  const resolutionConfidence = String(input.resolutionConfidence || '').trim();
  if (!RUNTIME_RESOLUTION_CONFIDENCE.includes(resolutionConfidence)) {
    fail('resolutionConfidence inválido.', 'RUNNER_RUNTIME_READY_CONTRACT_INVALID', 400, { field: 'resolutionConfidence' });
  }
  return {
    contractVersion: RUNNER_RUNTIME_READY_CONTRACT_VERSION,
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_RUNTIME_READY_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_RUNTIME_READY_CONTRACT_INVALID'),
    runtimePlanHash,
    targetCount,
    resolutionSource,
    resolutionConfidence,
  };
}


export function normalizeRunnerRejectedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de rejection inválido.', 'RUNNER_REJECTED_CONTRACT_INVALID', 400);
  }
  const allowed = new Set(['contractVersion', 'attemptId', 'leaseToken', 'errorCode', 'phase']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no rejection: ${key}.`, 'RUNNER_REJECTED_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_REJECTED_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_REJECTED_CONTRACT_VERSION}'.`, 'RUNNER_REJECTED_CONTRACT_INVALID', 400);
  }
  const errorCode = String(input.errorCode || '').trim();
  if (!/^[A-Z0-9_]{3,120}$/.test(errorCode)) {
    fail('errorCode inválido.', 'RUNNER_REJECTED_CONTRACT_INVALID', 400, { field: 'errorCode' });
  }
  const phase = String(input.phase || 'RUNTIME').trim().toUpperCase();
  if (!['INTAKE', 'RUNTIME'].includes(phase)) {
    fail('phase inválida.', 'RUNNER_REJECTED_CONTRACT_INVALID', 400, { field: 'phase' });
  }
  return {
    contractVersion: RUNNER_REJECTED_CONTRACT_VERSION,
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_REJECTED_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_REJECTED_CONTRACT_INVALID'),
    errorCode,
    phase,
  };
}

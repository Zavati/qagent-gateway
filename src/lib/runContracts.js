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
export const RUNNER_HTTP_EXECUTED_CONTRACT_VERSION = 'qagent.runner-http-executed.v1';
export const RUNNER_ASSERTIONS_EVALUATED_CONTRACT_VERSION = 'qagent.runner-assertions-evaluated.v1';

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

  const allowed = new Set(['contractVersion', 'testDesignVersionId', 'environmentId', 'scenarioIds', 'confirmDiscoveredRuntime']);
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
    confirmDiscoveredRuntime: input.confirmDiscoveredRuntime === true,
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
    confirmDiscoveredRuntime: input.confirmDiscoveredRuntime === true,
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



export function normalizeRunnerHttpExecutedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de HTTP execution inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400);
  }
  const allowed = new Set([
    'contractVersion', 'attemptId', 'leaseToken', 'runtimePlanHash',
    'requestCount', 'responseCount', 'networkErrorCount', 'timeoutCount', 'redirectCount', 'durationMs',
    'responseStatusCounts', 'primaryDiagnostic',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no HTTP execution summary: ${key}.`, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_HTTP_EXECUTED_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_HTTP_EXECUTED_CONTRACT_VERSION}'.`, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400);
  }
  const runtimePlanHash = String(input.runtimePlanHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(runtimePlanHash)) {
    fail('runtimePlanHash inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'runtimePlanHash' });
  }
  const normalizeCount = (value, field, max = 10000) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      fail(`${field} inválido.`, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field });
    }
    return parsed;
  };
  const durationMs = Number(input.durationMs);
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 3_600_000) {
    fail('durationMs inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'durationMs' });
  }
  const requestCount = normalizeCount(input.requestCount, 'requestCount', 50);
  const responseCount = normalizeCount(input.responseCount, 'responseCount', 50);
  const networkErrorCount = normalizeCount(input.networkErrorCount, 'networkErrorCount', 50);
  const timeoutCount = normalizeCount(input.timeoutCount, 'timeoutCount', 50);
  const redirectCount = normalizeCount(input.redirectCount, 'redirectCount', 150);
  if (responseCount + networkErrorCount + timeoutCount > requestCount) {
    fail('HTTP execution counts inconsistentes.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400);
  }

  const statusCountsInput = input.responseStatusCounts == null ? {} : input.responseStatusCounts;
  if (!statusCountsInput || typeof statusCountsInput !== 'object' || Array.isArray(statusCountsInput)) {
    fail('responseStatusCounts inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'responseStatusCounts' });
  }
  const statusCountKeys = ['response2xxCount', 'response3xxCount', 'response4xxCount', 'response5xxCount'];
  for (const key of Object.keys(statusCountsInput)) {
    if (!statusCountKeys.includes(key)) fail(`Campo não permitido em responseStatusCounts: ${key}.`, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: `responseStatusCounts.${key}` });
  }
  const responseStatusCounts = {};
  for (const key of statusCountKeys) responseStatusCounts[key] = normalizeCount(statusCountsInput[key] ?? 0, `responseStatusCounts.${key}`, 50);
  const classifiedResponseCount = Object.values(responseStatusCounts).reduce((sum, value) => sum + value, 0);
  if (classifiedResponseCount > responseCount) {
    fail('responseStatusCounts excede responseCount.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'responseStatusCounts' });
  }

  let primaryDiagnostic = null;
  if (input.primaryDiagnostic != null) {
    const diagnostic = input.primaryDiagnostic;
    if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
      fail('primaryDiagnostic inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic' });
    }
    const diagnosticAllowed = new Set(['kind', 'scenarioId', 'statusCode', 'errorCode', 'errorCategory', 'errorName', 'causeCode']);
    for (const key of Object.keys(diagnostic)) {
      if (!diagnosticAllowed.has(key)) fail(`Campo não permitido em primaryDiagnostic: ${key}.`, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: `primaryDiagnostic.${key}` });
    }
    const kind = String(diagnostic.kind || '').trim().toUpperCase();
    if (!['NETWORK_ERROR', 'TIMEOUT', 'HTTP_RESPONSE'].includes(kind)) {
      fail('primaryDiagnostic.kind inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.kind' });
    }
    const scenarioId = diagnostic.scenarioId == null ? null : String(diagnostic.scenarioId).trim();
    if (scenarioId != null && !/^[A-Za-z0-9_-]{1,80}$/.test(scenarioId)) {
      fail('primaryDiagnostic.scenarioId inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.scenarioId' });
    }
    const statusCode = diagnostic.statusCode == null ? null : Number(diagnostic.statusCode);
    if (statusCode != null && (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)) {
      fail('primaryDiagnostic.statusCode inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.statusCode' });
    }
    if (kind === 'HTTP_RESPONSE' && statusCode == null) {
      fail('primaryDiagnostic.statusCode é obrigatório para HTTP_RESPONSE.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.statusCode' });
    }
    const errorCode = diagnostic.errorCode == null ? null : String(diagnostic.errorCode).trim().toUpperCase();
    if (errorCode != null && !/^[A-Z0-9_:-]{3,120}$/.test(errorCode)) {
      fail('primaryDiagnostic.errorCode inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.errorCode' });
    }
    const errorCategory = diagnostic.errorCategory == null ? null : String(diagnostic.errorCategory).trim().toUpperCase();
    if (errorCategory != null && !['DNS', 'CONNECT', 'TLS', 'RESET', 'ABORT', 'FETCH', 'UNKNOWN', 'TIMEOUT'].includes(errorCategory)) {
      fail('primaryDiagnostic.errorCategory inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.errorCategory' });
    }
    const errorName = diagnostic.errorName == null ? null : String(diagnostic.errorName).trim();
    if (errorName != null && !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(errorName)) {
      fail('primaryDiagnostic.errorName inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.errorName' });
    }
    const causeCode = diagnostic.causeCode == null ? null : String(diagnostic.causeCode).trim().toUpperCase();
    if (causeCode != null && !/^[A-Z][A-Z0-9_:-]{1,63}$/.test(causeCode)) {
      fail('primaryDiagnostic.causeCode inválido.', 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.causeCode' });
    }
    primaryDiagnostic = { kind, scenarioId, statusCode, errorCode, errorCategory, errorName, causeCode };
  }

  return {
    contractVersion: RUNNER_HTTP_EXECUTED_CONTRACT_VERSION,
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_HTTP_EXECUTED_CONTRACT_INVALID'),
    runtimePlanHash,
    requestCount,
    responseCount,
    networkErrorCount,
    timeoutCount,
    redirectCount,
    durationMs,
    responseStatusCounts,
    primaryDiagnostic,
  };
}


export function normalizeRunnerAssertionsEvaluatedInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('Payload de assertion evaluation inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  const allowed = new Set([
    'contractVersion', 'attemptId', 'leaseToken', 'runtimePlanHash', 'outcome',
    'scenarioCount', 'scenarioPassedCount', 'scenarioFailedCount', 'scenarioNotEvaluatedCount',
    'assertionCount', 'assertionPassedCount', 'assertionFailedCount', 'assertionNotEvaluatedCount',
    'durationMs', 'primaryDiagnostic',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail(`Campo não permitido no assertion summary: ${key}.`, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: key });
  }
  if (input.contractVersion !== RUNNER_ASSERTIONS_EVALUATED_CONTRACT_VERSION) {
    fail(`contractVersion deve ser '${RUNNER_ASSERTIONS_EVALUATED_CONTRACT_VERSION}'.`, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  const runtimePlanHash = String(input.runtimePlanHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(runtimePlanHash)) {
    fail('runtimePlanHash inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'runtimePlanHash' });
  }
  const outcome = String(input.outcome || '').trim().toUpperCase();
  if (!['PASSED', 'FAILED', 'ERROR'].includes(outcome)) {
    fail('outcome inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'outcome' });
  }
  const normalizeCount = (value, field, max = 10000) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      fail(`${field} inválido.`, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field });
    }
    return parsed;
  };
  const scenarioCount = normalizeCount(input.scenarioCount, 'scenarioCount', 50);
  const scenarioPassedCount = normalizeCount(input.scenarioPassedCount, 'scenarioPassedCount', 50);
  const scenarioFailedCount = normalizeCount(input.scenarioFailedCount, 'scenarioFailedCount', 50);
  const scenarioNotEvaluatedCount = normalizeCount(input.scenarioNotEvaluatedCount, 'scenarioNotEvaluatedCount', 50);
  if (scenarioPassedCount + scenarioFailedCount + scenarioNotEvaluatedCount !== scenarioCount) {
    fail('Scenario assertion counts inconsistentes.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  const assertionCount = normalizeCount(input.assertionCount, 'assertionCount', 1500);
  const assertionPassedCount = normalizeCount(input.assertionPassedCount, 'assertionPassedCount', 1500);
  const assertionFailedCount = normalizeCount(input.assertionFailedCount, 'assertionFailedCount', 1500);
  const assertionNotEvaluatedCount = normalizeCount(input.assertionNotEvaluatedCount, 'assertionNotEvaluatedCount', 1500);
  if (assertionPassedCount + assertionFailedCount + assertionNotEvaluatedCount !== assertionCount) {
    fail('Assertion counts inconsistentes.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  if (outcome === 'PASSED' && (scenarioFailedCount > 0 || scenarioNotEvaluatedCount > 0 || assertionFailedCount > 0 || assertionNotEvaluatedCount > 0)) {
    fail('PASSED contém failures/not evaluated.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  if (outcome === 'FAILED' && scenarioFailedCount === 0 && assertionFailedCount === 0) {
    fail('FAILED sem assertion failure.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  if (outcome === 'ERROR' && scenarioNotEvaluatedCount === 0 && assertionNotEvaluatedCount === 0) {
    fail('ERROR sem assertion não avaliada.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400);
  }
  const durationMs = Number(input.durationMs);
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 3_600_000) {
    fail('durationMs inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'durationMs' });
  }

  let primaryDiagnostic = null;
  if (input.primaryDiagnostic != null) {
    const diagnostic = input.primaryDiagnostic;
    if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
      fail('primaryDiagnostic inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic' });
    }
    const diagnosticAllowed = new Set([
      'kind', 'scenarioId', 'assertionIndex', 'assertionType', 'errorCode', 'path', 'headerName',
      'schemaRef', 'actualStatusCode', 'actualContentType',
    ]);
    for (const key of Object.keys(diagnostic)) {
      if (!diagnosticAllowed.has(key)) fail(`Campo não permitido em assertion primaryDiagnostic: ${key}.`, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: `primaryDiagnostic.${key}` });
    }
    const kind = String(diagnostic.kind || '').trim().toUpperCase();
    if (!['ASSERTION_FAILURE', 'ASSERTION_NOT_EVALUATED'].includes(kind)) {
      fail('primaryDiagnostic.kind inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.kind' });
    }
    const scenarioId = String(diagnostic.scenarioId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(scenarioId)) {
      fail('primaryDiagnostic.scenarioId inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.scenarioId' });
    }
    const assertionIndex = Number(diagnostic.assertionIndex);
    if (!Number.isInteger(assertionIndex) || assertionIndex < 0 || assertionIndex > 29) {
      fail('primaryDiagnostic.assertionIndex inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.assertionIndex' });
    }
    const assertionType = String(diagnostic.assertionType || '').trim().toUpperCase();
    if (!['STATUS', 'SCHEMA', 'JSON_PATH_EXISTS', 'JSON_PATH_EQUALS', 'HEADER_EXISTS', 'CONTENT_TYPE'].includes(assertionType)) {
      fail('primaryDiagnostic.assertionType inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.assertionType' });
    }
    const errorCode = String(diagnostic.errorCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9_:-]{3,120}$/.test(errorCode)) {
      fail('primaryDiagnostic.errorCode inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.errorCode' });
    }
    const safeText = (value, field, max) => {
      if (value == null) return null;
      const text = String(value).trim();
      if (!text || text.length > max || /[\r\n]/.test(text)) {
        fail(`${field} inválido.`, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field });
      }
      return text;
    };
    const path = safeText(diagnostic.path, 'primaryDiagnostic.path', 500);
    const headerName = safeText(diagnostic.headerName, 'primaryDiagnostic.headerName', 160);
    const schemaRef = safeText(diagnostic.schemaRef, 'primaryDiagnostic.schemaRef', 180);
    const actualStatusCode = diagnostic.actualStatusCode == null ? null : Number(diagnostic.actualStatusCode);
    if (actualStatusCode != null && (!Number.isInteger(actualStatusCode) || actualStatusCode < 100 || actualStatusCode > 599)) {
      fail('primaryDiagnostic.actualStatusCode inválido.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic.actualStatusCode' });
    }
    const actualContentType = safeText(diagnostic.actualContentType, 'primaryDiagnostic.actualContentType', 160);
    primaryDiagnostic = { kind, scenarioId, assertionIndex, assertionType, errorCode, path, headerName, schemaRef, actualStatusCode, actualContentType };
  }
  if (outcome !== 'PASSED' && !primaryDiagnostic) {
    fail('primaryDiagnostic obrigatório para FAILED/ERROR.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic' });
  }
  if (outcome === 'PASSED' && primaryDiagnostic) {
    fail('PASSED não pode conter primaryDiagnostic.', 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID', 400, { field: 'primaryDiagnostic' });
  }

  return {
    contractVersion: RUNNER_ASSERTIONS_EVALUATED_CONTRACT_VERSION,
    attemptId: normalizeAttemptId(input.attemptId, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID'),
    leaseToken: normalizeLeaseToken(input.leaseToken, 'RUNNER_ASSERTIONS_EVALUATED_CONTRACT_INVALID'),
    runtimePlanHash,
    outcome,
    scenarioCount,
    scenarioPassedCount,
    scenarioFailedCount,
    scenarioNotEvaluatedCount,
    assertionCount,
    assertionPassedCount,
    assertionFailedCount,
    assertionNotEvaluatedCount,
    durationMs,
    primaryDiagnostic,
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
  if (!['INTAKE', 'RUNTIME', 'HTTP', 'ASSERTION'].includes(phase)) {
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

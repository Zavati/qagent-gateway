export const RUN_CREATE_CONTRACT_VERSION = 'qagent.run-create.v1';
export const RUN_CONTRACT_VERSION = 'qagent.run.v1';
export const RUNTIME_SNAPSHOT_CONTRACT_VERSION = 'qagent.runtime-snapshot.v1';
export const EXECUTION_PLAN_CONTRACT_VERSION = 'qagent.execution-plan.v1';
export const RUN_REQUESTED_CONTRACT_VERSION = 'qagent.run-requested.v1';

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

function cleanId(value, { field, prefix, max = 180 }) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > max || !new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(normalized)) {
    fail(`${field} inválido.`, 'RUN_CREATE_CONTRACT_INVALID', 400, { field });
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

export function buildRunRequestedMessage(runId) {
  const normalized = String(runId ?? '').trim();
  if (!/^run_[A-Za-z0-9_-]{8,200}$/.test(normalized)) {
    fail('runId inválido para mensagem de execução.', 'RUN_REQUEST_MESSAGE_INVALID', 500);
  }
  return {
    contractVersion: RUN_REQUESTED_CONTRACT_VERSION,
    runId: normalized,
  };
}

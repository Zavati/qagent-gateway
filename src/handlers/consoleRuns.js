import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import {
  normalizeIdempotencyKey,
  normalizeRunCreateInput,
} from '../lib/runContracts.js';
import { RUN_BATCH_CREATE_CONTRACT_VERSION, normalizeRunBatchCreateInput } from '../lib/runBatchContracts.js';
import { createRunV1, getRunV1 } from '../services/runService.js';
import { createRunBatchV1 } from '../services/runBatchService.js';

async function readJson(req, maxBytes = 24_000) {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) {
    const error = new Error('Payload de Run é obrigatório.');
    error.status = 400;
    error.code = 'RUN_CREATE_BODY_REQUIRED';
    throw error;
  }
  if (buffer.byteLength > maxBytes) {
    const error = new Error('Payload de Run grande demais.');
    error.status = 413;
    error.code = 'RUN_CREATE_BODY_TOO_LARGE';
    throw error;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    const error = new Error('JSON inválido.');
    error.status = 400;
    error.code = 'RUN_CREATE_JSON_INVALID';
    throw error;
  }
}

function assertRunWriteAccess(tenant) {
  if (!['owner', 'admin', 'member'].includes(tenant.organizationRole)) {
    const error = new Error('Sem permissão para criar Runs nesta organização.');
    error.status = 403;
    error.code = 'RUN_CREATE_FORBIDDEN';
    throw error;
  }
}

function normalizeRunId(value) {
  const runId = String(value ?? '').trim();
  if (!/^run_[A-Za-z0-9_-]{8,200}$/.test(runId)) {
    const error = new Error('runId inválido.');
    error.status = 400;
    error.code = 'RUN_ID_INVALID';
    throw error;
  }
  return runId;
}

export async function postConsoleRun(
  req,
  env,
  { projectId },
  {
    requireTenant = requireConsoleTenant,
    getProject = getOrganizationProject,
    createRun = createRunV1,
    createRunBatch = createRunBatchV1,
  } = {},
) {
  const tenant = await requireTenant(req, env);
  assertRunWriteAccess(tenant);
  await getProject(env, tenant.organizationId, projectId);

  const body = await readJson(req);
  const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'));
  const common = {
    env,
    organizationId: tenant.organizationId,
    projectId,
    userId: tenant.user?.userId || null,
    idempotencyKey,
  };

  // 07.7.8-D FIX-1.1 - Keep /runs as the stable execution boundary.
  // A batch contract fans mutation scenarios out into isolated child Runs, while
  // the original qagent.run-create.v1 contract preserves the single-Run API.
  if (body?.contractVersion === RUN_BATCH_CREATE_CONTRACT_VERSION) {
    const input = normalizeRunBatchCreateInput(body);
    const result = await createRunBatch({ ...common, input });
    return { status: 'ok', data: result };
  }

  const input = normalizeRunCreateInput(body);
  const result = await createRun({ ...common, input });
  return { status: 'ok', data: result };
}

export async function getConsoleRun(
  req,
  env,
  { projectId, runId },
  {
    requireTenant = requireConsoleTenant,
    getProject = getOrganizationProject,
    getRun = getRunV1,
  } = {},
) {
  const tenant = await requireTenant(req, env);
  await getProject(env, tenant.organizationId, projectId);

  const result = await getRun({
    env,
    organizationId: tenant.organizationId,
    projectId,
    runId: normalizeRunId(runId),
  });

  return { status: 'ok', data: result };
}

import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { normalizeIdempotencyKey } from '../lib/runContracts.js';
import { normalizeRunBatchCreateInput } from '../lib/runBatchContracts.js';
import { createRunBatchV1 } from '../services/runBatchService.js';

async function readJson(req, maxBytes = 24_000) {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) { const error = new Error('Payload de Run Batch é obrigatório.'); error.status = 400; error.code = 'RUN_BATCH_CREATE_BODY_REQUIRED'; throw error; }
  if (buffer.byteLength > maxBytes) { const error = new Error('Payload de Run Batch grande demais.'); error.status = 413; error.code = 'RUN_BATCH_CREATE_BODY_TOO_LARGE'; throw error; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { const error = new Error('JSON inválido.'); error.status = 400; error.code = 'RUN_BATCH_CREATE_JSON_INVALID'; throw error; }
}

function assertWrite(tenant) {
  if (!['owner', 'admin', 'member'].includes(tenant.organizationRole)) {
    const error = new Error('Sem permissão para criar Runs nesta organização.'); error.status = 403; error.code = 'RUN_BATCH_CREATE_FORBIDDEN'; throw error;
  }
}

export async function postConsoleRunBatch(req, env, { projectId }, deps = {}) {
  const tenant = await (deps.requireTenant || requireConsoleTenant)(req, env);
  assertWrite(tenant);
  await (deps.getProject || getOrganizationProject)(env, tenant.organizationId, projectId);
  const input = normalizeRunBatchCreateInput(await readJson(req));
  const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'));
  const data = await (deps.createRunBatch || createRunBatchV1)({
    env,
    organizationId: tenant.organizationId,
    projectId,
    userId: tenant.user?.userId || null,
    input,
    idempotencyKey,
  });
  return { status: 'ok', data };
}

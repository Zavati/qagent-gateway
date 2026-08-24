import { requireConsoleTenant } from '../services/tenantContextService.js';
import {
  listProjectEndpointTestDataBindings,
  getProjectEndpointTestDataBinding,
  createProjectEndpointTestDataBinding,
  patchProjectEndpointTestDataBinding,
  archiveProjectEndpointTestDataBinding,
} from '../services/testDataBindingService.js';

async function readJson(req, maxBytes = 32_000) {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) return {};
  if (buffer.byteLength > maxBytes) {
    const error = new Error('Payload de Test Data grande demais.');
    error.status = 413;
    error.code = 'TEST_DATA_BODY_TOO_LARGE';
    throw error;
  }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch {
    const error = new Error('JSON inválido.');
    error.status = 400;
    error.code = 'TEST_DATA_JSON_INVALID';
    throw error;
  }
}

function assertWrite(tenant) {
  if (!['owner', 'admin', 'member'].includes(tenant.organizationRole)) {
    const error = new Error('Sem permissão de escrita nesta organização.');
    error.status = 403;
    error.code = 'ORGANIZATION_WRITE_FORBIDDEN';
    throw error;
  }
}


function assertSecretWrite(tenant) {
  if (!['owner', 'admin'].includes(tenant.organizationRole)) {
    const error = new Error('Somente owner/admin pode configurar Test Data SECRET.');
    error.status = 403;
    error.code = 'TEST_DATA_SECRET_WRITE_FORBIDDEN';
    throw error;
  }
}

function optionalEnvironmentId(req) {
  const value = new URL(req.url).searchParams.get('environmentId');
  return value ? String(value).trim() : null;
}

export async function listConsoleEndpointTestDataBindings(req, env, { projectId, endpointId }) {
  const tenant = await requireConsoleTenant(req, env);
  const bindings = await listProjectEndpointTestDataBindings(
    env,
    tenant.organizationId,
    projectId,
    endpointId,
    { environmentId: optionalEnvironmentId(req) },
  );
  return { status: 'ok', data: { projectId, endpointId, bindings } };
}

export async function createConsoleEndpointTestDataBinding(req, env, { projectId, endpointId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertWrite(tenant);
  const input = await readJson(req);
  if (String(input?.sourceType || '').toUpperCase() === 'SECRET') assertSecretWrite(tenant);
  const binding = await createProjectEndpointTestDataBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
    userId: tenant.user?.userId || null,
    input,
  });
  return { status: 'ok', data: { projectId, endpointId, binding } };
}

export async function getConsoleEndpointTestDataBinding(req, env, { projectId, endpointId, bindingId }) {
  const tenant = await requireConsoleTenant(req, env);
  const binding = await getProjectEndpointTestDataBinding(env, tenant.organizationId, projectId, endpointId, bindingId);
  return { status: 'ok', data: { projectId, endpointId, binding } };
}

export async function patchConsoleEndpointTestDataBinding(req, env, { projectId, endpointId, bindingId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertWrite(tenant);
  const input = await readJson(req);
  if (String(input?.sourceType || '').toUpperCase() === 'SECRET' || Object.prototype.hasOwnProperty.call(input || {}, 'secretValue')) assertSecretWrite(tenant);
  const binding = await patchProjectEndpointTestDataBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
    bindingId,
    userId: tenant.user?.userId || null,
    input,
  });
  return { status: 'ok', data: { projectId, endpointId, binding } };
}

export async function deleteConsoleEndpointTestDataBinding(req, env, { projectId, endpointId, bindingId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertWrite(tenant);
  const binding = await archiveProjectEndpointTestDataBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
    bindingId,
  });
  return { status: 'ok', data: { projectId, endpointId, binding, archived: true } };
}

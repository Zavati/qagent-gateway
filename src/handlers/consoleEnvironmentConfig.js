import { requireConsoleTenant } from '../services/tenantContextService.js';
import {
  archiveProjectApiService,
  createProjectApiService,
  getProjectApiService,
  listProjectApiServices,
  patchProjectApiService,
} from '../services/apiServiceService.js';
import {
  deleteProjectEnvironmentApiBinding,
  getProjectEnvironmentApiBinding,
  listProjectEnvironmentApiBindings,
  putProjectEnvironmentApiBinding,
} from '../services/environmentApiBindingService.js';
import {
  archiveProjectEnvironmentVariable,
  createProjectEnvironmentVariable,
  getProjectEnvironmentVariable,
  listProjectEnvironmentVariables,
  patchProjectEnvironmentVariable,
} from '../services/environmentVariableService.js';
import { resolveEnvironmentRuntimeConfig } from '../services/environmentRuntimeConfigService.js';
import { deserializeVariableValue } from '../lib/environmentConfig.js';

async function readJson(req, maxBytes = 20_000) {
  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) return {};
  if (buffer.byteLength > maxBytes) {
    const err = new Error('Payload grande demais.');
    err.status = 413;
    throw err;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    const err = new Error('JSON inválido.');
    err.status = 400;
    throw err;
  }
}

function assertTenantWriteAccess(tenant) {
  if (!['owner', 'admin', 'member'].includes(tenant.organizationRole)) {
    const err = new Error('Sem permissão de escrita nesta organização.');
    err.status = 403;
    err.code = 'ORGANIZATION_WRITE_FORBIDDEN';
    throw err;
  }
}

function publicVariable(variable) {
  if (!variable) return null;
  const { variableValue, ...rest } = variable;
  return { ...rest, value: deserializeVariableValue(variableValue, variable.valueType) };
}

export async function listConsoleApiServices(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  const apiServices = await listProjectApiServices(env, tenant.organizationId, projectId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, apiServices };
}

export async function createConsoleApiService(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const apiService = await createProjectApiService(env, {
    organizationId: tenant.organizationId,
    projectId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, apiService };
}

export async function getConsoleApiService(req, env, { projectId, apiServiceId }) {
  const tenant = await requireConsoleTenant(req, env);
  const apiService = await getProjectApiService(env, tenant.organizationId, projectId, apiServiceId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, apiService };
}

export async function patchConsoleApiService(req, env, { projectId, apiServiceId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const apiService = await patchProjectApiService(env, {
    organizationId: tenant.organizationId,
    projectId,
    apiServiceId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, apiService };
}

export async function deleteConsoleApiService(req, env, { projectId, apiServiceId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const apiService = await archiveProjectApiService(env, {
    organizationId: tenant.organizationId,
    projectId,
    apiServiceId,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, apiService, archived: true };
}

export async function listConsoleEnvironmentApiBindings(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  const bindings = await listProjectEnvironmentApiBindings(env, tenant.organizationId, projectId, environmentId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, bindings };
}

export async function getConsoleEnvironmentApiBinding(req, env, { projectId, environmentId, apiServiceId }) {
  const tenant = await requireConsoleTenant(req, env);
  const binding = await getProjectEnvironmentApiBinding(env, tenant.organizationId, projectId, environmentId, apiServiceId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, binding };
}

export async function putConsoleEnvironmentApiBinding(req, env, { projectId, environmentId, apiServiceId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const binding = await putProjectEnvironmentApiBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
    apiServiceId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, binding };
}

export async function deleteConsoleEnvironmentApiBinding(req, env, { projectId, environmentId, apiServiceId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const binding = await deleteProjectEnvironmentApiBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
    apiServiceId,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, binding, archived: true };
}

export async function listConsoleEnvironmentVariables(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  const variables = await listProjectEnvironmentVariables(env, tenant.organizationId, projectId, environmentId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, variables: variables.map(publicVariable) };
}

export async function createConsoleEnvironmentVariable(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const variable = await createProjectEnvironmentVariable(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, variable: publicVariable(variable) };
}

export async function getConsoleEnvironmentVariable(req, env, { projectId, environmentId, variableId }) {
  const tenant = await requireConsoleTenant(req, env);
  const variable = await getProjectEnvironmentVariable(env, tenant.organizationId, projectId, environmentId, variableId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, variable: publicVariable(variable) };
}

export async function patchConsoleEnvironmentVariable(req, env, { projectId, environmentId, variableId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const variable = await patchProjectEnvironmentVariable(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
    variableId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, variable: publicVariable(variable) };
}

export async function deleteConsoleEnvironmentVariable(req, env, { projectId, environmentId, variableId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const variable = await archiveProjectEnvironmentVariable(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
    variableId,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environmentId, variable: publicVariable(variable), archived: true };
}

export async function getConsoleEnvironmentRuntimeConfig(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  const runtimeConfig = await resolveEnvironmentRuntimeConfig(env, tenant.organizationId, projectId, environmentId);
  return { status: 'ok', runtimeConfig };
}

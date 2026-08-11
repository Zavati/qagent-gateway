import { requireConsoleTenant } from '../services/tenantContextService.js';
import {
  archiveProjectSecret,
  createProjectSecret,
  getProjectSecret,
  listProjectSecrets,
  renameProjectSecret,
  rotateProjectSecret,
} from '../services/secretVaultService.js';
import {
  archiveProjectAuthProfile,
  createProjectAuthProfile,
  getProjectAuthProfile,
  listProjectAuthProfiles,
  patchProjectAuthProfile,
} from '../services/authProfileService.js';
import {
  deleteProjectAuthProfileEnvironmentBinding,
  getProjectAuthProfileEnvironmentBinding,
  listProjectAuthProfileEnvironmentBindings,
  putProjectAuthProfileEnvironmentBinding,
} from '../services/authProfileBindingService.js';

async function readJson(req, maxBytes = 40_000) {
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

function assertSecretAdminAccess(tenant) {
  if (!['owner', 'admin'].includes(tenant.organizationRole)) {
    const err = new Error('Somente owner/admin pode gerenciar credenciais do Secret Vault.');
    err.status = 403;
    err.code = 'SECRET_VAULT_WRITE_FORBIDDEN';
    throw err;
  }
}

function assertSecretReadAccess(tenant) {
  if (!['owner', 'admin'].includes(tenant.organizationRole)) {
    const err = new Error('Somente owner/admin pode consultar metadados do Secret Vault.');
    err.status = 403;
    err.code = 'SECRET_VAULT_READ_FORBIDDEN';
    throw err;
  }
}

export async function listConsoleSecrets(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretReadAccess(tenant);
  const secrets = await listProjectSecrets(env, tenant.organizationId, projectId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, secrets };
}

export async function createConsoleSecret(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretAdminAccess(tenant);
  const input = await readJson(req);
  const secret = await createProjectSecret(env, {
    organizationId: tenant.organizationId,
    projectId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, secret };
}

export async function getConsoleSecret(req, env, { projectId, secretId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretReadAccess(tenant);
  const secret = await getProjectSecret(env, tenant.organizationId, projectId, secretId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, secret };
}

export async function patchConsoleSecret(req, env, { projectId, secretId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretAdminAccess(tenant);
  const input = await readJson(req);
  const secret = await renameProjectSecret(env, { organizationId: tenant.organizationId, projectId, secretId, input });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, secret };
}

export async function putConsoleSecretValue(req, env, { projectId, secretId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretAdminAccess(tenant);
  const input = await readJson(req);
  const secret = await rotateProjectSecret(env, { organizationId: tenant.organizationId, projectId, secretId, input });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, secret, rotated: true };
}

export async function deleteConsoleSecret(req, env, { projectId, secretId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretAdminAccess(tenant);
  const secret = await archiveProjectSecret(env, { organizationId: tenant.organizationId, projectId, secretId });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, secret, archived: true };
}

export async function listConsoleAuthProfiles(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  const authProfiles = await listProjectAuthProfiles(env, tenant.organizationId, projectId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfiles };
}

export async function createConsoleAuthProfile(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const authProfile = await createProjectAuthProfile(env, {
    organizationId: tenant.organizationId,
    projectId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfile };
}

export async function getConsoleAuthProfile(req, env, { projectId, authProfileId }) {
  const tenant = await requireConsoleTenant(req, env);
  const authProfile = await getProjectAuthProfile(env, tenant.organizationId, projectId, authProfileId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfile };
}

export async function patchConsoleAuthProfile(req, env, { projectId, authProfileId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const authProfile = await patchProjectAuthProfile(env, {
    organizationId: tenant.organizationId,
    projectId,
    authProfileId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfile };
}

export async function deleteConsoleAuthProfile(req, env, { projectId, authProfileId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const authProfile = await archiveProjectAuthProfile(env, { organizationId: tenant.organizationId, projectId, authProfileId });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfile, archived: true };
}

export async function listConsoleAuthProfileEnvironmentBindings(req, env, { projectId, authProfileId }) {
  const tenant = await requireConsoleTenant(req, env);
  const bindings = await listProjectAuthProfileEnvironmentBindings(env, tenant.organizationId, projectId, authProfileId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfileId, bindings };
}

export async function getConsoleAuthProfileEnvironmentBinding(req, env, { projectId, authProfileId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  const binding = await getProjectAuthProfileEnvironmentBinding(env, tenant.organizationId, projectId, authProfileId, environmentId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfileId, environmentId, binding };
}

export async function putConsoleAuthProfileEnvironmentBinding(req, env, { projectId, authProfileId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretAdminAccess(tenant);
  const input = await readJson(req);
  const binding = await putProjectAuthProfileEnvironmentBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    authProfileId,
    environmentId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfileId, environmentId, binding };
}

export async function deleteConsoleAuthProfileEnvironmentBinding(req, env, { projectId, authProfileId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertSecretAdminAccess(tenant);
  const binding = await deleteProjectAuthProfileEnvironmentBinding(env, {
    organizationId: tenant.organizationId,
    projectId,
    authProfileId,
    environmentId,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, authProfileId, environmentId, binding, archived: true };
}

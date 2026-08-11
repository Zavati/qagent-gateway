import { requireConsoleTenant } from '../services/tenantContextService.js';
import { updateOrganization } from '../repositories/organizationRepository.js';
import {
  archiveOrganizationProject,
  createOrganizationProject,
  getOrganizationProject,
  listOrganizationProjects,
  patchOrganizationProject,
} from '../services/projectService.js';
import {
  archiveProjectEnvironment,
  createProjectEnvironment,
  getProjectEnvironment,
  listProjectEnvironments,
  patchProjectEnvironment,
} from '../services/environmentService.js';

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

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function assertTenantWriteAccess(tenant) {
  if (!['owner', 'admin', 'member'].includes(tenant.organizationRole)) {
    const err = new Error('Sem permissão de escrita nesta organização.');
    err.status = 403;
    err.code = 'ORGANIZATION_WRITE_FORBIDDEN';
    throw err;
  }
}

export async function getConsoleOrganization(req, env) {
  const tenant = await requireConsoleTenant(req, env);
  return {
    status: 'ok',
    organization: tenant.organization,
    membership: { role: tenant.organizationRole },
  };
}

export async function patchConsoleOrganization(req, env) {
  const tenant = await requireConsoleTenant(req, env);
  if (!['owner', 'admin'].includes(tenant.organizationRole)) {
    const err = new Error('Sem permissão para alterar a organização.');
    err.status = 403;
    err.code = 'ORGANIZATION_WRITE_FORBIDDEN';
    throw err;
  }
  const body = await readJson(req);
  const name = clean(body?.name, 160);
  if (name.length < 2) {
    const err = new Error('Nome da organização é obrigatório.');
    err.status = 400;
    throw err;
  }
  const organization = await updateOrganization(env, tenant.organizationId, {
    name,
    status: tenant.organization.status,
  });
  return { status: 'ok', organization };
}

export async function listConsoleProjects(req, env) {
  const tenant = await requireConsoleTenant(req, env);
  const projects = await listOrganizationProjects(env, tenant.organizationId);
  return { status: 'ok', organizationId: tenant.organizationId, projects };
}

export async function createConsoleProject(req, env) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const project = await createOrganizationProject(env, {
    organizationId: tenant.organizationId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, project };
}

export async function getConsoleProject(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  const project = await getOrganizationProject(env, tenant.organizationId, projectId);
  return { status: 'ok', organizationId: tenant.organizationId, project };
}

export async function patchConsoleProject(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const project = await patchOrganizationProject(env, {
    organizationId: tenant.organizationId,
    projectId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, project };
}

export async function deleteConsoleProject(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const project = await archiveOrganizationProject(env, {
    organizationId: tenant.organizationId,
    projectId,
  });
  return { status: 'ok', organizationId: tenant.organizationId, project, archived: true };
}

export async function listConsoleEnvironments(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  const environments = await listProjectEnvironments(env, tenant.organizationId, projectId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environments };
}

export async function createConsoleEnvironment(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const environment = await createProjectEnvironment(env, {
    organizationId: tenant.organizationId,
    projectId,
    userId: tenant.user.userId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environment };
}

export async function getConsoleEnvironment(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  const environment = await getProjectEnvironment(env, tenant.organizationId, projectId, environmentId);
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environment };
}

export async function patchConsoleEnvironment(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const input = await readJson(req);
  const environment = await patchProjectEnvironment(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
    input,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environment };
}

export async function deleteConsoleEnvironment(req, env, { projectId, environmentId }) {
  const tenant = await requireConsoleTenant(req, env);
  assertTenantWriteAccess(tenant);
  const environment = await archiveProjectEnvironment(env, {
    organizationId: tenant.organizationId,
    projectId,
    environmentId,
  });
  return { status: 'ok', organizationId: tenant.organizationId, projectId, environment, archived: true };
}

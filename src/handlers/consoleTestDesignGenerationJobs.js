import { getOrganizationProject } from '../services/projectService.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import {
  createProjectTestDesignGenerationJob,
  getProjectTestDesignGenerationJob,
  listProjectTestDesignGenerationJobItems,
  listProjectTestDesignGenerationJobs,
} from '../services/testGenerationOrchestratorClient.js';

async function parseBody(req) {
  let input; try { input = await req.json(); } catch { const error = new Error('Body JSON inválido.'); error.status = 400; error.code = 'INVALID_JSON'; throw error; }
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}
export async function postConsoleProjectTestDesignGenerationJob(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);
  const input = await parseBody(req);
  const scope = String(input.scope || 'MISSING_TEST_DESIGNS').trim().toUpperCase();
  const data = await createProjectTestDesignGenerationJob({ env, organizationId: tenant.organizationId, projectId, scope, createdBy: tenant.user?.userId || null, createdByAccountId: tenant.accountId || null });
  return { status: 'ok', data };
}
export async function getConsoleProjectTestDesignGenerationJob(req, env, { jobId }) {
  const tenant = await requireConsoleTenant(req, env);
  const data = await getProjectTestDesignGenerationJob({ env, organizationId: tenant.organizationId, jobId });
  await getOrganizationProject(env, tenant.organizationId, data.projectId);
  return { status: 'ok', data };
}
export async function listConsoleProjectTestDesignGenerationJobItems(req, env, { jobId }) {
  const tenant = await requireConsoleTenant(req, env);
  const data = await listProjectTestDesignGenerationJobItems({ env, organizationId: tenant.organizationId, jobId });
  await getOrganizationProject(env, tenant.organizationId, data.job.projectId);
  return { status: 'ok', data };
}
export async function listConsoleProjectTestDesignGenerationJobs(req, env, { projectId }) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);
  const url = new URL(req.url);
  const data = await listProjectTestDesignGenerationJobs({ env, organizationId: tenant.organizationId, projectId, limit: url.searchParams.get('limit') || 20 });
  return { status: 'ok', data };
}

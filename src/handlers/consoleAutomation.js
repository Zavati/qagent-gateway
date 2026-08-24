import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import {
  getResultsEndpointLatest,
  getResultsProjectResultSet,
  getResultsProjectSummary,
  listResultsProjectResultSets,
} from '../services/resultsReadClient.js';

async function authorize(req, env, projectId, { requireTenant = requireConsoleTenant, getProject = getOrganizationProject } = {}) {
  const tenant = await requireTenant(req, env);
  await getProject(env, tenant.organizationId, projectId);
  return tenant;
}

export async function getConsoleAutomationSummary(req, env, { projectId }, deps = {}) {
  const tenant = await authorize(req, env, projectId, deps);
  const url = new URL(req.url);
  const data = await (deps.getSummary || getResultsProjectSummary)({
    env,
    organizationId: tenant.organizationId,
    projectId,
    days: url.searchParams.get('days') || 30,
    environmentId: url.searchParams.get('environmentId') || null,
  });
  return { status: 'ok', data };
}

export async function listConsoleAutomationResults(req, env, { projectId }, deps = {}) {
  const tenant = await authorize(req, env, projectId, deps);
  const url = new URL(req.url);
  const data = await (deps.listResults || listResultsProjectResultSets)({
    env,
    organizationId: tenant.organizationId,
    projectId,
    limit: url.searchParams.get('limit') || 30,
    cursor: url.searchParams.get('cursor') || null,
    outcome: url.searchParams.get('outcome') || null,
    endpointId: url.searchParams.get('endpointId') || null,
    environmentId: url.searchParams.get('environmentId') || null,
  });
  return { status: 'ok', data };
}

export async function getConsoleAutomationResult(req, env, { projectId, resultSetId }, deps = {}) {
  const tenant = await authorize(req, env, projectId, deps);
  const data = await (deps.getResult || getResultsProjectResultSet)({ env, organizationId: tenant.organizationId, projectId, resultSetId });
  return { status: 'ok', data };
}

export async function getConsoleEndpointAutomationLatest(req, env, { projectId, endpointId }, deps = {}) {
  const tenant = await authorize(req, env, projectId, deps);
  const url = new URL(req.url);
  const data = await (deps.getLatest || getResultsEndpointLatest)({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
    environmentId: url.searchParams.get('environmentId') || null,
  });
  return { status: 'ok', data };
}

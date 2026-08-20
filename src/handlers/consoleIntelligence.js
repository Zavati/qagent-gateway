import { getEnvNum } from '../lib/config.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { buildCatalogTestDesignContextV1 } from '../intelligence/catalogContextBuilder.js';
import { generateAndPersistCatalogTestDesignV1 } from '../intelligence/testDesignPersistence.js';
import { loadLatestPersistedTestDesignV1 } from '../intelligence/testDesignRetrieval.js';

export async function getConsoleTestDesignContext(req, env, { projectId, endpointId }) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);
  const result = await buildCatalogTestDesignContextV1({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
  });
  return {
    status: 'ok',
    data: result,
  };
}


export async function getConsoleTestDesign(
  req,
  env,
  { projectId, endpointId },
  {
    requireTenant = requireConsoleTenant,
    getProject = getOrganizationProject,
    loadLatest = loadLatestPersistedTestDesignV1,
  } = {},
) {
  const tenant = await requireTenant(req, env);
  await getProject(env, tenant.organizationId, projectId);

  const result = await loadLatest({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
  });

  return {
    status: 'ok',
    data: result,
  };
}

export async function postConsoleTestDesign(req, env, { projectId, endpointId }, { rateLimiter = null } = {}) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);

  if (rateLimiter) {
    rateLimiter({
      key: `test-design:${tenant.organizationId}:${tenant.user?.userId || tenant.accountId || 'console'}`,
      windowMs: getEnvNum(env, 'TEST_DESIGN_RATE_LIMIT_WINDOW_MS', 60_000),
      max: getEnvNum(env, 'TEST_DESIGN_RATE_LIMIT_MAX', 6),
    });
  }

  const result = await generateAndPersistCatalogTestDesignV1({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
    accountId: tenant.accountId || null,
  });

  return {
    status: 'ok',
    data: result,
  };
}

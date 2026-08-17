import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { buildCatalogTestDesignContextV1 } from '../intelligence/catalogContextBuilder.js';

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

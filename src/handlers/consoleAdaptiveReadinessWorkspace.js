import { getProjectEnvironment } from '../services/environmentService.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { readinessReconciliationEnabled } from '../readiness/readinessReconciliation.js';
import { isWorkspaceId, parseWorkspaceQuery, workspaceError } from '../contracts/adaptiveReadinessWorkspace.mjs';
import { readAdaptiveReadinessWorkspace } from '../services/adaptiveReadinessWorkspaceService.js';
/** GET only. No AI, runs, approvals, writes or authority from browser readiness. */
export async function getConsoleAdaptiveReadinessWorkspace(req, env, { projectId }, deps = {}) {
    const tenant = await (deps.requireTenant || requireConsoleTenant)(req, env);
    await (deps.getProject || getOrganizationProject)(env, tenant.organizationId, projectId);
    if (!isWorkspaceId(projectId))
        throw workspaceError('READINESS_WORKSPACE_SCOPE_INVALID');
    if (!readinessReconciliationEnabled(env))
        throw workspaceError('READINESS_RECONCILIATION_DISABLED', 409);
    const query = parseWorkspaceQuery(new URL(req.url).searchParams);
    await (deps.getEnvironment || getProjectEnvironment)(env, tenant.organizationId, projectId, query.environmentId);
    const data = await (deps.readWorkspace || readAdaptiveReadinessWorkspace)({ env, organizationId: tenant.organizationId, projectId, canWrite: ['owner', 'admin', 'member'].includes(tenant.organizationRole) }, query, deps);
    return { status: 'ok', data };
}

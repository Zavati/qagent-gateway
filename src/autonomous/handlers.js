import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { verifyTestGenerationInternalRequest } from '../security/testGenerationInternalAuth.js';
import { readinessReconciliationEnabled } from '../readiness/readinessReconciliation.js';
import { normalizePolicy, normalizeCycleStart, identifier, exact, failure } from './contracts.js';
import { autonomousClient, autonomousPath } from './client.js';
import { learningGrant, snapshotLearningCycle, executeLearningStep } from './commands.js';
import { resolveEnvironmentOrigins, materializeEnvironmentPolicy } from './environmentOrigins.js';
async function readBody(req) {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > 32768)
        failure('AUTONOMOUS_INPUT_TOO_LARGE', 413);
    let raw = '', size = 0;
    const reader = req.body?.getReader(), decoder = new TextDecoder();
    if (reader)
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.byteLength;
                if (size > 32768) {
                    await reader.cancel();
                    failure('AUTONOMOUS_INPUT_TOO_LARGE', 413);
                }
                raw += decoder.decode(value, { stream: true });
            }
            raw += decoder.decode();
        }
        finally {
            reader.releaseLock();
        }
    let input;
    try {
        input = raw ? JSON.parse(raw) : {};
    }
    catch {
        failure('AUTONOMOUS_JSON_INVALID', 400);
    }
    return { raw, input };
}
async function controlledEnvironment(scope, envId, deps) { const e = await (deps.getEnvironment || getProjectEnvironment)(scope.env, scope.organizationId, scope.projectId, identifier(envId)); if (!['DEV', 'QA', 'STG', 'CUSTOM'].includes(e.environmentType))
    failure('AUTONOMOUS_ENVIRONMENT_NOT_CONTROLLED', 403); return e; }
/** Public Console boundary: owner/admin delegation, no authority from arbitrary
 * body fields. Merely reading or saving a policy never creates a cycle. */
export async function consoleAutonomous(req, env, { projectId, resource, cycleId = null, action = null }, deps = {}) {
    identifier(projectId);
    const tenant = await (deps.requireTenant || requireConsoleTenant)(req, env);
    await (deps.getProject || getOrganizationProject)(env, tenant.organizationId, projectId);
    const scope = { env, organizationId: tenant.organizationId, projectId }, manage = ['owner', 'admin'].includes(tenant.organizationRole);
    const permissions = { managePolicy: manage, startCycle: manage, controlCycle: manage };
    if (req.method !== 'GET' && !manage)
        failure('AUTONOMOUS_FORBIDDEN', 403);
    if (!readinessReconciliationEnabled(env))
        failure('READINESS_RECONCILIATION_DISABLED');
    if (req.method !== 'GET' && (typeof tenant.user?.userId !== 'string' || !tenant.user.userId.startsWith('usr_')))
        failure('AUTONOMOUS_ACTOR_REQUIRED', 403);
    const client = deps.client || autonomousClient, u = new URL(req.url);
    let data;
    if (resource === 'policy' && !cycleId) {
        const environmentId = identifier(u.searchParams.get('environmentId'));
        const environment = await controlledEnvironment(scope, environmentId, deps);
        const originScope = { ...scope, environmentId, environment };
        const path = autonomousPath(projectId, `policy?environmentId=${encodeURIComponent(environmentId)}`);
        if (req.method === 'GET') {
            data = await client({ ...scope, path });
            data = { ...data, environmentOrigins: await resolveEnvironmentOrigins(originScope, deps) };
        } else if (req.method === 'PUT') {
            const { input: rawInput } = await readBody(req);
            // New UI sends only a reviewed fingerprint. The original explicit-list
            // API remains compatible; it never silently inherits added hosts.
            const derived = rawInput != null && Object.hasOwn(rawInput, 'originSelection')
                ? await materializeEnvironmentPolicy(rawInput, originScope, deps) : null;
            const input = derived?.input || rawInput, p = normalizePolicy(input);
            if (p.enabled && (typeof env.AUTONOMOUS_LEARNING_HMAC_SECRET !== 'string' || env.AUTONOMOUS_LEARNING_HMAC_SECRET.length < 32))
                failure('AUTONOMOUS_APPROVAL_SIGNING_NOT_CONFIGURED', 503);
            data = await client({ ...scope, path, method: 'PUT', body: { policy: input, actorUserId: tenant.user.userId } });
            if (derived) data = { ...data, environmentOrigins: derived.environmentOrigins };
        }
        else
            failure('AUTONOMOUS_METHOD_NOT_ALLOWED', 405);
    }
    else if (resource === 'cycles' && !cycleId) {
        if (req.method === 'GET') {
            const environmentId = identifier(u.searchParams.get('environmentId'));
            await controlledEnvironment(scope, environmentId, deps);
            data = await client({ ...scope, path: autonomousPath(projectId, `cycles?environmentId=${environmentId}`) });
        }
        else if (req.method === 'POST') {
            const { input } = await readBody(req), start = normalizeCycleStart(input);
            await controlledEnvironment(scope, start.environmentId, deps);
            data = await client({ ...scope, path: autonomousPath(projectId, 'cycles'), method: 'POST', body: { start: input, actorUserId: tenant.user.userId } });
        }
        else
            failure('AUTONOMOUS_METHOD_NOT_ALLOWED', 405);
    }
    else if (resource === 'cycles' && cycleId) {
        identifier(cycleId);
        // Read scope first; the returned environment must still exist in this project.
        const path = autonomousPath(projectId, `cycles/${cycleId}`);
        data = await client({ ...scope, path });
        await controlledEnvironment(scope, data.environmentId, deps);
        if (action === 'control' && req.method === 'POST') {
            const { input } = await readBody(req);
            exact(input, ['action']);
            if (!['PAUSE', 'RESUME', 'CANCEL'].includes(input.action))
                failure('AUTONOMOUS_CONTROL_INVALID', 400);
            data = await client({ ...scope, path: path + '/control', method: 'POST', body: input });
        }
        else if (action || req.method !== 'GET')
            failure('AUTONOMOUS_METHOD_NOT_ALLOWED', 405);
    }
    else
        failure('AUTONOMOUS_ROUTE_NOT_FOUND', 404);
    return { status: 'ok', data: { ...data, permissions } };
}
/** Orchestrator -> Gateway callback. Transport signature and live grant are both
 * required; the callback cannot supply a command, scope, proposal or proof. */
export async function internalAutonomous(req, env, { operation }, deps = {}) {
    if (req.method !== 'POST' || !['snapshot', 'step'].includes(operation))
        failure('AUTONOMOUS_METHOD_NOT_ALLOWED', 405);
    const { raw, input } = await readBody(req), scope = await (deps.verifyInternal || verifyTestGenerationInternalRequest)(req, env, { rawBody: raw });
    identifier(scope.organizationId);
    identifier(scope.projectId);
    const common = { env, ...scope, userId: null };
    await (deps.getProject || getOrganizationProject)(env, scope.organizationId, scope.projectId);
    const grant = await learningGrant(common, input, { ...deps, snapshot: operation === 'snapshot' });
    const data = operation === 'snapshot' ? await snapshotLearningCycle(common, grant, deps) : await executeLearningStep(common, grant, deps);
    return { status: 'ok', data };
}

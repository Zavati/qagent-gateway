import { requireDataDb } from '../repositories/dataDb.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { executionId, executionError, scopeValues, readJson, object } from '../services/uiExecutionContract.js';
import { createAutomationRun, automationDetail, automationRow } from '../services/automationRunService.js';

export async function automationRuns(req, env, params, deps = {}) {
  const tenant = await (deps.tenant ?? requireConsoleTenant)(req, env);
  if (req.method !== 'GET' && !['owner', 'admin', 'member'].includes(tenant.organizationRole)) throw executionError('READ_ONLY', 403);
  const scope = { organizationId: executionId(tenant.organizationId), projectId: executionId(params.projectId), environmentId: executionId(params.environmentId) };
  await (deps.environment ?? getProjectEnvironment)(env, ...scopeValues(scope));
  const wrap = (data, status = 200) => new Response(JSON.stringify({ status: 'ok', data }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  if (req.method === 'POST') {
    const value = await createAutomationRun(env, scope, tenant.user?.userId ?? null, await readJson(req), deps);
    return wrap(value, value.reused ? 200 : 202);
  }
  if (params.automationRunId) {
    const row = await automationRow(env, scope, executionId(params.automationRunId));
    if (!row) throw executionError('AUTOMATION_NOT_FOUND', 404);
    return wrap(await automationDetail(env, scope, row, deps));
  }
  const url = new URL(req.url), raw = url.searchParams.get('limit') ?? '20';
  if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 50) throw executionError('PAGINATION_INVALID');
  let cursor = null;
  if (url.searchParams.has('cursor')) {
    try { const value = url.searchParams.get('cursor'); if (value.length > 512) throw new Error(); cursor = JSON.parse(atob(value));
      object(cursor, ['at', 'id']); executionId(cursor.id); if (!Number.isSafeInteger(cursor.at) || cursor.at < 0) throw new Error();
    } catch { throw executionError('PAGINATION_INVALID'); }
  }
  const rows = (await requireDataDb(env).prepare(`SELECT * FROM automation_runs WHERE organization_id=? AND project_id=? AND environment_id=?
    ${cursor ? 'AND (created_at<? OR (created_at=? AND automation_run_id<?))' : ''} ORDER BY created_at DESC,automation_run_id DESC LIMIT ?`)
    .bind(...scopeValues(scope), ...(cursor ? [cursor.at, cursor.at, cursor.id] : []), Number(raw) + 1).all()).results;
  const chosen = rows.slice(0, Number(raw)), items = [];
  for (const row of chosen) items.push(await automationDetail(env, scope, row, deps));
  return wrap({ items, nextCursor: rows.length > Number(raw) ? btoa(JSON.stringify({ at: chosen.at(-1).created_at, id: chosen.at(-1).automation_run_id })) : null });
}

import { requireDataDb } from '../repositories/dataDb.js';
import { UiExecutionRepository } from '../repositories/uiExecutionRepository.js';
import { getOrganizationById } from '../repositories/organizationRepository.js';
import { getProjectEnvironment } from './environmentService.js';
import { canonical, hashBytes, scopeValues, readJson, executionError } from './uiExecutionContract.js';

const PATH = '/internal/ui-runner/v1/dispatch';
const SCOPE = 'organization_id=? AND project_id=? AND environment_id=?';
const secretValid = v => typeof v === 'string' && v.length >= 32 && v.length <= 512;
export const hostedRunnerConfigured = env => typeof env.UI_RUNNER?.fetch === 'function' && secretValid(env.UI_RUNNER_DISPATCH_SECRET);

export function dispatchInsert(db, batch, scope, now) {
  return db.prepare(`INSERT INTO ui_execution_dispatches(batch_id,organization_id,project_id,environment_id,next_attempt_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(batch_id) DO NOTHING`).bind(batch, ...scopeValues(scope), now, now, now);
}
export async function hostingState(env, scope, batchId) {
  const mode = env.UI_RUNNER ? 'CLOUDFLARE' : 'EXTERNAL', configured = hostedRunnerConfigured(env);
  const row = await requireDataDb(env).prepare(`SELECT status,attempts,last_error,updated_at FROM ui_execution_dispatches WHERE ${SCOPE} AND batch_id=?`).bind(...scopeValues(scope), batchId).first();
  return { mode, configured, status: mode === 'EXTERNAL' ? 'EXTERNAL' : !configured ? 'UNAVAILABLE' : row?.status ?? 'PENDING',
    attempts: row?.attempts ?? 0, lastError: mode === 'CLOUDFLARE' && !configured ? 'UI_RUNNER_DISPATCH_NOT_CONFIGURED' : row?.last_error ?? null,
    updatedAt: row ? new Date(row.updated_at).toISOString() : null };
}

export async function requestRunnerDispatch(env, scope, batchId, now = Date.now(), timeoutMs = 8000) {
  if (!hostedRunnerConfigured(env)) throw executionError('HOSTED_RUNNER_NOT_CONFIGURED', 503);
  const body = canonical({ contractVersion: 'qagent.ui-runner-dispatch.v1', scope, batchId }), timestamp = String(Math.floor(now / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.UI_RUNNER_DISPATCH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = `QAGENT_UI_RUNNER_HTTP_V1\nPOST\n${PATH}\n${timestamp}\n${await hashBytes(body)}`;
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))), b => b.toString(16).padStart(2, '0')).join('');
  const controller = new AbortController(); let timer, expired = false, response;
  const operation = (async () => {
    response = await env.UI_RUNNER.fetch(new Request('https://qagent-ui-runner.internal' + PATH, { method: 'POST', redirect: 'manual', body, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-QAgent-Runner-Time': timestamp, 'X-QAgent-Runner-Signature': signature } }));
    if (expired) { response.body?.cancel().catch(() => {}); throw executionError('RUNNER_DISPATCH_TIMEOUT', 503); }
    const value = await readJson(response, 16384, { signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error('Runner dispatch unavailable'), { status: response.status,
      code: /^[A-Z0-9_]{1,128}$/.test(value?.code ?? '') ? value.code : 'UI_RUNNER_DISPATCH_UNAVAILABLE' });
    if (value?.status !== 'ok' || value.data?.accepted !== true || value.data.batchId !== batchId) throw executionError('RUNNER_DISPATCH_RECEIPT_INVALID', 502);
    return value.data;
  })();
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; controller.abort(); response?.body?.cancel().catch(() => {}); reject(executionError('RUNNER_DISPATCH_TIMEOUT', 503)); }, timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
const safeCode = error => /^[A-Z0-9_]{1,128}$/.test(error?.code ?? '') ? error.code : 'UI_RUNNER_DISPATCH_UNAVAILABLE';
export async function dispatchUiBatch(env, scope, batchId, overrides = {}) {
  const now = overrides.now ?? Date.now(), db = requireDataDb(env), repo = new UiExecutionRepository(env);
  try {
    const org = await (overrides.organization ?? getOrganizationById)(env, scope.organizationId);
    if (!org || org.status !== 'active') throw executionError('ORGANIZATION_UNAVAILABLE', 403);
    await (overrides.environment ?? getProjectEnvironment)(env, ...scopeValues(scope));
  } catch (error) {
    const code = safeCode(error);
    await db.prepare(`UPDATE ui_execution_dispatches SET status='UNAVAILABLE',last_error=?,next_attempt_at=?,updated_at=? WHERE ${SCOPE} AND batch_id=?`).bind(code, now + 300000, now, ...scopeValues(scope), batchId).run();
    return { accepted: false, code };
  }
  await repo.sweep(scope, now, batchId);
  const batch = await repo.batch(scope, batchId); if (!batch) return { ignored: true };
  await dispatchInsert(db, batchId, scope, now).run();
  const items = await repo.items(scope, batchId), active = items.some(i => i.status === 'QUEUED' || i.status === 'RUNNING');
  if (!active || batch.cancel_requested && !items.some(i => i.status === 'RUNNING')) {
    await db.prepare(`UPDATE ui_execution_dispatches SET status='COMPLETE',last_error=NULL,lease_until=NULL,lease_token=NULL,updated_at=? WHERE ${SCOPE} AND batch_id=?`).bind(now, ...scopeValues(scope), batchId).run();
    return { complete: true };
  }
  if (!env.UI_RUNNER) return { external: true };
  const token = crypto.randomUUID();
  const owned = await db.prepare(`UPDATE ui_execution_dispatches SET lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE ${SCOPE} AND batch_id=? AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) AND status<>'COMPLETE' RETURNING *`)
    .bind(token, now + 30000, now, ...scopeValues(scope), batchId, now, now).first();
  if (!owned) return { deferred: true };
  let errorCode = null;
  try { await (overrides.request ?? requestRunnerDispatch)(env, scope, batchId, now); }
  catch (error) { errorCode = safeCode(error); }
  const next = now + (errorCode ? Math.min(300000, 10000 * 2 ** Math.min(owned.attempts - 1, 5)) : 60000);
  await db.prepare(`UPDATE ui_execution_dispatches SET status=?,last_error=?,next_attempt_at=?,lease_until=NULL,lease_token=NULL,updated_at=? WHERE ${SCOPE} AND batch_id=? AND lease_token=?`)
    .bind(errorCode ? 'UNAVAILABLE' : 'ACCEPTED', errorCode, next, now, ...scopeValues(scope), batchId, token).run();
  return { accepted: !errorCode, code: errorCode };
}

export async function reconcileUiDispatches(env, overrides = {}) {
  const now = overrides.now ?? Date.now(), db = requireDataDb(env);
  if (!env.UI_RUNNER) return { external: true };
  // Includes batches admitted before the hosting deployment. Never changes item
  // state back to QUEUED; lease expiry still terminalizes that exact attempt.
  await db.prepare(`INSERT INTO ui_execution_dispatches(batch_id,organization_id,project_id,environment_id,next_attempt_at,created_at,updated_at)
    SELECT b.batch_id,b.organization_id,b.project_id,b.environment_id,?,?,? FROM ui_execution_batches b
    WHERE EXISTS(SELECT 1 FROM ui_execution_items i WHERE i.batch_id=b.batch_id AND i.status IN ('QUEUED','RUNNING'))
      AND NOT EXISTS(SELECT 1 FROM ui_execution_dispatches d WHERE d.batch_id=b.batch_id)
    ORDER BY b.created_at,b.batch_id LIMIT 100
    ON CONFLICT(batch_id) DO NOTHING`).bind(now, now, now).run();
  const rows = (await db.prepare(`SELECT * FROM ui_execution_dispatches WHERE status<>'COMPLETE' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at,batch_id LIMIT 10`).bind(now, now).all()).results;
  const settled = await Promise.allSettled(rows.map(row => dispatchUiBatch(env, { organizationId: row.organization_id, projectId: row.project_id, environmentId: row.environment_id }, row.batch_id, { ...overrides, now })));
  return { scanned: rows.length, succeeded: settled.filter(v => v.status === 'fulfilled').length, errors: settled.filter(v => v.status === 'rejected').map(v => safeCode(v.reason)) };
}

export async function enqueueUiWake(env, scope, batchId, deps = {}) {
  await dispatchInsert(requireDataDb(env), batchId, scope, deps.now?.() ?? Date.now()).run();
  if (!env.UI_RUNNER) return;
  const task = dispatchUiBatch(env, scope, batchId, { now: deps.now?.() ?? Date.now(), organization: deps.organization, environment: deps.environment }).catch(() => undefined);
  if (typeof deps.waitUntil === 'function') deps.waitUntil(task); else await task;
}

import { requireDataDb } from '../repositories/dataDb.js';
import { UiExecutionRepository } from '../repositories/uiExecutionRepository.js';
import { getOrganizationById } from '../repositories/organizationRepository.js';
import { getProjectEnvironment } from './environmentService.js';
import { createSuiteRunV1, getSuiteRunV1 } from './suiteRunService.js';
import { normalizeSuiteRunCreateInput } from '../lib/suiteRunContracts.js';
import { createUiExecutionBatch, normalizeUiExecutionAdmission, uiExecutionDetail } from '../handlers/uiExecutions.js';
import { canonical, hashBytes, executionId, executionError, object, scopeValues } from './uiExecutionContract.js';

const SCOPE = 'organization_id=? AND project_id=? AND environment_id=?';
const errorCode = e => /^[A-Z0-9_]{1,128}$/.test(e?.code ?? '') ? e.code : 'AUTOMATION_ADMISSION_UNAVAILABLE';
const transient = e => e?.retryable === true || !e?.status || e.status === 408 || e.status === 429 || e.status >= 500;
const depsFor = input => ({ now: Date.now, organization: getOrganizationById, environment: getProjectEnvironment,
  createApi: createSuiteRunV1, getApi: getSuiteRunV1, createUi: createUiExecutionBatch,
  getUi: (env, scope, id, now) => uiExecutionDetail(env, new UiExecutionRepository(env), scope, id, now), ...input });
export function normalizeAutomationInput(raw, scope) {
  object(raw, ['operationId', 'api', 'ui'], ['operationId']); executionId(raw.operationId);
  if (!raw.api && !raw.ui) throw executionError('AUTOMATION_SELECTION_REQUIRED');
  const result = { operationId: raw.operationId, api: null, ui: null };
  if (raw.api !== undefined && raw.api !== null) {
    object(raw.api, ['suiteVersionId', 'confirmDiscoveredRuntime', 'confirmProductionMutation'], ['suiteVersionId']);
    for (const field of ['confirmDiscoveredRuntime', 'confirmProductionMutation']) if (raw.api[field] !== undefined && typeof raw.api[field] !== 'boolean') throw executionError('INPUT_INVALID');
    const normalized = normalizeSuiteRunCreateInput({ contractVersion: 'qagent.suite-run-create.v1', environmentId: scope.environmentId, ...raw.api });
    result.api = { suiteVersionId: normalized.suiteVersionId, confirmDiscoveredRuntime: normalized.confirmDiscoveredRuntime, confirmProductionMutation: normalized.confirmProductionMutation };
  }
  if (raw.ui !== undefined && raw.ui !== null) {
    object(raw.ui, ['testDesignVersionIds', 'profileId', 'targetBuildRef']);
    const normalized = normalizeUiExecutionAdmission({ operationId: raw.operationId, ...raw.ui });
    result.ui = { testDesignVersionIds: normalized.testDesignVersionIds, profileId: normalized.profileId, targetBuildRef: normalized.targetBuildRef };
  }
  return result;
}
export async function automationRow(env, scope, id) {
  return requireDataDb(env).prepare(`SELECT * FROM automation_runs WHERE ${SCOPE} AND automation_run_id=?`).bind(...scopeValues(scope), id).first();
}
export async function reconcileAutomationRun(env, row, overrides = {}) {
  const deps = depsFor(overrides), db = requireDataDb(env), scope = { organizationId: row.organization_id, projectId: row.project_id, environmentId: row.environment_id }, now = deps.now();
  if (![row.api_admission, row.ui_admission].includes('PENDING')) return row;
  const token = crypto.randomUUID();
  const owned = await db.prepare(`UPDATE automation_runs SET lease_token=?,lease_until=?,admission_attempts=admission_attempts+1,updated_at=?
    WHERE automation_run_id=? AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) AND (api_admission='PENDING' OR ui_admission='PENDING') RETURNING *`)
    .bind(token, now + 120000, now, row.automation_run_id, now, now).first();
  if (!owned) return automationRow(env, scope, row.automation_run_id);
  try {
    const org = await deps.organization(env, scope.organizationId);
    if (!org || org.status !== 'active') throw executionError('ORGANIZATION_UNAVAILABLE', 403);
    await deps.environment(env, ...scopeValues(scope));
    const input = JSON.parse(owned.request_json);
    await Promise.all(['api', 'ui'].map(async domain => {
      if (owned[domain + '_admission'] !== 'PENDING') return;
      let childId = null, failure = null, admission = 'ADMITTED';
      try {
        if (domain === 'api') {
          const result = await deps.createApi({ env, ...scope, userId: owned.created_by,
            input: { contractVersion: 'qagent.suite-run-create.v1', environmentId: scope.environmentId, ...input.api },
            idempotencyKey: `automation:${owned.automation_run_id}:api` });
          childId = result?.suiteRun?.suiteRunId; if (!childId || result.suiteRun.environmentId !== scope.environmentId || result.suiteRun.projectId !== scope.projectId) throw executionError('AUTOMATION_API_RECEIPT_INVALID', 502);
        } else {
          const result = await deps.createUi(env, scope, owned.created_by, { operationId: 'uiexop_' + owned.automation_run_id, ...input.ui }, deps.uiDependencies ?? {});
          childId = result?.batchId; if (!childId) throw executionError('AUTOMATION_UI_RECEIPT_INVALID', 502);
        }
      } catch (error) { failure = errorCode(error); admission = transient(error) ? 'PENDING' : 'ERROR'; }
      // Domain is an internal literal, never interpolated from a request.
      await db.prepare(`UPDATE automation_runs SET ${domain}_admission=?,${domain}_child_id=COALESCE(?,${domain}_child_id),${domain}_error=?,updated_at=?
        WHERE automation_run_id=? AND lease_token=? AND ${domain}_admission='PENDING'`).bind(admission, childId, failure, deps.now(), owned.automation_run_id, token).run();
    }));
  } catch (error) {
    const state = transient(error) ? 'PENDING' : 'ERROR', code = errorCode(error);
    await db.prepare(`UPDATE automation_runs SET api_error=CASE WHEN api_admission='PENDING' THEN ? ELSE api_error END,
      ui_error=CASE WHEN ui_admission='PENDING' THEN ? ELSE ui_error END,
      api_admission=CASE WHEN api_admission='PENDING' THEN ? ELSE api_admission END,
      ui_admission=CASE WHEN ui_admission='PENDING' THEN ? ELSE ui_admission END WHERE automation_run_id=? AND lease_token=?`)
      .bind(code, code, state, state, owned.automation_run_id, token).run();
  } finally {
    const next = deps.now() + Math.min(300000, 5000 * 2 ** Math.min(owned.admission_attempts - 1, 6));
    await db.prepare(`UPDATE automation_runs SET lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE automation_run_id=? AND lease_token=?`)
      .bind(next, deps.now(), owned.automation_run_id, token).run();
  }
  return automationRow(env, scope, row.automation_run_id);
}

export async function automationDetail(env, scope, row, overrides = {}) {
  const deps = depsFor(overrides), output = { contractVersion: 'qagent.automation-run.v1', automationRunId: row.automation_run_id,
    operationId: row.operation_id, scope, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
    api: { admission: row.api_admission, errorCode: row.api_error, suiteRunId: row.api_child_id, suiteRun: null },
    ui: { admission: row.ui_admission, errorCode: row.ui_error, batchId: row.ui_child_id, batch: null } };
  await Promise.all([
    (async () => { if (!row.api_child_id) return; try { output.api.suiteRun = await deps.getApi({ env, ...scope, suiteRunId: row.api_child_id }); } catch (error) { output.api.errorCode = errorCode(error); } })(),
    (async () => { if (!row.ui_child_id) return; try { output.ui.batch = await deps.getUi(env, scope, row.ui_child_id, deps.now()); } catch (error) { output.ui.errorCode = errorCode(error); } })(),
  ]);
  const apiActive = output.api.suiteRun && !['PASSED', 'FAILED', 'ERROR', 'CANCELLED'].includes(output.api.suiteRun.suiteRun.status);
  const uiActive = output.ui.batch && (['QUEUED', 'RUNNING'].includes(output.ui.batch.status) || output.ui.batch.counts?.running > 0);
  const unavailableChild = row.api_admission === 'ADMITTED' && !output.api.suiteRun || row.ui_admission === 'ADMITTED' && !output.ui.batch;
  output.status = apiActive || uiActive ? 'RUNNING' : unavailableChild || [row.api_admission, row.ui_admission].includes('PENDING') ? 'PENDING'
    : [row.api_admission, row.ui_admission].includes('ERROR') || output.api.errorCode || output.ui.errorCode ? 'NEEDS_ATTENTION' : 'COMPLETED';
  return output;
}

export async function createAutomationRun(env, scope, actor, raw, overrides = {}) {
  const deps = depsFor(overrides), input = normalizeAutomationInput(raw, scope), db = requireDataDb(env), now = deps.now();
  const request = canonical(input), hash = await hashBytes(request), id = 'auto_' + await hashBytes(canonical({ scope, operationId: input.operationId }));
  const prior = await automationRow(env, scope, id);
  if (prior && prior.request_hash !== hash) throw executionError('IDEMPOTENCY_CONFLICT', 409);
  await db.prepare(`INSERT INTO automation_runs(automation_run_id,organization_id,project_id,environment_id,operation_id,request_hash,request_json,created_by,
    api_admission,ui_admission,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(organization_id,project_id,environment_id,operation_id) DO NOTHING`)
    .bind(id, ...scopeValues(scope), input.operationId, hash, request, actor, input.api ? 'PENDING' : 'NOT_REQUESTED', input.ui ? 'PENDING' : 'NOT_REQUESTED', now, now, now).run();
  const row = await automationRow(env, scope, id);
  if (row.request_hash !== hash) throw executionError('IDEMPOTENCY_CONFLICT', 409);
  // Durable intent already exists. A request can finish/close here and the cron
  // can recover either child with the exact same pinned request/idempotency key.
  if (typeof overrides.waitUntil === 'function') {
    overrides.waitUntil(reconcileAutomationRun(env, row, overrides).catch(() => undefined));
    return { ...await automationDetail(env, scope, row, overrides), reused: !!prior };
  }
  const updated = await reconcileAutomationRun(env, row, overrides);
  return { ...await automationDetail(env, scope, updated, overrides), reused: !!prior };
}

export async function reconcileAutomationRuns(env, overrides = {}) {
  const deps = depsFor(overrides), now = deps.now(), db = requireDataDb(env);
  const rows = (await db.prepare(`SELECT * FROM automation_runs WHERE (api_admission='PENDING' OR ui_admission='PENDING') AND next_attempt_at<=?
    AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_attempt_at,automation_run_id LIMIT 10`).bind(now, now).all()).results;
  // Two parents at a time bound source reads without stopping other tenants.
  const settled = [];
  for (let at = 0; at < rows.length; at += 2) settled.push(...await Promise.allSettled(rows.slice(at, at + 2).map(row => reconcileAutomationRun(env, row, overrides))));
  return { scanned: rows.length, errors: settled.filter(v => v.status === 'rejected').map(v => errorCode(v.reason)) };
}

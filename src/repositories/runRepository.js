import { getLatestRunExecutionAttempt } from './runExecutionClaimRepository.js';
import { requireDataDb } from './dataDb.js';

const RUN_SELECT = `
  SELECT
    run_id AS runId,
    organization_id AS organizationId,
    project_id AS projectId,
    contract_version AS contractVersion,
    test_design_id AS testDesignId,
    test_design_version_id AS testDesignVersionId,
    test_design_version AS testDesignVersion,
    endpoint_id AS endpointId,
    environment_id AS environmentId,
    execution_plan_id AS executionPlanId,
    runtime_snapshot_id AS runtimeSnapshotId,
    status,
    scenario_count AS scenarioCount,
    scenario_ids_json AS scenarioIdsJson,
    idempotency_key AS idempotencyKey,
    request_fingerprint AS requestFingerprint,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM runs
`;

const PLAN_SELECT = `
  SELECT
    execution_plan_id AS executionPlanId,
    run_id AS runId,
    runtime_snapshot_id AS runtimeSnapshotId,
    organization_id AS organizationId,
    project_id AS projectId,
    test_design_version_id AS testDesignVersionId,
    environment_id AS environmentId,
    contract_version AS contractVersion,
    plan_json AS planJson,
    plan_hash AS planHash,
    scenario_count AS scenarioCount,
    schema_snapshot_count AS schemaSnapshotCount,
    created_at AS createdAt
  FROM execution_plans
`;

const SNAPSHOT_SELECT = `
  SELECT
    runtime_snapshot_id AS runtimeSnapshotId,
    run_id AS runId,
    organization_id AS organizationId,
    project_id AS projectId,
    environment_id AS environmentId,
    contract_version AS contractVersion,
    resolution_source AS resolutionSource,
    resolution_confidence AS resolutionConfidence,
    requires_execution_confirmation AS requiresExecutionConfirmation,
    snapshot_json AS snapshotJson,
    snapshot_hash AS snapshotHash,
    created_at AS createdAt
  FROM runtime_snapshots
`;

const DISPATCH_SELECT = `
  SELECT
    run_id AS runId,
    organization_id AS organizationId,
    project_id AS projectId,
    contract_version AS contractVersion,
    execution_plan_id AS executionPlanId,
    runtime_snapshot_id AS runtimeSnapshotId,
    status,
    dispatch_attempt_count AS dispatchAttemptCount,
    published_at AS publishedAt,
    runner_received_at AS runnerReceivedAt,
    last_error_code AS lastErrorCode,
    last_error_at AS lastErrorAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM run_queue_dispatches
`;

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeRun(row) {
  if (!row) return null;
  return {
    ...row,
    testDesignVersion: Number(row.testDesignVersion),
    scenarioCount: Number(row.scenarioCount),
    scenarioIds: parseJson(row.scenarioIdsJson, []),
  };
}

function normalizePlan(row) {
  if (!row) return null;
  return {
    ...row,
    scenarioCount: Number(row.scenarioCount),
    schemaSnapshotCount: Number(row.schemaSnapshotCount),
    plan: parseJson(row.planJson, null),
  };
}

function normalizeSnapshot(row) {
  if (!row) return null;
  return {
    ...row,
    requiresExecutionConfirmation: Number(row.requiresExecutionConfirmation) === 1,
    snapshot: parseJson(row.snapshotJson, null),
  };
}

function normalizeDispatch(row) {
  if (!row) return null;
  return {
    ...row,
    dispatchAttemptCount: Number(row.dispatchAttemptCount || 0),
  };
}

export async function getRunByIdempotencyKey(env, organizationId, projectId, idempotencyKey) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${RUN_SELECT}
    WHERE organization_id = ? AND project_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(organizationId, projectId, idempotencyKey).first();
  return normalizeRun(row);
}

export async function getRun(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${RUN_SELECT}
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
    LIMIT 1
  `).bind(organizationId, projectId, runId).first();
  return normalizeRun(row);
}

export async function getRunByRunId(env, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${RUN_SELECT}
    WHERE run_id = ?
    LIMIT 1
  `).bind(runId).first();
  return normalizeRun(row);
}

export async function getExecutionPlanForRun(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${PLAN_SELECT}
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
    LIMIT 1
  `).bind(organizationId, projectId, runId).first();
  return normalizePlan(row);
}

export async function getRuntimeSnapshotForRun(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${SNAPSHOT_SELECT}
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
    LIMIT 1
  `).bind(organizationId, projectId, runId).first();
  return normalizeSnapshot(row);
}

export async function getRunQueueDispatch(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${DISPATCH_SELECT}
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
    LIMIT 1
  `).bind(organizationId, projectId, runId).first();
  return normalizeDispatch(row);
}

export async function getRunBundle(env, organizationId, projectId, runId) {
  const [run, executionPlan, runtimeSnapshot, dispatch, latestAttempt] = await Promise.all([
    getRun(env, organizationId, projectId, runId),
    getExecutionPlanForRun(env, organizationId, projectId, runId),
    getRuntimeSnapshotForRun(env, organizationId, projectId, runId),
    getRunQueueDispatch(env, organizationId, projectId, runId),
    getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
  ]);
  if (!run) return null;
  return { run, executionPlan, runtimeSnapshot, dispatch, latestAttempt };
}

export async function getRunBundleByRunId(env, runId) {
  const run = await getRunByRunId(env, runId);
  if (!run) return null;
  return getRunBundle(env, run.organizationId, run.projectId, runId);
}

export async function ensureRunQueueDispatch(env, bundle) {
  const db = requireDataDb(env);
  const run = bundle?.run;
  if (!run) throw new Error('Run bundle ausente ao preparar dispatch.');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO run_queue_dispatches (
      run_id, organization_id, project_id, contract_version,
      execution_plan_id, runtime_snapshot_id,
      status, dispatch_attempt_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'qagent.run-requested.v1', ?, ?, 'PENDING', 0, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `).bind(
    run.runId,
    run.organizationId,
    run.projectId,
    run.executionPlanId,
    run.runtimeSnapshotId,
    now,
    now,
  ).run();
  return getRunQueueDispatch(env, run.organizationId, run.projectId, run.runId);
}

export async function markRunDispatchAttempt(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE run_queue_dispatches
    SET dispatch_attempt_count = dispatch_attempt_count + 1,
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(now, organizationId, projectId, runId).run();
  return getRunQueueDispatch(env, organizationId, projectId, runId);
}

export async function markRunDispatchFailed(env, organizationId, projectId, runId, errorCode) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE run_queue_dispatches
    SET last_error_code = ?, last_error_at = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(String(errorCode || 'RUN_QUEUE_DISPATCH_FAILED').slice(0, 120), now, now, organizationId, projectId, runId).run();
  return getRunQueueDispatch(env, organizationId, projectId, runId);
}

export async function markRunQueued(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const dispatchUpdate = db.prepare(`
    UPDATE run_queue_dispatches
    SET status = CASE WHEN status = 'RECEIVED' THEN 'RECEIVED' ELSE 'PUBLISHED' END,
        published_at = COALESCE(published_at, ?),
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(now, now, organizationId, projectId, runId);
  const runUpdate = db.prepare(`
    UPDATE runs
    SET status = CASE WHEN status = 'CREATED' THEN 'QUEUED' ELSE status END,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(now, organizationId, projectId, runId);
  if (typeof db.batch === 'function') await db.batch([dispatchUpdate, runUpdate]);
  else { await dispatchUpdate.run(); await runUpdate.run(); }
  return getRunBundle(env, organizationId, projectId, runId);
}

export async function markRunRunnerReceived(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const now = new Date().toISOString();
  const dispatchUpdate = db.prepare(`
    UPDATE run_queue_dispatches
    SET status = 'RECEIVED',
        published_at = COALESCE(published_at, ?),
        runner_received_at = COALESCE(runner_received_at, ?),
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(now, now, now, organizationId, projectId, runId);
  const runUpdate = db.prepare(`
    UPDATE runs
    SET status = CASE WHEN status = 'CREATED' THEN 'QUEUED' ELSE status END,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(now, organizationId, projectId, runId);
  if (typeof db.batch === 'function') await db.batch([dispatchUpdate, runUpdate]);
  else { await dispatchUpdate.run(); await runUpdate.run(); }
  return getRunBundle(env, organizationId, projectId, runId);
}

export async function createRunArtifacts(env, {
  run,
  runtimeSnapshot,
  executionPlan,
}) {
  const db = requireDataDb(env);

  const runInsert = db.prepare(`
    INSERT INTO runs (
      run_id, organization_id, project_id, contract_version,
      test_design_id, test_design_version_id, test_design_version, endpoint_id, environment_id,
      execution_plan_id, runtime_snapshot_id, status,
      scenario_count, scenario_ids_json,
      idempotency_key, request_fingerprint,
      created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    run.runId,
    run.organizationId,
    run.projectId,
    run.contractVersion,
    run.testDesignId,
    run.testDesignVersionId,
    run.testDesignVersion,
    run.endpointId,
    run.environmentId,
    run.executionPlanId,
    run.runtimeSnapshotId,
    run.scenarioCount,
    JSON.stringify(run.scenarioIds),
    run.idempotencyKey,
    run.requestFingerprint,
    run.createdByUserId || null,
    run.createdAt,
    run.updatedAt,
  );

  const snapshotInsert = db.prepare(`
    INSERT INTO runtime_snapshots (
      runtime_snapshot_id, run_id, organization_id, project_id, environment_id,
      contract_version, resolution_source, resolution_confidence,
      requires_execution_confirmation, snapshot_json, snapshot_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    runtimeSnapshot.runtimeSnapshotId,
    run.runId,
    run.organizationId,
    run.projectId,
    run.environmentId,
    runtimeSnapshot.contractVersion,
    runtimeSnapshot.resolution.source,
    runtimeSnapshot.resolution.confidence,
    runtimeSnapshot.resolution.requiresExecutionConfirmation ? 1 : 0,
    JSON.stringify(runtimeSnapshot),
    runtimeSnapshot.snapshotHash,
    runtimeSnapshot.createdAt,
  );

  const planInsert = db.prepare(`
    INSERT INTO execution_plans (
      execution_plan_id, run_id, runtime_snapshot_id,
      organization_id, project_id, test_design_version_id, environment_id,
      contract_version, plan_json, plan_hash, scenario_count, schema_snapshot_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    executionPlan.executionPlanId,
    run.runId,
    runtimeSnapshot.runtimeSnapshotId,
    run.organizationId,
    run.projectId,
    run.testDesignVersionId,
    run.environmentId,
    executionPlan.contractVersion,
    JSON.stringify(executionPlan),
    executionPlan.planHash,
    executionPlan.scenarios.length,
    executionPlan.schemaSnapshots.length,
    executionPlan.createdAt,
  );

  const dispatchInsert = db.prepare(`
    INSERT INTO run_queue_dispatches (
      run_id, organization_id, project_id, contract_version,
      execution_plan_id, runtime_snapshot_id,
      status, dispatch_attempt_count,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'qagent.run-requested.v1', ?, ?, 'PENDING', 0, ?, ?)
  `).bind(
    run.runId,
    run.organizationId,
    run.projectId,
    run.executionPlanId,
    run.runtimeSnapshotId,
    run.createdAt,
    run.createdAt,
  );

  if (typeof db.batch === 'function') {
    await db.batch([runInsert, snapshotInsert, planInsert, dispatchInsert]);
  } else {
    await runInsert.run();
    await snapshotInsert.run();
    await planInsert.run();
    await dispatchInsert.run();
  }

  return getRunBundle(env, run.organizationId, run.projectId, run.runId);
}

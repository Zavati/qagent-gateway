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

export async function getRunBundle(env, organizationId, projectId, runId) {
  const [run, executionPlan, runtimeSnapshot] = await Promise.all([
    getRun(env, organizationId, projectId, runId),
    getExecutionPlanForRun(env, organizationId, projectId, runId),
    getRuntimeSnapshotForRun(env, organizationId, projectId, runId),
  ]);
  if (!run) return null;
  return { run, executionPlan, runtimeSnapshot };
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

  if (typeof db.batch === 'function') {
    await db.batch([runInsert, snapshotInsert, planInsert]);
  } else {
    // Test/local fallback only. Production D1 supports batch and uses it transactionally.
    await runInsert.run();
    await snapshotInsert.run();
    await planInsert.run();
  }

  return getRunBundle(env, run.organizationId, run.projectId, run.runId);
}

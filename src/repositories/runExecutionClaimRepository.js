import { requireDataDb } from './dataDb.js';

const ATTEMPT_SELECT = `
  SELECT
    attempt_id AS attemptId,
    run_id AS runId,
    organization_id AS organizationId,
    project_id AS projectId,
    attempt_number AS attemptNumber,
    status,
    lease_owner_id AS leaseOwnerId,
    lease_token_hash AS leaseTokenHash,
    lease_acquired_at AS leaseAcquiredAt,
    lease_expires_at AS leaseExpiresAt,
    heartbeat_at AS heartbeatAt,
    heartbeat_count AS heartbeatCount,
    queue_message_id AS queueMessageId,
    queue_delivery_attempt AS queueDeliveryAttempt,
    last_error_code AS lastErrorCode,
    next_retry_at AS nextRetryAt,
    received_at AS receivedAt,
    terminal_at AS terminalAt,
    runtime_readiness_status AS runtimeReadinessStatus,
    runtime_plan_hash AS runtimePlanHash,
    runtime_target_count AS runtimeTargetCount,
    runtime_resolution_source AS runtimeResolutionSource,
    runtime_resolution_confidence AS runtimeResolutionConfidence,
    runtime_materialized_at AS runtimeMaterializedAt,
    http_execution_status AS httpExecutionStatus,
    http_request_count AS httpRequestCount,
    http_response_count AS httpResponseCount,
    http_network_error_count AS httpNetworkErrorCount,
    http_timeout_count AS httpTimeoutCount,
    http_redirect_count AS httpRedirectCount,
    http_duration_ms AS httpDurationMs,
    http_executed_at AS httpExecutedAt,
    http_response_2xx_count AS httpResponse2xxCount,
    http_response_3xx_count AS httpResponse3xxCount,
    http_response_4xx_count AS httpResponse4xxCount,
    http_response_5xx_count AS httpResponse5xxCount,
    http_primary_diagnostic_kind AS httpPrimaryDiagnosticKind,
    http_primary_scenario_id AS httpPrimaryScenarioId,
    http_primary_status_code AS httpPrimaryStatusCode,
    http_primary_error_code AS httpPrimaryErrorCode,
    http_primary_error_category AS httpPrimaryErrorCategory,
    http_primary_error_name AS httpPrimaryErrorName,
    http_primary_cause_code AS httpPrimaryCauseCode,
    assertion_execution_status AS assertionExecutionStatus,
    assertion_outcome AS assertionOutcome,
    assertion_scenario_count AS assertionScenarioCount,
    assertion_scenario_passed_count AS assertionScenarioPassedCount,
    assertion_scenario_failed_count AS assertionScenarioFailedCount,
    assertion_scenario_not_evaluated_count AS assertionScenarioNotEvaluatedCount,
    assertion_count AS assertionCount,
    assertion_passed_count AS assertionPassedCount,
    assertion_failed_count AS assertionFailedCount,
    assertion_not_evaluated_count AS assertionNotEvaluatedCount,
    assertion_duration_ms AS assertionDurationMs,
    assertion_evaluated_at AS assertionEvaluatedAt,
    assertion_primary_diagnostic_kind AS assertionPrimaryDiagnosticKind,
    assertion_primary_scenario_id AS assertionPrimaryScenarioId,
    assertion_primary_index AS assertionPrimaryIndex,
    assertion_primary_type AS assertionPrimaryType,
    assertion_primary_error_code AS assertionPrimaryErrorCode,
    assertion_primary_path AS assertionPrimaryPath,
    assertion_primary_header_name AS assertionPrimaryHeaderName,
    assertion_primary_schema_ref AS assertionPrimarySchemaRef,
    assertion_primary_actual_status_code AS assertionPrimaryActualStatusCode,
    assertion_primary_actual_content_type AS assertionPrimaryActualContentType,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM run_execution_attempts
`;

const CLAIM_SELECT = `
  SELECT
    run_id AS runId,
    organization_id AS organizationId,
    project_id AS projectId,
    state,
    current_attempt_id AS currentAttemptId,
    current_attempt_number AS currentAttemptNumber,
    lease_owner_id AS leaseOwnerId,
    lease_token_hash AS leaseTokenHash,
    lease_expires_at AS leaseExpiresAt,
    heartbeat_at AS heartbeatAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM run_execution_claims
`;

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAttempt(row) {
  if (!row) return null;
  return {
    ...row,
    attemptNumber: num(row.attemptNumber),
    heartbeatCount: num(row.heartbeatCount),
    queueDeliveryAttempt: row.queueDeliveryAttempt == null ? null : num(row.queueDeliveryAttempt, null),
    httpRequestCount: row.httpRequestCount == null ? null : num(row.httpRequestCount, null),
    httpResponseCount: row.httpResponseCount == null ? null : num(row.httpResponseCount, null),
    httpNetworkErrorCount: row.httpNetworkErrorCount == null ? null : num(row.httpNetworkErrorCount, null),
    httpTimeoutCount: row.httpTimeoutCount == null ? null : num(row.httpTimeoutCount, null),
    httpRedirectCount: row.httpRedirectCount == null ? null : num(row.httpRedirectCount, null),
    httpDurationMs: row.httpDurationMs == null ? null : num(row.httpDurationMs, null),
    httpResponse2xxCount: row.httpResponse2xxCount == null ? null : num(row.httpResponse2xxCount, null),
    httpResponse3xxCount: row.httpResponse3xxCount == null ? null : num(row.httpResponse3xxCount, null),
    httpResponse4xxCount: row.httpResponse4xxCount == null ? null : num(row.httpResponse4xxCount, null),
    httpResponse5xxCount: row.httpResponse5xxCount == null ? null : num(row.httpResponse5xxCount, null),
    httpPrimaryStatusCode: row.httpPrimaryStatusCode == null ? null : num(row.httpPrimaryStatusCode, null),
    assertionScenarioCount: row.assertionScenarioCount == null ? null : num(row.assertionScenarioCount, null),
    assertionScenarioPassedCount: row.assertionScenarioPassedCount == null ? null : num(row.assertionScenarioPassedCount, null),
    assertionScenarioFailedCount: row.assertionScenarioFailedCount == null ? null : num(row.assertionScenarioFailedCount, null),
    assertionScenarioNotEvaluatedCount: row.assertionScenarioNotEvaluatedCount == null ? null : num(row.assertionScenarioNotEvaluatedCount, null),
    assertionCount: row.assertionCount == null ? null : num(row.assertionCount, null),
    assertionPassedCount: row.assertionPassedCount == null ? null : num(row.assertionPassedCount, null),
    assertionFailedCount: row.assertionFailedCount == null ? null : num(row.assertionFailedCount, null),
    assertionNotEvaluatedCount: row.assertionNotEvaluatedCount == null ? null : num(row.assertionNotEvaluatedCount, null),
    assertionDurationMs: row.assertionDurationMs == null ? null : num(row.assertionDurationMs, null),
    assertionPrimaryIndex: row.assertionPrimaryIndex == null ? null : num(row.assertionPrimaryIndex, null),
    assertionPrimaryActualStatusCode: row.assertionPrimaryActualStatusCode == null ? null : num(row.assertionPrimaryActualStatusCode, null),
  };
}

function normalizeClaim(row) {
  if (!row) return null;
  return { ...row, currentAttemptNumber: num(row.currentAttemptNumber) };
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export async function getLatestRunExecutionAttempt(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${ATTEMPT_SELECT}
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
    ORDER BY attempt_number DESC
    LIMIT 1
  `).bind(organizationId, projectId, runId).first();
  return normalizeAttempt(row);
}

export async function getRunExecutionClaim(env, organizationId, projectId, runId) {
  const db = requireDataDb(env);
  const row = await db.prepare(`${CLAIM_SELECT}
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
    LIMIT 1
  `).bind(organizationId, projectId, runId).first();
  return normalizeClaim(row);
}

export async function tryClaimRunExecution(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseOwnerId,
  leaseTokenHash,
  leaseAcquiredAt,
  leaseExpiresAt,
  queueMessageId = null,
  queueDeliveryAttempt = null,
}) {
  const db = requireDataDb(env);
  const now = leaseAcquiredAt;

  await db.prepare(`
    INSERT INTO run_execution_claims (
      run_id, organization_id, project_id,
      state, current_attempt_number,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'IDLE', 0, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `).bind(runId, organizationId, projectId, now, now).run();

  const abandonExpired = db.prepare(`
    UPDATE run_execution_attempts
    SET status = 'ABANDONED',
        terminal_at = COALESCE(terminal_at, ?),
        last_error_code = COALESCE(last_error_code, 'RUNNER_LEASE_EXPIRED'),
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND status = 'CLAIMED'
      AND lease_expires_at <= ?
  `).bind(now, now, organizationId, projectId, runId, now);

  const acquire = db.prepare(`
    UPDATE run_execution_claims
    SET state = 'ACTIVE',
        current_attempt_id = ?,
        current_attempt_number = current_attempt_number + 1,
        lease_owner_id = ?,
        lease_token_hash = ?,
        lease_expires_at = ?,
        heartbeat_at = ?,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND (
        state = 'IDLE'
        OR lease_expires_at IS NULL
        OR lease_expires_at <= ?
      )
  `).bind(
    attemptId,
    leaseOwnerId,
    leaseTokenHash,
    leaseExpiresAt,
    now,
    now,
    organizationId,
    projectId,
    runId,
    now,
  );

  const insertAttempt = db.prepare(`
    INSERT INTO run_execution_attempts (
      attempt_id, run_id, organization_id, project_id, attempt_number, status,
      lease_owner_id, lease_token_hash, lease_acquired_at, lease_expires_at,
      heartbeat_at, heartbeat_count,
      queue_message_id, queue_delivery_attempt,
      created_at, updated_at
    )
    SELECT
      ?, c.run_id, c.organization_id, c.project_id, c.current_attempt_number, 'CLAIMED',
      ?, ?, ?, ?, ?, 0, ?, ?, ?, ?
    FROM run_execution_claims c
    WHERE c.organization_id = ? AND c.project_id = ? AND c.run_id = ?
      AND c.state = 'ACTIVE'
      AND c.current_attempt_id = ?
      AND c.lease_token_hash = ?
    ON CONFLICT(attempt_id) DO NOTHING
  `).bind(
    attemptId,
    leaseOwnerId,
    leaseTokenHash,
    now,
    leaseExpiresAt,
    now,
    queueMessageId,
    queueDeliveryAttempt,
    now,
    now,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
  );

  const results = typeof db.batch === 'function'
    ? await db.batch([abandonExpired, acquire, insertAttempt])
    : [await abandonExpired.run(), await acquire.run(), await insertAttempt.run()];

  const claim = await getRunExecutionClaim(env, organizationId, projectId, runId);
  const acquired = claim?.state === 'ACTIVE'
    && claim?.currentAttemptId === attemptId
    && claim?.leaseTokenHash === leaseTokenHash;

  if (!acquired) {
    return {
      acquired: false,
      claim,
      acquireChanges: changes(results?.[1]),
      attempt: claim?.currentAttemptId
        ? await getLatestRunExecutionAttempt(env, organizationId, projectId, runId)
        : null,
    };
  }

  return {
    acquired: true,
    claim,
    acquireChanges: changes(results?.[1]),
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
  };
}

export async function heartbeatRunExecution(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  heartbeatAt,
  leaseExpiresAt,
}) {
  const db = requireDataDb(env);

  const claimUpdate = db.prepare(`
    UPDATE run_execution_claims
    SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND state = 'ACTIVE'
      AND current_attempt_id = ?
      AND lease_token_hash = ?
      AND lease_expires_at > ?
  `).bind(
    leaseExpiresAt,
    heartbeatAt,
    heartbeatAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    heartbeatAt,
  );

  const attemptUpdate = db.prepare(`
    UPDATE run_execution_attempts
    SET lease_expires_at = ?, heartbeat_at = ?, heartbeat_count = heartbeat_count + 1, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
  `).bind(
    leaseExpiresAt,
    heartbeatAt,
    heartbeatAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
  );

  const results = typeof db.batch === 'function'
    ? await db.batch([claimUpdate, attemptUpdate])
    : [await claimUpdate.run(), await attemptUpdate.run()];

  return {
    updated: changes(results?.[0]) === 1,
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
  };
}

export async function markRunExecutionRetry(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  errorCode,
  retryAt,
  nextRetryAt,
}) {
  const db = requireDataDb(env);

  const attemptUpdate = db.prepare(`
    UPDATE run_execution_attempts
    SET status = 'RETRYABLE',
        last_error_code = ?,
        next_retry_at = ?,
        terminal_at = ?,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
  `).bind(
    errorCode,
    nextRetryAt,
    retryAt,
    retryAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
  );

  const claimRelease = db.prepare(`
    UPDATE run_execution_claims
    SET state = 'IDLE',
        current_attempt_id = NULL,
        lease_owner_id = NULL,
        lease_token_hash = NULL,
        lease_expires_at = NULL,
        heartbeat_at = NULL,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND state = 'ACTIVE'
      AND current_attempt_id = ?
      AND lease_token_hash = ?
  `).bind(retryAt, organizationId, projectId, runId, attemptId, leaseTokenHash);

  const dispatchUpdate = db.prepare(`
    UPDATE run_queue_dispatches
    SET last_error_code = ?, last_error_at = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(errorCode, retryAt, retryAt, organizationId, projectId, runId);

  const results = typeof db.batch === 'function'
    ? await db.batch([attemptUpdate, claimRelease, dispatchUpdate])
    : [await attemptUpdate.run(), await claimRelease.run(), await dispatchUpdate.run()];

  return {
    updated: changes(results?.[0]) === 1 && changes(results?.[1]) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
  };
}

export async function markRunExecutionReceived(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  receivedAt,
}) {
  const db = requireDataDb(env);

  const attemptUpdate = db.prepare(`
    UPDATE run_execution_attempts
    SET status = 'RECEIVED',
        received_at = COALESCE(received_at, ?),
        terminal_at = COALESCE(terminal_at, ?),
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
  `).bind(
    receivedAt,
    receivedAt,
    receivedAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
  );

  const claimRelease = db.prepare(`
    UPDATE run_execution_claims
    SET state = 'IDLE',
        current_attempt_id = NULL,
        lease_owner_id = NULL,
        lease_token_hash = NULL,
        lease_expires_at = NULL,
        heartbeat_at = NULL,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND state = 'ACTIVE'
      AND current_attempt_id = ?
      AND lease_token_hash = ?
  `).bind(receivedAt, organizationId, projectId, runId, attemptId, leaseTokenHash);

  const dispatchUpdate = db.prepare(`
    UPDATE run_queue_dispatches
    SET status = 'RECEIVED',
        published_at = COALESCE(published_at, ?),
        runner_received_at = COALESCE(runner_received_at, ?),
        last_error_code = NULL,
        last_error_at = NULL,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(receivedAt, receivedAt, receivedAt, organizationId, projectId, runId);

  const runUpdate = db.prepare(`
    UPDATE runs
    SET status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM run_execution_attempts a
            WHERE a.organization_id = ? AND a.project_id = ? AND a.run_id = ?
              AND a.attempt_id = ?
              AND a.assertion_execution_status = 'COMPLETED'
              AND a.assertion_outcome IN ('PASSED', 'FAILED', 'ERROR')
          ) THEN (
            SELECT a.assertion_outcome
            FROM run_execution_attempts a
            WHERE a.organization_id = ? AND a.project_id = ? AND a.run_id = ?
              AND a.attempt_id = ?
            LIMIT 1
          )
          WHEN status = 'CREATED' THEN 'QUEUED'
          ELSE status
        END,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(
    organizationId,
    projectId,
    runId,
    attemptId,
    organizationId,
    projectId,
    runId,
    attemptId,
    receivedAt,
    organizationId,
    projectId,
    runId,
  );

  const results = typeof db.batch === 'function'
    ? await db.batch([attemptUpdate, claimRelease, dispatchUpdate, runUpdate])
    : [await attemptUpdate.run(), await claimRelease.run(), await dispatchUpdate.run(), await runUpdate.run()];

  return {
    updated: changes(results?.[0]) === 1 && changes(results?.[1]) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
  };
}

export async function markRunExecutionCancelled(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  cancelledAt,
}) {
  const db = requireDataDb(env);
  const attemptUpdate = db.prepare(`
    UPDATE run_execution_attempts
    SET status = 'CANCELLED', terminal_at = COALESCE(terminal_at, ?), updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED' AND lease_token_hash = ?
  `).bind(cancelledAt, cancelledAt, organizationId, projectId, runId, attemptId, leaseTokenHash);
  const claimRelease = db.prepare(`
    UPDATE run_execution_claims
    SET state = 'IDLE', current_attempt_id = NULL, lease_owner_id = NULL,
        lease_token_hash = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND state = 'ACTIVE' AND current_attempt_id = ? AND lease_token_hash = ?
  `).bind(cancelledAt, organizationId, projectId, runId, attemptId, leaseTokenHash);
  const results = typeof db.batch === 'function'
    ? await db.batch([attemptUpdate, claimRelease])
    : [await attemptUpdate.run(), await claimRelease.run()];
  return {
    updated: changes(results?.[0]) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
  };
}


export async function markRunExecutionRuntimeReady(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  runtimePlanHash,
  targetCount,
  resolutionSource,
  resolutionConfidence,
  materializedAt,
}) {
  const db = requireDataDb(env);
  const result = await db.prepare(`
    UPDATE run_execution_attempts
    SET runtime_readiness_status = 'READY',
        runtime_plan_hash = ?,
        runtime_target_count = ?,
        runtime_resolution_source = ?,
        runtime_resolution_confidence = ?,
        runtime_materialized_at = ?,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
      AND lease_expires_at > ?
      AND EXISTS (
        SELECT 1
        FROM run_execution_claims c
        WHERE c.organization_id = ? AND c.project_id = ? AND c.run_id = ?
          AND c.state = 'ACTIVE'
          AND c.current_attempt_id = ?
          AND c.lease_token_hash = ?
          AND c.lease_expires_at > ?
      )
  `).bind(
    runtimePlanHash,
    targetCount,
    resolutionSource,
    resolutionConfidence,
    materializedAt,
    materializedAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    materializedAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    materializedAt,
  ).run();

  return {
    updated: changes(result) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
  };
}

export async function markRunExecutionRejected(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  errorCode,
  rejectedAt,
}) {
  const db = requireDataDb(env);
  const attemptUpdate = db.prepare(`
    UPDATE run_execution_attempts
    SET status = 'REJECTED',
        last_error_code = ?,
        terminal_at = COALESCE(terminal_at, ?),
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
  `).bind(errorCode, rejectedAt, rejectedAt, organizationId, projectId, runId, attemptId, leaseTokenHash);

  const claimRelease = db.prepare(`
    UPDATE run_execution_claims
    SET state = 'IDLE', current_attempt_id = NULL, lease_owner_id = NULL,
        lease_token_hash = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND state = 'ACTIVE' AND current_attempt_id = ? AND lease_token_hash = ?
  `).bind(rejectedAt, organizationId, projectId, runId, attemptId, leaseTokenHash);

  const dispatchUpdate = db.prepare(`
    UPDATE run_queue_dispatches
    SET status = 'RECEIVED', runner_received_at = COALESCE(runner_received_at, ?),
        last_error_code = ?, last_error_at = ?, updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(rejectedAt, errorCode, rejectedAt, rejectedAt, organizationId, projectId, runId);

  const runUpdate = db.prepare(`
    UPDATE runs SET status = 'ERROR', updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND status IN ('CREATED', 'QUEUED')
  `).bind(rejectedAt, organizationId, projectId, runId);

  const results = typeof db.batch === 'function'
    ? await db.batch([attemptUpdate, claimRelease, dispatchUpdate, runUpdate])
    : [await attemptUpdate.run(), await claimRelease.run(), await dispatchUpdate.run(), await runUpdate.run()];

  return {
    updated: changes(results?.[0]) === 1 && changes(results?.[1]) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
  };
}


export async function markRunExecutionHttpExecuted(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  runtimePlanHash,
  requestCount,
  responseCount,
  networkErrorCount,
  timeoutCount,
  redirectCount,
  durationMs,
  responseStatusCounts = {},
  primaryDiagnostic = null,
  executedAt,
}) {
  const db = requireDataDb(env);
  const result = await db.prepare(`
    UPDATE run_execution_attempts
    SET http_execution_status = 'COMPLETED',
        http_request_count = ?,
        http_response_count = ?,
        http_network_error_count = ?,
        http_timeout_count = ?,
        http_redirect_count = ?,
        http_duration_ms = ?,
        http_executed_at = ?,
        http_response_2xx_count = ?,
        http_response_3xx_count = ?,
        http_response_4xx_count = ?,
        http_response_5xx_count = ?,
        http_primary_diagnostic_kind = ?,
        http_primary_scenario_id = ?,
        http_primary_status_code = ?,
        http_primary_error_code = ?,
        http_primary_error_category = ?,
        http_primary_error_name = ?,
        http_primary_cause_code = ?,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
      AND lease_expires_at > ?
      AND runtime_readiness_status = 'READY'
      AND runtime_plan_hash = ?
      AND EXISTS (
        SELECT 1
        FROM run_execution_claims c
        WHERE c.organization_id = ? AND c.project_id = ? AND c.run_id = ?
          AND c.state = 'ACTIVE'
          AND c.current_attempt_id = ?
          AND c.lease_token_hash = ?
          AND c.lease_expires_at > ?
      )
  `).bind(
    requestCount,
    responseCount,
    networkErrorCount,
    timeoutCount,
    redirectCount,
    durationMs,
    executedAt,
    Number(responseStatusCounts.response2xxCount || 0),
    Number(responseStatusCounts.response3xxCount || 0),
    Number(responseStatusCounts.response4xxCount || 0),
    Number(responseStatusCounts.response5xxCount || 0),
    primaryDiagnostic?.kind || null,
    primaryDiagnostic?.scenarioId || null,
    primaryDiagnostic?.statusCode == null ? null : Number(primaryDiagnostic.statusCode),
    primaryDiagnostic?.errorCode || null,
    primaryDiagnostic?.errorCategory || null,
    primaryDiagnostic?.errorName || null,
    primaryDiagnostic?.causeCode || null,
    executedAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    executedAt,
    runtimePlanHash,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    executedAt,
  ).run();

  return {
    updated: changes(result) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
  };
}

export async function markRunAssertionsEvaluated(env, {
  organizationId,
  projectId,
  runId,
  attemptId,
  leaseTokenHash,
  runtimePlanHash,
  outcome,
  scenarioCount,
  scenarioPassedCount,
  scenarioFailedCount,
  scenarioNotEvaluatedCount,
  assertionCount,
  assertionPassedCount,
  assertionFailedCount,
  assertionNotEvaluatedCount,
  durationMs,
  primaryDiagnostic = null,
  evaluatedAt,
}) {
  const db = requireDataDb(env);
  const attemptUpdate = db.prepare(`
    UPDATE run_execution_attempts
    SET assertion_execution_status = 'COMPLETED',
        assertion_outcome = ?,
        assertion_scenario_count = ?,
        assertion_scenario_passed_count = ?,
        assertion_scenario_failed_count = ?,
        assertion_scenario_not_evaluated_count = ?,
        assertion_count = ?,
        assertion_passed_count = ?,
        assertion_failed_count = ?,
        assertion_not_evaluated_count = ?,
        assertion_duration_ms = ?,
        assertion_evaluated_at = ?,
        assertion_primary_diagnostic_kind = ?,
        assertion_primary_scenario_id = ?,
        assertion_primary_index = ?,
        assertion_primary_type = ?,
        assertion_primary_error_code = ?,
        assertion_primary_path = ?,
        assertion_primary_header_name = ?,
        assertion_primary_schema_ref = ?,
        assertion_primary_actual_status_code = ?,
        assertion_primary_actual_content_type = ?,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
      AND attempt_id = ? AND status = 'CLAIMED'
      AND lease_token_hash = ?
      AND lease_expires_at > ?
      AND runtime_readiness_status = 'READY'
      AND runtime_plan_hash = ?
      AND http_execution_status = 'COMPLETED'
      AND EXISTS (
        SELECT 1
        FROM run_execution_claims c
        WHERE c.organization_id = ? AND c.project_id = ? AND c.run_id = ?
          AND c.state = 'ACTIVE'
          AND c.current_attempt_id = ?
          AND c.lease_token_hash = ?
          AND c.lease_expires_at > ?
      )
  `).bind(
    outcome,
    scenarioCount,
    scenarioPassedCount,
    scenarioFailedCount,
    scenarioNotEvaluatedCount,
    assertionCount,
    assertionPassedCount,
    assertionFailedCount,
    assertionNotEvaluatedCount,
    durationMs,
    evaluatedAt,
    primaryDiagnostic?.kind || null,
    primaryDiagnostic?.scenarioId || null,
    primaryDiagnostic?.assertionIndex == null ? null : Number(primaryDiagnostic.assertionIndex),
    primaryDiagnostic?.assertionType || null,
    primaryDiagnostic?.errorCode || null,
    primaryDiagnostic?.path || null,
    primaryDiagnostic?.headerName || null,
    primaryDiagnostic?.schemaRef || null,
    primaryDiagnostic?.actualStatusCode == null ? null : Number(primaryDiagnostic.actualStatusCode),
    primaryDiagnostic?.actualContentType || null,
    evaluatedAt,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    evaluatedAt,
    runtimePlanHash,
    organizationId,
    projectId,
    runId,
    attemptId,
    leaseTokenHash,
    evaluatedAt,
  );

  // Persist the semantic assertion outcome while the lease is still active, but do not
  // make the Run terminal yet. The final Run status is committed atomically with
  // attempt RECEIVED + claim release in markRunExecutionReceived(). This removes the
  // crash window where a terminal Run could be ACKed on redelivery while its lease
  // and dispatch were still unfinished.
  const result = await attemptUpdate.run();

  return {
    updated: changes(result) === 1,
    attempt: await getLatestRunExecutionAttempt(env, organizationId, projectId, runId),
    claim: await getRunExecutionClaim(env, organizationId, projectId, runId),
  };
}


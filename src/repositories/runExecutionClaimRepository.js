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
    SET status = CASE WHEN status = 'CREATED' THEN 'QUEUED' ELSE status END,
        updated_at = ?
    WHERE organization_id = ? AND project_id = ? AND run_id = ?
  `).bind(receivedAt, organizationId, projectId, runId);

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

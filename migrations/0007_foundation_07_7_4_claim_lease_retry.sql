PRAGMA foreign_keys = ON;

-- Foundation 07.7.4 — Claim / Lease / Retry
-- Adds durable execution-attempt history and one current claim row per Run.
-- Lease tokens are never persisted in plaintext; only SHA-256 hashes are stored.

CREATE TABLE IF NOT EXISTS run_execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL
    CHECK (status IN ('CLAIMED', 'RECEIVED', 'RETRYABLE', 'ABANDONED', 'REJECTED', 'CANCELLED')),

  lease_owner_id TEXT NOT NULL,
  lease_token_hash TEXT NOT NULL,
  lease_acquired_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  heartbeat_at TEXT,
  heartbeat_count INTEGER NOT NULL DEFAULT 0 CHECK (heartbeat_count >= 0),

  queue_message_id TEXT,
  queue_delivery_attempt INTEGER CHECK (queue_delivery_attempt IS NULL OR queue_delivery_attempt >= 1),

  last_error_code TEXT,
  next_retry_at TEXT,
  received_at TEXT,
  terminal_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (organization_id, project_id, run_id, attempt_number),
  FOREIGN KEY (organization_id, project_id, run_id)
    REFERENCES runs(organization_id, project_id, run_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_execution_attempts_run_number
  ON run_execution_attempts(organization_id, project_id, run_id, attempt_number DESC);

CREATE INDEX IF NOT EXISTS idx_run_execution_attempts_status_lease
  ON run_execution_attempts(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS run_execution_claims (
  run_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'IDLE' CHECK (state IN ('IDLE', 'ACTIVE')),
  current_attempt_id TEXT,
  current_attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (current_attempt_number >= 0),
  lease_owner_id TEXT,
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (organization_id, project_id, run_id),
  FOREIGN KEY (organization_id, project_id, run_id)
    REFERENCES runs(organization_id, project_id, run_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_execution_claims_active_expiry
  ON run_execution_claims(state, lease_expires_at);

PRAGMA foreign_keys = ON;

-- Foundation 07.7.3 — Queue + qagent-runner Foundation
-- Durable dispatch metadata only. Queue delivery remains at-least-once.

CREATE TABLE IF NOT EXISTS run_queue_dispatches (
  run_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contract_version TEXT NOT NULL DEFAULT 'qagent.run-requested.v1'
    CHECK (contract_version = 'qagent.run-requested.v1'),
  execution_plan_id TEXT NOT NULL,
  runtime_snapshot_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PUBLISHED', 'RECEIVED')),
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempt_count >= 0),
  published_at TEXT,
  runner_received_at TEXT,
  last_error_code TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (organization_id, project_id, run_id),
  FOREIGN KEY (organization_id, project_id, run_id)
    REFERENCES runs(organization_id, project_id, run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, execution_plan_id)
    REFERENCES execution_plans(organization_id, project_id, execution_plan_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id, runtime_snapshot_id)
    REFERENCES runtime_snapshots(organization_id, project_id, runtime_snapshot_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_run_queue_dispatches_project_status
  ON run_queue_dispatches(organization_id, project_id, status, updated_at DESC);

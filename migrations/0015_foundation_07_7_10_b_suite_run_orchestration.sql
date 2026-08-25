-- QAgent Foundation 07.7.10-B — Suite Run Contract + Durable Orchestration

CREATE TABLE IF NOT EXISTS suite_runs (
  suite_run_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  suite_id TEXT NOT NULL,
  suite_version_id TEXT NOT NULL,
  suite_version INTEGER NOT NULL,
  suite_inventory_fingerprint TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED','QUEUED','DISPATCHING','RUNNING','PASSED','FAILED','ERROR','CANCELLED')),
  endpoint_count INTEGER NOT NULL,
  scenario_count INTEGER NOT NULL,
  confirm_discovered_runtime INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_at TEXT,
  UNIQUE (organization_id, project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_suite_runs_project_created
  ON suite_runs (organization_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suite_runs_project_status
  ON suite_runs (organization_id, project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_suite_runs_suite_version
  ON suite_runs (organization_id, project_id, suite_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS suite_run_dispatches (
  suite_run_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','PUBLISHED','PROCESSING','COMPLETED','FAILED')),
  cursor INTEGER NOT NULL DEFAULT 0,
  dispatch_attempt_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (suite_run_id) REFERENCES suite_runs(suite_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suite_run_dispatches_project_status
  ON suite_run_dispatches (organization_id, project_id, status, updated_at);

CREATE TABLE IF NOT EXISTS suite_run_children (
  suite_run_child_id TEXT PRIMARY KEY,
  suite_run_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  endpoint_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  test_design_version INTEGER NOT NULL,
  scenario_count INTEGER NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUN_CREATED','CREATE_ERROR')),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (suite_run_id, ordinal),
  UNIQUE (run_id),
  FOREIGN KEY (suite_run_id) REFERENCES suite_runs(suite_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suite_run_children_parent
  ON suite_run_children (organization_id, project_id, suite_run_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_suite_run_children_run
  ON suite_run_children (run_id);

-- UI-EXEC-2. Durable wakeup does not transfer browser ownership; claims in
-- ui_execution_items remain the only authority to execute an observation.
CREATE TABLE IF NOT EXISTS ui_execution_dispatches (
  batch_id TEXT PRIMARY KEY REFERENCES ui_execution_batches(batch_id),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','COMPLETE','UNAVAILABLE')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  lease_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ui_execution_dispatches_due ON ui_execution_dispatches(status,next_attempt_at,lease_until);

-- Admission intent is committed before either API/UI child is created. A
-- recoverable transport failure cannot orphan the second half of a click.
CREATE TABLE IF NOT EXISTS automation_runs (
  automation_run_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_by TEXT,
  api_admission TEXT NOT NULL CHECK(api_admission IN ('NOT_REQUESTED','PENDING','ADMITTED','ERROR')),
  api_child_id TEXT,
  api_error TEXT,
  ui_admission TEXT NOT NULL CHECK(ui_admission IN ('NOT_REQUESTED','PENDING','ADMITTED','ERROR')),
  ui_child_id TEXT,
  ui_error TEXT,
  admission_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  lease_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(organization_id,project_id,environment_id,operation_id)
);
CREATE INDEX IF NOT EXISTS automation_runs_scope ON automation_runs(organization_id,project_id,environment_id,created_at DESC,automation_run_id DESC);
CREATE INDEX IF NOT EXISTS automation_runs_due ON automation_runs(next_attempt_at,lease_until) WHERE api_admission='PENDING' OR ui_admission='PENDING';

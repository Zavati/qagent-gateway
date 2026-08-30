-- QAgent Foundation 07.7.10-B FIX-2 — Mutation Safety Contract
-- Policy + Journal + environment-specific Suite Run eligibility. Business mutation HTTP remains disabled.

CREATE TABLE IF NOT EXISTS mutation_execution_policies (
  policy_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  latest_version INTEGER NOT NULL DEFAULT 0,
  latest_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, environment_id, endpoint_id, method)
);
CREATE INDEX IF NOT EXISTS idx_mutation_policies_scope
  ON mutation_execution_policies (organization_id, project_id, environment_id, endpoint_id, method, status);

CREATE TABLE IF NOT EXISTS mutation_execution_policy_versions (
  policy_version_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  version INTEGER NOT NULL,
  execution_decision TEXT NOT NULL CHECK (execution_decision IN ('ALLOW','DENY')),
  retry_mode TEXT NOT NULL CHECK (retry_mode IN ('NO_AUTOMATIC_RETRY','IDEMPOTENCY_HEADER')),
  idempotency_header_name TEXT,
  production_confirmation INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES mutation_execution_policies(policy_id) ON DELETE CASCADE,
  UNIQUE (policy_id, version)
);
CREATE INDEX IF NOT EXISTS idx_mutation_policy_versions_scope
  ON mutation_execution_policy_versions (organization_id, project_id, environment_id, endpoint_id, method, version DESC);

CREATE TABLE IF NOT EXISTS mutation_execution_journal (
  mutation_execution_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  first_attempt_id TEXT NOT NULL,
  latest_attempt_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('POST','PUT','PATCH','DELETE')),
  canonical_path TEXT NOT NULL,
  policy_version_id TEXT,
  retry_mode TEXT NOT NULL CHECK (retry_mode IN ('NO_AUTOMATIC_RETRY','IDEMPOTENCY_HEADER')),
  idempotency_header_name TEXT,
  idempotency_key_hash TEXT,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PREPARED','POLICY_DENIED','FAILED_BEFORE_DISPATCH','DISPATCHING','RESPONSE_RECEIVED','ASSERTED','COMPLETED','UNKNOWN_SIDE_EFFECT')),
  network_dispatch_may_have_occurred INTEGER NOT NULL DEFAULT 0,
  http_status_code INTEGER,
  last_error_code TEXT,
  prepared_at TEXT,
  dispatching_at TEXT,
  response_received_at TEXT,
  asserted_at TEXT,
  completed_at TEXT,
  unknown_side_effect_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, scenario_id)
);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_scope
  ON mutation_execution_journal (organization_id, project_id, environment_id, endpoint_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mutation_journal_run
  ON mutation_execution_journal (run_id, scenario_id, state);

CREATE TABLE IF NOT EXISTS mutation_execution_events (
  event_id TEXT PRIMARY KEY,
  mutation_execution_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  attempt_id TEXT,
  from_state TEXT,
  to_state TEXT NOT NULL,
  event_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (mutation_execution_id) REFERENCES mutation_execution_journal(mutation_execution_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mutation_events_journal
  ON mutation_execution_events (mutation_execution_id, created_at);

CREATE TABLE IF NOT EXISTS suite_run_execution_units (
  execution_unit_id TEXT PRIMARY KEY,
  suite_run_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  source_suite_item_ordinal INTEGER NOT NULL,
  endpoint_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  test_design_version INTEGER NOT NULL,
  method TEXT NOT NULL,
  scenario_ids_json TEXT NOT NULL,
  scenario_count INTEGER NOT NULL,
  execution_kind TEXT NOT NULL CHECK (execution_kind IN ('READ_ONLY_BATCH','MUTATION_SINGLE')),
  decision TEXT NOT NULL CHECK (decision IN ('EXECUTE','POLICY_HOLD')),
  policy_version_id TEXT,
  retry_mode TEXT,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','RUN_CREATED','COMPLETED','ERROR','POLICY_HELD')),
  run_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (suite_run_id, ordinal),
  UNIQUE (run_id),
  FOREIGN KEY (suite_run_id) REFERENCES suite_runs(suite_run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_suite_run_units_parent
  ON suite_run_execution_units (organization_id, project_id, suite_run_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_suite_run_units_decision
  ON suite_run_execution_units (organization_id, project_id, suite_run_id, decision, status);

ALTER TABLE suite_runs ADD COLUMN confirm_production_mutation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN ready_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN executable_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN policy_held_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN read_only_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN mutation_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN mutation_enabled_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN mutation_held_scenario_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN execution_unit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suite_runs ADD COLUMN policy_snapshot_hash TEXT;
ALTER TABLE suite_runs ADD COLUMN eligibility_policy_version TEXT;

-- QAgent 08.1.4 — Continuous Learning Cycle
-- Durable project/suite-run learning projection. No execution payloads or secrets are stored here.

CREATE TABLE IF NOT EXISTS continuous_learning_cycles (
  learning_cycle_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  suite_run_id TEXT NOT NULL,
  suite_version_id TEXT NOT NULL,
  suite_version INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COLLECTING','ANALYZING','VERIFYING','WAITING_REVIEW','COMPLETED')),
  started_at TEXT NOT NULL,
  settled_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, suite_run_id),
  FOREIGN KEY (suite_run_id) REFERENCES suite_runs(suite_run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_cycles_project_updated
  ON continuous_learning_cycles (organization_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_cycles_project_status
  ON continuous_learning_cycles (organization_id, project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS continuous_learning_scenarios (
  learning_scenario_id TEXT PRIMARY KEY,
  learning_cycle_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_result_set_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  source_scenario_result_id TEXT,
  scenario_id TEXT NOT NULL,
  endpoint_id TEXT,
  source_test_design_version_id TEXT,
  source_test_design_version INTEGER,
  source_outcome TEXT,
  http_outcome TEXT,
  status_code INTEGER,
  assertion_failed_count INTEGER NOT NULL DEFAULT 0,
  inspection_state TEXT NOT NULL DEFAULT 'PENDING',
  inspection_eligible INTEGER,
  inspection_reason TEXT,
  request_issue_detected INTEGER NOT NULL DEFAULT 0,
  proposal_id TEXT,
  classification TEXT,
  decision TEXT,
  confidence INTEGER,
  risk_score INTEGER,
  risk_level TEXT,
  auto_action TEXT,
  evolved_test_design_version_id TEXT,
  evolved_test_design_version INTEGER,
  evolution_rerun_run_id TEXT,
  verification_outcome TEXT,
  verification_reason_code TEXT,
  human_repair_id TEXT,
  human_repair_test_design_version_id TEXT,
  human_repair_test_design_version INTEGER,
  human_rerun_run_id TEXT,
  effective_state TEXT NOT NULL DEFAULT 'RECEIVED',
  first_seen_at TEXT NOT NULL,
  analyzed_at TEXT,
  verified_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (learning_cycle_id, source_result_set_id, scenario_id),
  FOREIGN KEY (learning_cycle_id) REFERENCES continuous_learning_cycles(learning_cycle_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_scenarios_cycle_state
  ON continuous_learning_scenarios (learning_cycle_id, effective_state, updated_at);
CREATE INDEX IF NOT EXISTS idx_learning_scenarios_proposal
  ON continuous_learning_scenarios (proposal_id);
CREATE INDEX IF NOT EXISTS idx_learning_scenarios_human_rerun
  ON continuous_learning_scenarios (human_rerun_run_id);
CREATE INDEX IF NOT EXISTS idx_learning_scenarios_source_run
  ON continuous_learning_scenarios (source_run_id);
CREATE INDEX IF NOT EXISTS idx_learning_scenarios_source_result
  ON continuous_learning_scenarios (organization_id, project_id, source_result_set_id, scenario_id);

CREATE TABLE IF NOT EXISTS continuous_learning_events (
  event_id TEXT PRIMARY KEY,
  learning_cycle_id TEXT NOT NULL,
  learning_scenario_id TEXT,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (learning_cycle_id, event_key),
  FOREIGN KEY (learning_cycle_id) REFERENCES continuous_learning_cycles(learning_cycle_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_events_cycle_created
  ON continuous_learning_events (learning_cycle_id, created_at DESC);

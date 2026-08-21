PRAGMA foreign_keys = ON;

-- Foundation 07.7.2 — Run Contract + Execution Plan Foundation
-- Run is mutable lifecycle metadata. Runtime snapshots and execution plans are immutable artifacts.

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,

  contract_version TEXT NOT NULL DEFAULT 'qagent.run.v1'
    CHECK (contract_version = 'qagent.run.v1'),

  test_design_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  test_design_version INTEGER NOT NULL CHECK (test_design_version >= 1),
  endpoint_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,

  execution_plan_id TEXT NOT NULL UNIQUE,
  runtime_snapshot_id TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED')),

  scenario_count INTEGER NOT NULL CHECK (scenario_count >= 1),
  scenario_ids_json TEXT NOT NULL,

  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,

  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  UNIQUE (organization_id, project_id, idempotency_key),
  UNIQUE (organization_id, project_id, run_id),

  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_runs_project_created
  ON runs(organization_id, project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_project_status
  ON runs(organization_id, project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_test_design_version
  ON runs(organization_id, project_id, test_design_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runtime_snapshots (
  runtime_snapshot_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,

  contract_version TEXT NOT NULL
    CHECK (contract_version = 'qagent.runtime-snapshot.v1'),
  resolution_source TEXT NOT NULL
    CHECK (resolution_source IN ('EXPLICIT_CONFIG', 'DISCOVERED_OBSERVATION')),
  resolution_confidence TEXT NOT NULL
    CHECK (resolution_confidence IN ('CONFIRMED', 'HIGH', 'MEDIUM', 'LOW')),
  requires_execution_confirmation INTEGER NOT NULL DEFAULT 0
    CHECK (requires_execution_confirmation IN (0, 1)),

  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,

  UNIQUE (organization_id, project_id, runtime_snapshot_id),
  FOREIGN KEY (organization_id, project_id, run_id)
    REFERENCES runs(organization_id, project_id, run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_runtime_snapshots_project_environment
  ON runtime_snapshots(organization_id, project_id, environment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_plans (
  execution_plan_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  runtime_snapshot_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,

  contract_version TEXT NOT NULL
    CHECK (contract_version = 'qagent.execution-plan.v1'),
  plan_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  scenario_count INTEGER NOT NULL CHECK (scenario_count >= 1),
  schema_snapshot_count INTEGER NOT NULL DEFAULT 0 CHECK (schema_snapshot_count >= 0),
  created_at TEXT NOT NULL,

  UNIQUE (organization_id, project_id, execution_plan_id),
  FOREIGN KEY (organization_id, project_id, run_id)
    REFERENCES runs(organization_id, project_id, run_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, runtime_snapshot_id)
    REFERENCES runtime_snapshots(organization_id, project_id, runtime_snapshot_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_execution_plans_test_design_version
  ON execution_plans(organization_id, project_id, test_design_version_id, created_at DESC);

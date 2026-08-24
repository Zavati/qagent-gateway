PRAGMA foreign_keys = ON;

-- Foundation 07.7.8-C — Test Data Runtime
-- Scope hierarchy (low -> high precedence): PROJECT -> ENVIRONMENT -> ENDPOINT.
-- ENDPOINT is intentionally environment-bound in v1 so real IDs/codes cannot
-- silently cross environment boundaries.
CREATE TABLE IF NOT EXISTS test_data_bindings (
  binding_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('PROJECT', 'ENVIRONMENT', 'ENDPOINT')),
  environment_id TEXT,
  endpoint_id TEXT,
  target TEXT NOT NULL CHECK (target IN ('BODY', 'PATH_PARAM', 'QUERY')),
  selector TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('GENERATED', 'FIXED', 'SECRET')),
  value_type TEXT NOT NULL DEFAULT 'STRING' CHECK (value_type IN ('STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'JSON')),
  generator_kind TEXT,
  generator_config_json TEXT,
  fixed_value_json TEXT,
  secret_id TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope_type = 'PROJECT' AND environment_id IS NULL AND endpoint_id IS NULL)
    OR (scope_type = 'ENVIRONMENT' AND environment_id IS NOT NULL AND endpoint_id IS NULL)
    OR (scope_type = 'ENDPOINT' AND environment_id IS NOT NULL AND endpoint_id IS NOT NULL)
  ),
  UNIQUE (organization_id, project_id, binding_id),
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, secret_id)
    REFERENCES secrets(organization_id, project_id, secret_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_data_binding_project_active
  ON test_data_bindings(organization_id, project_id, target, selector)
  WHERE status = 'active' AND scope_type = 'PROJECT';

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_data_binding_environment_active
  ON test_data_bindings(organization_id, project_id, environment_id, target, selector)
  WHERE status = 'active' AND scope_type = 'ENVIRONMENT';

CREATE UNIQUE INDEX IF NOT EXISTS idx_test_data_binding_endpoint_active
  ON test_data_bindings(organization_id, project_id, environment_id, endpoint_id, target, selector)
  WHERE status = 'active' AND scope_type = 'ENDPOINT';

CREATE INDEX IF NOT EXISTS idx_test_data_binding_endpoint_lookup
  ON test_data_bindings(organization_id, project_id, endpoint_id, environment_id, status, scope_type);

CREATE INDEX IF NOT EXISTS idx_test_data_binding_environment_lookup
  ON test_data_bindings(organization_id, project_id, environment_id, status, scope_type);

CREATE INDEX IF NOT EXISTS idx_test_data_binding_secret
  ON test_data_bindings(organization_id, project_id, secret_id, status);

ALTER TABLE run_execution_attempts ADD COLUMN test_data_runtime_status TEXT
  CHECK (test_data_runtime_status IS NULL OR test_data_runtime_status IN ('COMPLETED'));
ALTER TABLE run_execution_attempts ADD COLUMN test_data_binding_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN test_data_generated_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN test_data_fixed_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN test_data_secret_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN test_data_duration_ms INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN test_data_resolved_at TEXT;

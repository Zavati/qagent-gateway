PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS api_services (
  api_service_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  service_key TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, api_service_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_services_project_status
  ON api_services(organization_id, project_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_services_active_service_key
  ON api_services(organization_id, project_id, service_key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS environment_api_bindings (
  binding_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  api_service_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, environment_id, api_service_id),
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, api_service_id)
    REFERENCES api_services(organization_id, project_id, api_service_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_environment_api_bindings_environment_status
  ON environment_api_bindings(organization_id, project_id, environment_id, status);

CREATE TABLE IF NOT EXISTS environment_variables (
  variable_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  variable_key TEXT NOT NULL,
  variable_value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'STRING' CHECK (value_type IN ('STRING', 'NUMBER', 'BOOLEAN', 'JSON')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, environment_id, variable_id),
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_environment_variables_environment_status
  ON environment_variables(organization_id, project_id, environment_id, status, variable_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_environment_variables_active_key
  ON environment_variables(organization_id, project_id, environment_id, variable_key)
  WHERE status = 'active';

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS secrets (
  secret_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('generic', 'basic', 'api_key', 'oauth2_client_credentials', 'login_http_json')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM' CHECK (algorithm = 'AES-256-GCM'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rotated_at TEXT,
  UNIQUE (organization_id, project_id, secret_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_secrets_project_status
  ON secrets(organization_id, project_id, status, created_at);

CREATE TABLE IF NOT EXISTS auth_profiles (
  auth_profile_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('none', 'basic', 'api_key', 'oauth2_client_credentials', 'login_http_json')),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, auth_profile_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, project_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_profiles_project_status
  ON auth_profiles(organization_id, project_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_profiles_active_profile_key
  ON auth_profiles(organization_id, project_id, profile_key)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS auth_profile_environment_bindings (
  binding_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  auth_profile_id TEXT NOT NULL,
  secret_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, project_id, environment_id, auth_profile_id),
  FOREIGN KEY (organization_id, project_id, environment_id)
    REFERENCES environments(organization_id, project_id, environment_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, auth_profile_id)
    REFERENCES auth_profiles(organization_id, project_id, auth_profile_id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, project_id, secret_id)
    REFERENCES secrets(organization_id, project_id, secret_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_auth_profile_env_bindings_environment
  ON auth_profile_environment_bindings(organization_id, project_id, environment_id, status);

CREATE INDEX IF NOT EXISTS idx_auth_profile_env_bindings_profile
  ON auth_profile_environment_bindings(organization_id, project_id, auth_profile_id, status);

CREATE INDEX IF NOT EXISTS idx_auth_profile_env_bindings_secret
  ON auth_profile_environment_bindings(organization_id, project_id, secret_id, status);

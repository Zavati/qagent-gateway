PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  organization_id TEXT PRIMARY KEY,
  legacy_customer_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_organizations_legacy_customer
  ON organizations(legacy_customer_id);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON organization_members(user_id, status);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, project_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_projects_organization_status
  ON projects(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS environments (
  environment_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  environment_type TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (environment_type IN ('DEV', 'QA', 'STG', 'PROD', 'CUSTOM')),
  web_base_url TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, slug),
  UNIQUE (organization_id, project_id, environment_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_environments_project_status
  ON environments(organization_id, project_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_environments_one_default_per_project
  ON environments(project_id)
  WHERE is_default = 1 AND status = 'active';

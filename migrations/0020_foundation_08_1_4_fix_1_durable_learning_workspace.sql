-- QAgent 08.1.4 FIX-1 — Durable Learning Workspace
-- Adds safe request identity metadata required by the server-side learning inbox.
-- No request literals, headers, secrets or response bodies are persisted here.

ALTER TABLE continuous_learning_scenarios ADD COLUMN request_method TEXT;
ALTER TABLE continuous_learning_scenarios ADD COLUMN request_path TEXT;

CREATE INDEX IF NOT EXISTS idx_learning_cycles_project_environment_started
  ON continuous_learning_cycles (organization_id, project_id, environment_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_scenarios_project_updated
  ON continuous_learning_scenarios (organization_id, project_id, updated_at DESC);

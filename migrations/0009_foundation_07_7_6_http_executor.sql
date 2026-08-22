PRAGMA foreign_keys = ON;

-- Foundation 07.7.6 — HTTP Executor v1
-- Control-plane summary only. Response bodies, request payloads, assertion details and artifacts
-- belong to the dedicated Execution Results Plane, not QAGENT_DB.

ALTER TABLE run_execution_attempts
  ADD COLUMN http_execution_status TEXT
    CHECK (http_execution_status IS NULL OR http_execution_status IN ('COMPLETED'));

ALTER TABLE run_execution_attempts
  ADD COLUMN http_request_count INTEGER
    CHECK (http_request_count IS NULL OR http_request_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_response_count INTEGER
    CHECK (http_response_count IS NULL OR http_response_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_network_error_count INTEGER
    CHECK (http_network_error_count IS NULL OR http_network_error_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_timeout_count INTEGER
    CHECK (http_timeout_count IS NULL OR http_timeout_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_redirect_count INTEGER
    CHECK (http_redirect_count IS NULL OR http_redirect_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_duration_ms INTEGER
    CHECK (http_duration_ms IS NULL OR http_duration_ms >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_executed_at TEXT;

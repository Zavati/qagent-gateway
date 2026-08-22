PRAGMA foreign_keys = ON;

-- Foundation 07.7.6 FIX-1 — HTTP Network Diagnostics
-- Bounded control-plane diagnostics only. No request/response bodies, query values,
-- authorization values, cookies, raw exception messages, or secrets are persisted.

ALTER TABLE run_execution_attempts
  ADD COLUMN http_response_2xx_count INTEGER
    CHECK (http_response_2xx_count IS NULL OR http_response_2xx_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_response_3xx_count INTEGER
    CHECK (http_response_3xx_count IS NULL OR http_response_3xx_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_response_4xx_count INTEGER
    CHECK (http_response_4xx_count IS NULL OR http_response_4xx_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_response_5xx_count INTEGER
    CHECK (http_response_5xx_count IS NULL OR http_response_5xx_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_diagnostic_kind TEXT
    CHECK (
      http_primary_diagnostic_kind IS NULL
      OR http_primary_diagnostic_kind IN ('NETWORK_ERROR', 'TIMEOUT', 'HTTP_RESPONSE')
    );

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_scenario_id TEXT;

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_status_code INTEGER
    CHECK (
      http_primary_status_code IS NULL
      OR (http_primary_status_code >= 100 AND http_primary_status_code <= 599)
    );

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_error_code TEXT;

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_error_category TEXT
    CHECK (
      http_primary_error_category IS NULL
      OR http_primary_error_category IN ('DNS', 'CONNECT', 'TLS', 'RESET', 'ABORT', 'FETCH', 'UNKNOWN', 'TIMEOUT')
    );

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_error_name TEXT;

ALTER TABLE run_execution_attempts
  ADD COLUMN http_primary_cause_code TEXT;

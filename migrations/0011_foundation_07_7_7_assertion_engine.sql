-- QAgent Foundation 07.7.7 — Assertion Engine v1
-- Control Plane stores only bounded assertion summaries. Detailed per-assertion
-- evidence belongs to the Execution Results Plane.

ALTER TABLE run_execution_attempts
  ADD COLUMN assertion_execution_status TEXT
    CHECK (assertion_execution_status IS NULL OR assertion_execution_status IN ('COMPLETED'));

ALTER TABLE run_execution_attempts
  ADD COLUMN assertion_outcome TEXT
    CHECK (assertion_outcome IS NULL OR assertion_outcome IN ('PASSED', 'FAILED', 'ERROR'));

ALTER TABLE run_execution_attempts ADD COLUMN assertion_scenario_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_scenario_passed_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_scenario_failed_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_scenario_not_evaluated_count INTEGER;

ALTER TABLE run_execution_attempts ADD COLUMN assertion_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_passed_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_failed_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_not_evaluated_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_duration_ms INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_evaluated_at TEXT;

ALTER TABLE run_execution_attempts
  ADD COLUMN assertion_primary_diagnostic_kind TEXT
    CHECK (
      assertion_primary_diagnostic_kind IS NULL
      OR assertion_primary_diagnostic_kind IN ('ASSERTION_FAILURE', 'ASSERTION_NOT_EVALUATED')
    );
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_scenario_id TEXT;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_index INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_type TEXT;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_error_code TEXT;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_path TEXT;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_header_name TEXT;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_schema_ref TEXT;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_actual_status_code INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN assertion_primary_actual_content_type TEXT;

PRAGMA foreign_keys = ON;

-- Foundation 07.7.5 — Runtime Integration + Readiness Resolution
-- Stores only control-plane summaries of runtime materialization.
-- Detailed execution evidence/results remain outside QAGENT_DB.

ALTER TABLE run_execution_attempts
  ADD COLUMN runtime_readiness_status TEXT
    CHECK (runtime_readiness_status IS NULL OR runtime_readiness_status IN ('READY', 'BLOCKED'));

ALTER TABLE run_execution_attempts
  ADD COLUMN runtime_plan_hash TEXT;

ALTER TABLE run_execution_attempts
  ADD COLUMN runtime_target_count INTEGER
    CHECK (runtime_target_count IS NULL OR runtime_target_count >= 0);

ALTER TABLE run_execution_attempts
  ADD COLUMN runtime_resolution_source TEXT
    CHECK (runtime_resolution_source IS NULL OR runtime_resolution_source IN ('EXPLICIT_CONFIG', 'DISCOVERED_OBSERVATION'));

ALTER TABLE run_execution_attempts
  ADD COLUMN runtime_resolution_confidence TEXT
    CHECK (runtime_resolution_confidence IS NULL OR runtime_resolution_confidence IN ('CONFIRMED', 'HIGH', 'MEDIUM', 'LOW'));

ALTER TABLE run_execution_attempts
  ADD COLUMN runtime_materialized_at TEXT;

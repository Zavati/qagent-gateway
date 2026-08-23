-- QAgent Foundation 07.7.8 — Auth Runtime
-- Only bounded control-plane summaries are stored. No credential, token,
-- Authorization value, cookie, client secret, password or API key is persisted here.

ALTER TABLE run_execution_attempts
  ADD COLUMN auth_runtime_status TEXT
    CHECK (auth_runtime_status IS NULL OR auth_runtime_status IN ('COMPLETED'));

ALTER TABLE run_execution_attempts ADD COLUMN auth_required_scenario_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN auth_resolved_profile_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN auth_dynamic_exchange_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN auth_cache_hit_count INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN auth_duration_ms INTEGER;
ALTER TABLE run_execution_attempts ADD COLUMN auth_resolved_at TEXT;

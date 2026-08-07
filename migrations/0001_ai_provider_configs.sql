CREATE TABLE IF NOT EXISTS ai_provider_configs (
  config_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  credentials_iv TEXT NOT NULL,
  credentials_key_version TEXT NOT NULL,
  generate_tests_model TEXT,
  autofill_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_configs_account_default
  ON ai_provider_configs(account_id, is_default, enabled);

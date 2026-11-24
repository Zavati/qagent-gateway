-- UI-EXEC-1. Browser work is pulled with a fenced lease; it is never replayed
-- automatically after lease expiry (Live may already have mutated the target).
CREATE TABLE IF NOT EXISTS ui_execution_batches (
  batch_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  target_build_ref TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK(item_count > 0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  UNIQUE(organization_id,project_id,environment_id,operation_id)
);
CREATE INDEX IF NOT EXISTS ui_execution_batches_scope ON ui_execution_batches
  (organization_id,project_id,environment_id,created_at DESC,batch_id DESC);

CREATE TABLE IF NOT EXISTS ui_execution_items (
  item_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES ui_execution_batches(batch_id),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  capture_id TEXT NOT NULL,
  test_design_id TEXT NOT NULL,
  test_design_version_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  source_json TEXT NOT NULL,
  design_key TEXT NOT NULL,
  design_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','COMPLETED','ERROR','CANCELLED')),
  claim_token_hash TEXT,
  worker_id TEXT,
  claimed_at INTEGER,
  lease_expires_at INTEGER,
  result_key TEXT,
  result_hash TEXT,
  gate TEXT NOT NULL DEFAULT 'INCOMPLETE' CHECK(gate IN ('PASSED','FAILED','INCOMPLETE')),
  error_code TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(batch_id,ordinal),
  UNIQUE(batch_id,test_design_version_id)
);
CREATE INDEX IF NOT EXISTS ui_execution_items_pull ON ui_execution_items
  (organization_id,project_id,environment_id,batch_id,status,ordinal);
CREATE INDEX IF NOT EXISTS ui_execution_items_expiry ON ui_execution_items(status,lease_expires_at);

CREATE TABLE IF NOT EXISTS ui_execution_evidence (
  item_id TEXT NOT NULL REFERENCES ui_execution_items(item_id),
  evidence_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  claim_token_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  content_type TEXT NOT NULL,
  page_stats_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(item_id,evidence_id)
);
CREATE INDEX IF NOT EXISTS ui_execution_evidence_scope ON ui_execution_evidence
  (organization_id,project_id,environment_id,batch_id,item_id);

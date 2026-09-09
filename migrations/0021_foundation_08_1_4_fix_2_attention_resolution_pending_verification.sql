-- QAgent 08.1.4 FIX-2 — Attention Resolution & Pending Verification
-- Separates "human action still required" from "action taken, awaiting validation".
-- Existing learning evidence remains immutable; this is a durable projection state only.

ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_status TEXT NOT NULL DEFAULT 'PROCESSING';
ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_resolution_kind TEXT;
ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_resolution_ref_id TEXT;
ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_resolution_test_design_version_id TEXT;
ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_resolution_test_design_version INTEGER;
ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_resolution_at TEXT;
ALTER TABLE continuous_learning_scenarios ADD COLUMN attention_verification_required INTEGER NOT NULL DEFAULT 0;

-- Backfill existing human repairs first. Before FIX-2, a saved repair without rerun stayed
-- REVIEW_REQUIRED, even though the human action was already complete.
UPDATE continuous_learning_scenarios
SET attention_status = CASE
  WHEN human_repair_id IS NOT NULL
       AND effective_state='REVIEW_REQUIRED'
       AND human_rerun_run_id IS NULL THEN 'PENDING_VERIFICATION'
  WHEN effective_state IN ('REVIEW_REQUIRED','NOT_RECOVERED','VERIFICATION_BLOCKED','HUMAN_REPAIR_NOT_RECOVERED','HUMAN_VERIFICATION_BLOCKED') THEN 'OPEN'
  WHEN effective_state IN ('VERIFYING','HUMAN_VERIFYING','PENDING_VERIFICATION') THEN 'PENDING_VERIFICATION'
  WHEN effective_state IN ('HEALTHY','NO_EVOLUTION','RECOVERED_BY_EVOLUTION','RECOVERED_BY_HUMAN_REPAIR') THEN 'RESOLVED'
  ELSE 'PROCESSING'
END,
attention_resolution_kind = CASE WHEN human_repair_id IS NOT NULL THEN 'HUMAN_REQUEST_REPAIR' ELSE NULL END,
attention_resolution_ref_id = human_repair_id,
attention_resolution_test_design_version_id = human_repair_test_design_version_id,
attention_resolution_test_design_version = human_repair_test_design_version,
attention_resolution_at = CASE WHEN human_repair_id IS NOT NULL THEN updated_at ELSE NULL END,
attention_verification_required = CASE
  WHEN human_repair_id IS NOT NULL AND effective_state='REVIEW_REQUIRED' AND human_rerun_run_id IS NULL THEN 1
  WHEN effective_state IN ('VERIFYING','HUMAN_VERIFYING','PENDING_VERIFICATION') THEN 1
  ELSE 0
END;

CREATE INDEX IF NOT EXISTS idx_learning_scenarios_attention_status
  ON continuous_learning_scenarios (organization_id, project_id, attention_status, updated_at DESC);

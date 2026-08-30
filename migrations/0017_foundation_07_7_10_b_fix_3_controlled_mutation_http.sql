-- QAgent Foundation 07.7.10-B FIX-3 — Controlled Mutation HTTP
-- Existing migrations are immutable. This migration only extends the durable mutation journal.

ALTER TABLE mutation_execution_journal ADD COLUMN dispatch_fingerprint TEXT
  CHECK (dispatch_fingerprint IS NULL OR length(dispatch_fingerprint) = 64);

ALTER TABLE mutation_execution_journal ADD COLUMN assertion_outcome TEXT
  CHECK (assertion_outcome IS NULL OR assertion_outcome IN ('PASSED','FAILED','NOT_EVALUATED'));

CREATE INDEX IF NOT EXISTS idx_mutation_journal_state_updated
  ON mutation_execution_journal (organization_id, project_id, state, updated_at DESC);

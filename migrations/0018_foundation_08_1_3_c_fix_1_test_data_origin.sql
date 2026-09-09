-- QAgent 08.1.3-C FIX-1 — Origin-Aware Fixed Request Data
-- Persist who/what authored a configured Test Data binding without changing source semantics.
-- Existing rows created through Console already have created_by_user_id and are backfilled as USER_DEFINED.

ALTER TABLE test_data_bindings
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN'
  CHECK (origin IN ('USER_DEFINED', 'AI_GENERATED', 'SYSTEM_DERIVED', 'LEGACY_UNKNOWN'));

UPDATE test_data_bindings
SET origin = 'USER_DEFINED'
WHERE created_by_user_id IS NOT NULL
  AND origin = 'LEGACY_UNKNOWN';

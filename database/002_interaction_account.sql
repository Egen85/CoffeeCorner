-- ============================================================================
-- Coffee Corner — Migration 002
-- Link interactions to their account (interactions are anchored to the
-- account, with the site as a secondary locator when one exists).
-- Additive/nullable: existing rows are unaffected.
-- ============================================================================

ALTER TABLE interactions ADD COLUMN IF NOT EXISTS account_id INT REFERENCES accounts(id);
CREATE INDEX IF NOT EXISTS idx_interactions_account ON interactions(account_id);

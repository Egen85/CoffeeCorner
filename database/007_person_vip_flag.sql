-- ============================================================================
-- Coffee Corner — Migration 007
-- Person-level VIP flag, additive/defaulted, no data loss.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- VIP status currently only lives on accounts (accounts.is_vip), but several
-- accounts have a specific person who should trigger high-priority handling
-- even though the account itself isn't broadly VIP — e.g. Jenna Cahill at
-- 320 N Sangamon: the site/account isn't VIP, but her being CC'd on a thread
-- is a deliberate escalation signal regardless of tone. Mirrors
-- is_primary_account_holder / is_billing_contact / is_correspondent as a
-- clean per-relationship boolean rather than free text in role_label.
-- ---------------------------------------------------------------------------
ALTER TABLE person_account ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE;

UPDATE person_account SET is_vip = TRUE WHERE person_id = 16 AND account_id = 7;

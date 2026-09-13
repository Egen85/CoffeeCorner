-- ============================================================================
-- Coffee Corner — Migration 008
-- "Since" field on people, additive/nullable, no data loss.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tracks how long the company has known a person (e.g. Marb Jones, a client
-- since 2014 per SharePoint proposal history). Year-only rather than a full
-- date, since this is almost always known approximately, not to the day.
-- Per Will (2026-09-04): forward-looking only — fill it in as new people are
-- added or existing records are checked/re-checked, no backfill sweep.
-- ---------------------------------------------------------------------------
ALTER TABLE people ADD COLUMN IF NOT EXISTS client_since_year INTEGER;

UPDATE people SET client_since_year = 2014 WHERE id = (
    SELECT p.id FROM people p
    JOIN person_account pa ON pa.person_id = p.id
    JOIN accounts a ON a.id = pa.account_id
    WHERE a.name = 'Jones' AND p.first_name = 'Maribeth'
);

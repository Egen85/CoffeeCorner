-- ============================================================================
-- Coffee Corner — Migration 009
-- Vendor contacts: mirrors the Memory/vendors/ markdown work (2026-09-04) —
-- people who work for a vendor company get tracked in Coffee Corner too, via a
-- person_vendor junction table parallel to person_account. Additive/nullable
-- throughout, no data loss.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A person can be linked to a vendor the same way they're linked to an
-- account. Most vendor contacts (manufacturer reps, trade subcontractors)
-- only ever get a vendor link, but a few are genuinely dual — e.g. Diana
-- Ramos (Titan Security) is embedded full-time at 320 N Sangamon, so her
-- existing `people` row gets BOTH a person_account row (already there) and
-- a person_vendor row (added by this migration's data pass), rather than a
-- duplicate person record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_vendor (
    person_id INT REFERENCES people(id),
    vendor_id INT REFERENCES vendors(id),
    role_label VARCHAR(100),
    notes TEXT,
    PRIMARY KEY (person_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_person_vendor_vendor ON person_vendor(vendor_id);
CREATE INDEX IF NOT EXISTS idx_person_vendor_person ON person_vendor(person_id);

-- ---------------------------------------------------------------------------
-- vendors.address — several vendor companies now on file have a known
-- physical address (found via web research); no column previously existed
-- to hold it.
-- ---------------------------------------------------------------------------
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address TEXT;

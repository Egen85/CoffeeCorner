-- ============================================================================
-- Coffee Corner — Migration 003
-- Closes four gaps found in the Deng/Bednyak pilot entries. Additive and
-- nullable/defaulted throughout — no existing rows affected, no data loss.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Account-level correspondent role.
--    person_account currently only has is_primary_account_holder /
--    is_billing_contact. Bednyak's Mary Kate Lloyd is neither — she's the
--    estate manager Sound Specialists actually deals with — so right now
--    she can only be captured at the site level as property_manager, which
--    undersells her actual role.
-- ---------------------------------------------------------------------------
ALTER TABLE person_account ADD COLUMN IF NOT EXISTS is_correspondent BOOLEAN DEFAULT FALSE;
ALTER TABLE person_account ADD COLUMN IF NOT EXISTS role_label VARCHAR(100);
-- role_label holds things like "Estate Manager", "Attorney", "Trustee" —
-- free text because the real-world titles are too varied for a fixed enum,
-- but is_correspondent stays a clean boolean so "who do we actually talk to
-- for this account" is a one-column filter.

-- ---------------------------------------------------------------------------
-- 2) Multi-participant interactions.
--    interactions.person_id caps every interaction at ONE person. The
--    Bednyak lighting thread alone had 7+ named participants; only the
--    single most-relevant one could be linked, the rest live only in notes
--    text (unqueryable). person_id stays as-is (the "primary" contact, so
--    existing queries/UI keep working) — this table captures everyone else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interaction_person (
    interaction_id INT REFERENCES interactions(id),
    person_id INT REFERENCES people(id),
    relationship VARCHAR(30) DEFAULT 'participant'
        CHECK (relationship IN ('primary', 'participant', 'mentioned')),
    PRIMARY KEY (interaction_id, person_id)
);
CREATE INDEX IF NOT EXISTS idx_interaction_person_person ON interaction_person(person_id);

-- ---------------------------------------------------------------------------
-- 3) Real membership tier name alongside the internal bucket.
--    service_level is a fixed None/Bronze/Silver/Gold/Platinum enum that
--    doesn't match actual client-facing tier names (Deng's "Essentials+").
--    service_level stays for whatever rough internal bucketing it's used
--    for; membership_tier_label holds what the client's agreement/invoice
--    actually says. Cheap to add a mapping table later if you want the
--    two reconciled for Salesforce picklists.
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS membership_tier_label VARCHAR(100);

-- ---------------------------------------------------------------------------
-- 4) Broaden person_site roles past homeowner/property_manager.
--    Real accounts surface GCs, vendor contacts, household staff, family
--    members, tenants — none of which fit today's two-value CHECK.
-- ---------------------------------------------------------------------------
ALTER TABLE person_site DROP CONSTRAINT IF EXISTS person_site_role_check;
ALTER TABLE person_site ADD CONSTRAINT person_site_role_check CHECK (role IN (
    'homeowner', 'property_manager', 'tenant', 'family_member',
    'household_staff', 'general_contractor', 'vendor_contact', 'other'
));

-- ---------------------------------------------------------------------------
-- 5) Long-tail escape valve. A JSONB column for genuinely variable, one-off
--    facts that don't (yet) deserve a dedicated column — used sparingly: if
--    the same key starts showing up across several accounts, that's the
--    signal to promote it to a real column instead, not to keep piling into
--    JSONB. Prevents both "no thought put into what it's reading" (todo:
--    silently dropping oddball facts) and column sprawl for rare fields.
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}';
ALTER TABLE people   ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}';
ALTER TABLE sites    ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}';
ALTER TABLE systems  ADD COLUMN IF NOT EXISTS extra JSONB DEFAULT '{}';

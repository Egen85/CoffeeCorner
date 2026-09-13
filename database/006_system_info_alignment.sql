-- ============================================================================
-- Coffee Corner — Migration 006: align System Info with Memory/accounts'
-- new _system.json schema (see ~/Guey/Memory/accounts/_TEMPLATE_system-info.json
-- and accounts/README.md's System Info section).
--
-- Three moves:
--   1) Widen systems.category from 6 values to the 11-category taxonomy,
--      reclassifying all 139 existing rows previously bucketed under the
--      old 'security', 'av', and 'networking' values (each blended 2-3 of
--      the new categories together).
--   2) Add the component/system fields the new schema has that this DB
--      didn't: location, po_number, proposal_ref, service_call_ref,
--      provided_by, install_date_approx, config (components);
--      integrated_with_control_system (systems); a subscriptions table.
--   3) Replace site_system_info's fixed 6-category brand/model columns
--      with sites.system_info JSONB, matching the template's shape
--      exactly. general_notes carries forward site_system_info.notes
--      verbatim (rich free text spanning multiple categories — not
--      safely splittable by automation, so preserved whole rather than
--      guessed at).
--
-- Category-specific fields (door_count, monitoring_company, topology,
-- etc.) and component config are left at their defaults for this pass —
-- this migration aligns the SHAPE with the new schema; populating those
-- finer fields from the rich existing notes is follow-up work, not done
-- here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) New columns/tables
-- ---------------------------------------------------------------------------

ALTER TABLE systems ADD COLUMN IF NOT EXISTS integrated_with_control_system BOOLEAN;

ALTER TABLE components ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE components ADD COLUMN IF NOT EXISTS po_number VARCHAR(100);
ALTER TABLE components ADD COLUMN IF NOT EXISTS proposal_ref VARCHAR(100);
ALTER TABLE components ADD COLUMN IF NOT EXISTS service_call_ref VARCHAR(100);
ALTER TABLE components ADD COLUMN IF NOT EXISTS provided_by VARCHAR(50);
ALTER TABLE components ADD COLUMN IF NOT EXISTS install_date_approx VARCHAR(50);
ALTER TABLE components ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    system_id INT REFERENCES systems(id),
    service VARCHAR(200),
    term VARCHAR(50),
    expires_approx VARCHAR(50),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_system ON subscriptions(system_id);

-- ---------------------------------------------------------------------------
-- 2) Reclassify systems.category (drop constraint, fix all 139 rows, re-add
--    widened constraint)
-- ---------------------------------------------------------------------------

ALTER TABLE systems DROP CONSTRAINT IF EXISTS systems_category_check;

-- old 'security' (58 rows) -> access_control / security_alarm / video_surveillance
UPDATE systems SET category = 'access_control' WHERE id IN (
    182,185,184,183,171,187,106,76,75,52,34,27,16,163,12,141,66,10,5,180,63,1,95
);
UPDATE systems SET category = 'security_alarm' WHERE id IN (
    19,115,122,93,151,57,26,44,53,73,146,157,67,69,135,186
);
UPDATE systems SET category = 'video_surveillance' WHERE id IN (
    82,94,172,159,188,28,113,6,114,118,11,112,117,116,15,23,45,33,7
);

-- old 'av' (56 rows) -> control_system / av_system / network
UPDATE systems SET category = 'control_system' WHERE id IN (
    80,81,155,147,21,47,98,132,31,68,17,71,160,105,38,119,150,64,90,158,
    169,74,60,49,103,173
);
UPDATE systems SET category = 'av_system' WHERE id IN (
    167,77,175,130,176,156,32,85,8,13,24,48,86,84,39,43,65,78,30,9,110,
    55,168,72,131,161,137,142,179
);
UPDATE systems SET category = 'network' WHERE id IN (136);

-- old 'networking' (25 rows) -> network / remote_access / phone_system
UPDATE systems SET category = 'remote_access' WHERE id IN (36);
UPDATE systems SET category = 'phone_system' WHERE id IN (178,164,181);
UPDATE systems SET category = 'network' WHERE id IN (
    111,140,166,79,62,134,54,104,41,145,35,22,87,46,99,121,191,152,58,20,96
);

-- 'lighting', 'shades', 'climate' already match the new taxonomy verbatim —
-- no rows to touch.

ALTER TABLE systems ADD CONSTRAINT systems_category_check CHECK (category IN (
    'access_control', 'control_system', 'security_alarm', 'video_surveillance',
    'av_system', 'lighting', 'shades', 'climate', 'network', 'phone_system',
    'remote_access'
));

-- ---------------------------------------------------------------------------
-- 3) Replace site_system_info's fixed columns with sites.system_info JSONB,
--    matching _TEMPLATE_system-info.json's shape exactly.
-- ---------------------------------------------------------------------------

ALTER TABLE sites ADD COLUMN IF NOT EXISTS system_info JSONB DEFAULT '{}';

UPDATE sites s SET system_info = jsonb_build_object(
    'general_notes', NULLIF(ssi.notes, ''),
    'control_system', jsonb_build_object(
        'status', CASE WHEN ssi.control_processor_brand IS NOT NULL OR ssi.control_processor_model IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.control_processor_brand, 'platform', ssi.control_processor_model
    ),
    'security_alarm', jsonb_build_object(
        'status', CASE WHEN ssi.security_system_brand IS NOT NULL OR ssi.security_system_model IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.security_system_brand, 'platform', ssi.security_system_model
    ),
    'video_surveillance', jsonb_build_object(
        'status', CASE WHEN ssi.camera_vms_brand IS NOT NULL OR ssi.camera_vms_model IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.camera_vms_brand, 'platform', ssi.camera_vms_model
    ),
    'climate', jsonb_build_object(
        'status', CASE WHEN ssi.climate_control_brand IS NOT NULL OR ssi.climate_control_model IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.climate_control_brand, 'platform', ssi.climate_control_model
    ),
    'lighting', jsonb_build_object(
        'status', CASE WHEN ssi.lighting_system_brand IS NOT NULL OR ssi.lighting_system_model IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.lighting_system_brand, 'platform', ssi.lighting_system_model
    ),
    'shades', jsonb_build_object(
        'status', CASE WHEN ssi.shades_system_brand IS NOT NULL OR ssi.shades_system_model IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.shades_system_brand, 'platform', ssi.shades_system_model
    ),
    'av_system', jsonb_build_object(
        'status', CASE WHEN ssi.av_distributed IS TRUE OR ssi.video_matrix_brand IS NOT NULL THEN 'present' ELSE 'unknown' END,
        'brand', ssi.video_matrix_brand, 'platform', ssi.video_matrix_model,
        'topology', CASE WHEN ssi.av_distributed IS TRUE THEN 'centralized' WHEN ssi.av_distributed IS FALSE THEN 'decentralized' ELSE NULL END
    )
)
FROM site_system_info ssi
WHERE ssi.site_id = s.id;

DROP VIEW IF EXISTS v_site_system_overview;
CREATE VIEW v_site_system_overview AS
SELECT
    s.id, s.address_line1, s.city, s.state, s.zip, s.site_type,
    s.system_info
FROM sites s
WHERE s.system_info IS NOT NULL AND s.system_info != '{}'::jsonb;

DROP TABLE site_system_info;

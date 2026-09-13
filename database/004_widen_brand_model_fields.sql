-- ============================================================================
-- Coffee Corner — Migration 004
-- Widens all brand/model VARCHAR columns to TEXT. Found on the 1932-Seminary
-- account: a security_system_model value (a full itemized Elk parts list
-- transcribed from a SharePoint proposal) overflowed VARCHAR(255). These
-- columns hold free text pulled from proposal documents of unpredictable
-- length, and TEXT has no meaningful downside over VARCHAR(n) in Postgres —
-- purely additive, no data loss, no application changes needed.
-- ============================================================================

-- Two views depend on these columns and block a direct ALTER; drop + recreate
-- them unchanged around the type change.
DROP VIEW IF EXISTS v_warranty_expiring;
DROP VIEW IF EXISTS v_site_system_overview;

ALTER TABLE components        ALTER COLUMN brand TYPE TEXT;
ALTER TABLE components        ALTER COLUMN model TYPE TEXT;
ALTER TABLE systems           ALTER COLUMN brand TYPE TEXT;
ALTER TABLE systems           ALTER COLUMN model TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN camera_vms_brand        TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN camera_vms_model        TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN climate_control_brand   TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN climate_control_model   TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN control_processor_brand TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN control_processor_model TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN lighting_system_brand   TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN lighting_system_model   TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN security_system_brand   TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN security_system_model   TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN shades_system_brand     TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN shades_system_model     TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN video_matrix_brand      TYPE TEXT;
ALTER TABLE site_system_info  ALTER COLUMN video_matrix_model      TYPE TEXT;

CREATE VIEW v_warranty_expiring AS
SELECT
    s.address_line1, s.city, s.state, s.zip,
    sys.name, sys.brand, sys.model, sys.warranty_expires,
    a.billing_status, a.is_vip
FROM systems sys
JOIN sites s ON s.id = sys.site_id
LEFT JOIN site_account sa ON sa.site_id = s.id
LEFT JOIN accounts a ON a.id = sa.account_id
WHERE sys.warranty_expires BETWEEN NOW() AND NOW() + INTERVAL '90 days'
ORDER BY sys.warranty_expires;

CREATE VIEW v_site_system_overview AS
SELECT
    s.id, s.address_line1, s.city, s.state, s.zip,
    s.site_type,
    ssi.control_processor_brand, ssi.control_processor_model,
    ssi.security_system_brand, ssi.security_system_model,
    ssi.camera_vms_brand, ssi.camera_vms_model,
    ssi.climate_control_brand, ssi.climate_control_model,
    ssi.lighting_system_brand, ssi.lighting_system_model,
    ssi.shades_system_brand, ssi.shades_system_model,
    ssi.av_distributed,
    ssi.video_matrix_brand, ssi.video_matrix_model
FROM sites s
LEFT JOIN site_system_info ssi ON ssi.site_id = s.id;

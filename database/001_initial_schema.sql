-- ============================================================================
-- Coffee Corner — Initial Database Schema
-- Generated: 2026-08-26
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reference Data
-- ---------------------------------------------------------------------------

CREATE TABLE service_levels (
    id INT PRIMARY KEY CHECK (id BETWEEN 0 AND 4),
    label VARCHAR(100)
);

INSERT INTO service_levels VALUES
    (0, 'None'),
    (1, 'Bronze'),
    (2, 'Silver'),
    (3, 'Gold'),
    (4, 'Platinum');

-- ---------------------------------------------------------------------------
-- Core Entities
-- ---------------------------------------------------------------------------

CREATE TABLE people (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    personal_address TEXT,
    external_link TEXT,
    next_contact_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    billing_status VARCHAR(20) DEFAULT 'active'
        CHECK (billing_status IN ('active', 'past due', 'on hold')),
    service_level INT DEFAULT 0 CHECK (service_level BETWEEN 0 AND 4),
    is_vip BOOLEAN DEFAULT FALSE,
    external_link TEXT,
    next_contact_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sites (
    id SERIAL PRIMARY KEY,
    address_line1 TEXT,
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip VARCHAR(20),
    site_type VARCHAR(50) CHECK (site_type IN (
        'Residential', 'Commercial', 'Residential Tenant',
        'Commercial Tenant', 'Mixed', 'Other'
    )),
    former_homeowner_id INT REFERENCES people(id),
    external_link TEXT,
    next_contact_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Relationships (the many-to-many web)
-- ---------------------------------------------------------------------------

CREATE TABLE person_account (
    person_id INT REFERENCES people(id),
    account_id INT REFERENCES accounts(id),
    is_primary_account_holder BOOLEAN DEFAULT FALSE,
    is_billing_contact BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (person_id, account_id)
);

CREATE TABLE site_account (
    site_id INT REFERENCES sites(id),
    account_id INT REFERENCES accounts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (site_id, account_id)
);

CREATE TABLE person_site (
    person_id INT REFERENCES people(id),
    site_id INT REFERENCES sites(id),
    role VARCHAR(50) CHECK (role IN ('homeowner', 'property_manager')),
    is_primary_contact BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (person_id, site_id)
);

-- ---------------------------------------------------------------------------
-- Standalone
-- ---------------------------------------------------------------------------

CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    specialty VARCHAR(200),
    external_link TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Systems & Components
-- ---------------------------------------------------------------------------

CREATE TABLE systems (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id),
    name VARCHAR(200),
    category VARCHAR(50) CHECK (category IN (
        'security', 'av', 'lighting', 'shades', 'climate', 'networking'
    )),
    brand VARCHAR(150),
    model VARCHAR(255),
    install_date DATE,
    warranty_expires DATE,
    status VARCHAR(50) CHECK (status IN (
        'active', 'offline', 'maintenance', 'decommissioned'
    )),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE components (
    id SERIAL PRIMARY KEY,
    system_id INT REFERENCES systems(id),
    name VARCHAR(200),
    type VARCHAR(100),
    brand VARCHAR(150),
    model VARCHAR(255),
    serial_number VARCHAR(150),
    quantity INT DEFAULT 1,
    firmware_version VARCHAR(50),
    ip_address VARCHAR(45),
    mac_address VARCHAR(50),
    cable_category VARCHAR(100),
    status VARCHAR(50) CHECK (status IN ('online', 'offline', 'fault')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE site_system_info (
    site_id INT PRIMARY KEY REFERENCES sites(id),
    control_processor_brand VARCHAR(150),
    control_processor_model VARCHAR(255),
    security_system_brand VARCHAR(150),
    security_system_model VARCHAR(255),
    camera_vms_brand VARCHAR(150),
    camera_vms_model VARCHAR(255),
    climate_control_brand VARCHAR(100),
    climate_control_model VARCHAR(255),
    lighting_system_brand VARCHAR(150),
    lighting_system_model VARCHAR(255),
    shades_system_brand VARCHAR(150),
    shades_system_model VARCHAR(255),
    av_distributed BOOLEAN DEFAULT FALSE,
    video_matrix_brand VARCHAR(150),
    video_matrix_model VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Interactions (merged service records + all contacts)
-- ---------------------------------------------------------------------------

CREATE TABLE interactions (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id),
    system_id INT REFERENCES systems(id),
    component_id INT REFERENCES components(id),
    person_id INT REFERENCES people(id),
    vendor_id INT REFERENCES vendors(id),
    interaction_type VARCHAR(50) CHECK (interaction_type IN (
        'phone_call', 'email', 'on_site_visit', 'remote_session',
        'sales', 'scheduled_checkup', 'change_order', 'other'
    )),
    is_service BOOLEAN DEFAULT FALSE,
    interaction_date DATE,
    description TEXT,
    cost DECIMAL(10,2),
    warranty_claim BOOLEAN DEFAULT FALSE,
    invoice_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE components_used (
    interaction_id INT REFERENCES interactions(id),
    part_number VARCHAR(150),
    description VARCHAR(500),
    cost DECIMAL(10,2),
    quantity INT DEFAULT 1,
    PRIMARY KEY (interaction_id, part_number)
);

-- ---------------------------------------------------------------------------
-- Credentials & Users
-- ---------------------------------------------------------------------------

CREATE TABLE credentials (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id),
    system_id INT REFERENCES systems(id),
    label VARCHAR(200),
    username TEXT,
    password TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE,
    password_hash TEXT,
    role VARCHAR(50) CHECK (role IN ('admin', 'manager', 'technician')),
    name VARCHAR(200),
    can_view_credentials BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes (for fast lookups)
-- ---------------------------------------------------------------------------

CREATE INDEX idx_people_email ON people(email);
CREATE INDEX idx_people_phone ON people(phone);
CREATE INDEX idx_sites_address ON sites(address_line1, city, state, zip);
CREATE INDEX idx_sites_former_homeowner ON sites(former_homeowner_id);
CREATE INDEX idx_sites_type ON sites(site_type);
CREATE INDEX idx_components_serial ON components(serial_number);
CREATE INDEX idx_components_system ON components(system_id);
CREATE INDEX idx_systems_site ON systems(site_id);
CREATE INDEX idx_systems_category ON systems(category);
CREATE INDEX idx_systems_status ON systems(status);
CREATE INDEX idx_components_status ON components(status);
CREATE INDEX idx_interactions_site ON interactions(site_id);
CREATE INDEX idx_interactions_person ON interactions(person_id);
CREATE INDEX idx_interactions_is_service ON interactions(is_service);
CREATE INDEX idx_interactions_date ON interactions(interaction_date);
CREATE INDEX idx_interactions_type ON interactions(interaction_type);

-- ---------------------------------------------------------------------------
-- Views (pre-built queries for common reports)
-- ---------------------------------------------------------------------------

CREATE VIEW v_site_full AS
SELECT
    s.id, s.address_line1, s.address_line2, s.city, s.state, s.zip,
    s.site_type,
    fh.first_name || ' ' || fh.last_name AS former_homeowner,
    a.name AS account_name,
    a.billing_status, a.service_level, a.is_vip,
    sl.label AS service_level_label,
    ps.role, ps.is_primary_contact,
    pa.is_primary_account_holder, pa.is_billing_contact,
    sys.name AS system_name, sys.category, sys.status,
    comp.name AS component_name, comp.type, comp.status AS component_status,
    comp.serial_number, comp.ip_address
FROM sites s
LEFT JOIN people fh ON fh.id = s.former_homeowner_id
LEFT JOIN site_account sa ON sa.site_id = s.id
LEFT JOIN accounts a ON a.id = sa.account_id
LEFT JOIN service_levels sl ON sl.id = a.service_level
LEFT JOIN person_site ps ON ps.site_id = s.id
LEFT JOIN person_account pa ON pa.person_id = ps.person_id AND pa.account_id = sa.account_id
LEFT JOIN systems sys ON sys.site_id = s.id
LEFT JOIN components comp ON comp.system_id = sys.id;

CREATE VIEW v_recurring_issues AS
SELECT
    s.address_line1, s.city, s.state, s.zip,
    sys.name AS system_name,
    comp.name AS component_name,
    comp.serial_number,
    COUNT(ir.id) AS service_count,
    ir.notes
FROM interactions ir
JOIN sites s ON s.id = ir.site_id
LEFT JOIN systems sys ON sys.id = ir.system_id
LEFT JOIN components comp ON comp.id = ir.component_id
WHERE ir.is_service = true
GROUP BY s.address_line1, s.city, s.state, s.zip,
         sys.name, comp.name, comp.serial_number, ir.notes
HAVING COUNT(ir.id) > 1
ORDER BY COUNT(ir.id) DESC;

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

CREATE VIEW v_accounts_summary AS
SELECT
    a.id, a.name, a.billing_status, a.service_level,
    sl.label AS service_level_label,
    a.is_vip, a.next_contact_date,
    COUNT(DISTINCT sa.site_id) AS total_sites,
    COUNT(DISTINCT pa.person_id) AS total_people,
    COUNT(DISTINCT CASE WHEN i.id IS NOT NULL AND i.interaction_date >= NOW() - INTERVAL '30 days' THEN i.id END) AS recent_interactions
FROM accounts a
LEFT JOIN service_levels sl ON sl.id = a.service_level
LEFT JOIN site_account sa ON sa.account_id = a.id
LEFT JOIN person_account pa ON pa.account_id = a.id
LEFT JOIN person_site pps ON pps.person_id = pa.person_id
LEFT JOIN interactions i ON i.person_id = pps.person_id AND i.interaction_date >= NOW() - INTERVAL '30 days'
GROUP BY a.id, a.name, a.billing_status, a.service_level,
         sl.label, a.is_vip, a.next_contact_date;

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
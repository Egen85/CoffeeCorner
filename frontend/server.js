const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Encryption key for credentials. Must be stable across restarts — a
// per-process random key silently makes every previously-encrypted
// credential undecryptable the next time the server restarts. Falls back to
// a key persisted in .encryption-key (created once, then reused) when
// ENCRYPTION_KEY isn't set in the environment.
const KEY_FILE = path.join(__dirname, '.encryption-key');
function loadEncryptionKey() {
    if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
    if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8').trim();
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(KEY_FILE, generated, { mode: 0o600 });
    return generated;
}
const ENCRYPTION_KEY = loadEncryptionKey();
const ALGORITHM = 'aes-256-cbc';

// ---------------------------------------------------------------------------
// DEV MODE — auth bypass
// The login screen gets in the way while we build. All auth routes and the
// login/setup screens are PRESERVED — to re-enable auth (planned for near
// the end of the project), flip this to false and unhide the logout button
// in public/index.html.
// ---------------------------------------------------------------------------
const DEV_NO_AUTH = true;
const DEV_USER = { id: null, username: 'dev', name: 'Developer', role: 'admin', can_view_credentials: true };

// Derive a fixed-length 32-byte key from ENCRYPTION_KEY regardless of its
// source format (persisted 64-char hex string, or an arbitrary env override)
// -- aes-256-cbc requires an exact 32-byte key.
const ENCRYPTION_KEY_BUFFER = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

// Encrypt a value
// (bug found + fixed 2026-08-31, during 4100-N-Fillmore: crypto.createCipher/
// createDecipher were removed in Node.js 22 -- every credential POST/GET was
// throwing and getting swallowed as a generic 500 "Server error". No
// credentials existed yet in the DB, so this was previously undiscovered.
// Switched to createCipheriv/createDecipheriv, which require an explicit key
// buffer -- see ENCRYPTION_KEY_BUFFER above.)
function encrypt(value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY_BUFFER, iv);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

// Decrypt a value
function decrypt(encryptedValue) {
    const [ivHex, encrypted] = encryptedValue.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY_BUFFER, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'home_integration',
    user: process.env.DB_USER || 'tower',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432
});

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth status (for checking if logged in)
app.get('/api/auth/status', (req, res) => {
    if (DEV_NO_AUTH) return res.json(DEV_USER);
    const userId = req.cookies?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    pool.query('SELECT id, username, name, role, can_view_credentials FROM users WHERE id = $1', [userId])
        .then(result => {
            if (result.rows.length === 0) return res.status(401).json({ error: 'Not authenticated' });
            res.json(result.rows[0]);
        })
        .catch(() => res.status(500).json({ error: 'Server error' }));
});

// Check if setup is needed (no users exist)
app.get('/api/setup/needed', async (req, res) => {
    try {
        const result = await pool.query('SELECT count(*) FROM users');
        res.json({ needed: parseInt(result.rows[0].count) === 0 });
    } catch {
        res.json({ needed: true });
    }
});

// Auth middleware
async function requireAuth(req, res, next) {
    if (DEV_NO_AUTH) {
        req.user = DEV_USER;
        return next();
    }
    const session = req.cookies || {};
    if (!session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const result = await pool.query('SELECT id, username, name, role, can_view_credentials FROM users WHERE id = $1', [session.userId]);
    if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    req.user = result.rows[0];
    next();
}

function requireManager(req, res, next) {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Manager access required' });
    }
    next();
}

// ============================================================================
// AUTH ROUTES
// ============================================================================

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Simple session via cookie
        res.cookie('userId', user.id, { httpOnly: true, maxAge: 86400000 });
        res.json({
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            canViewCredentials: user.can_view_credentials
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('userId');
    res.json({ ok: true });
});

// Create admin user (run once)
app.post('/api/setup-admin', async (req, res) => {
    const { username, password, name } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password_hash, role, name, can_view_credentials) VALUES ($1, $2, $3, $4, $5)',
            [username, hash, 'admin', name, true]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create admin user' });
    }
});

// ============================================================================
// PEOPLE ROUTES
// ============================================================================

app.get('/api/people', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*,
                COALESCE(pa_agg.accounts, '[]') AS accounts,
                COALESCE(ps_agg.sites, '[]') AS sites,
                COALESCE(pv_agg.vendors, '[]') AS vendors
            FROM people p
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object('account_id', a.id, 'account_name', a.name))
                FROM person_account pa JOIN accounts a ON a.id = pa.account_id
                WHERE pa.person_id = p.id
            ) pa_agg(accounts) ON true
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object('site_id', s.id, 'address_line1', s.address_line1, 'city', s.city, 'state', s.state))
                FROM person_site ps JOIN sites s ON s.id = ps.site_id
                WHERE ps.person_id = p.id
            ) ps_agg(sites) ON true
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object('vendor_id', v.id, 'vendor_name', v.name))
                FROM person_vendor pv JOIN vendors v ON v.id = pv.vendor_id
                WHERE pv.person_id = p.id
            ) pv_agg(vendors) ON true
            ORDER BY p.last_name, p.first_name
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/people', async (req, res) => {
    const { first_name, last_name, email, phone, personal_address, external_link, next_contact_date, notes, client_since_year, extra } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO people (first_name, last_name, email, phone, personal_address, external_link, next_contact_date, notes, client_since_year, extra)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [first_name, last_name, email, phone, personal_address, external_link, next_contact_date, notes, client_since_year || null, extra ? JSON.stringify(extra) : '{}']
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/people error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/people/:id', async (req, res) => {
    const { id } = req.params;
    const { first_name, last_name, email, phone, personal_address, external_link, next_contact_date, notes, client_since_year } = req.body;
    try {
        const result = await pool.query(
            `UPDATE people SET first_name=$1, last_name=$2, email=$3, phone=$4,
             personal_address=$5, external_link=$6, next_contact_date=$7, notes=$8,
             client_since_year=$9, updated_at=NOW() WHERE id=$10 RETURNING *`,
            [first_name, last_name, email, phone, personal_address, external_link, next_contact_date, notes, client_since_year || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/people/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM people WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete (may have related records)' });
    }
});

// Person → Accounts (via person_account junction table)
app.get('/api/people/:id/accounts', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT pa.account_id, a.name AS account_name, pa.is_primary_account_holder, pa.is_billing_contact, pa.is_vip, pa.role
            FROM person_account pa
            JOIN accounts a ON a.id = pa.account_id
            WHERE pa.person_id = $1
            ORDER BY a.name
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Account → People (via person_account junction table)
app.get('/api/accounts/:id/people', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT pa.person_id, p.first_name, p.last_name, p.email, p.phone,
                   pa.is_primary_account_holder, pa.is_billing_contact, pa.is_correspondent, pa.is_vip, pa.role_label
            FROM person_account pa
            JOIN people p ON p.id = pa.person_id
            WHERE pa.account_id = $1
            ORDER BY pa.is_primary_account_holder DESC, p.last_name
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Account → Sites (via site_account junction table)
app.get('/api/accounts/:id/sites', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT sa.site_id, s.address_line1, s.address_line2, s.city, s.state, s.zip, s.site_type
            FROM site_account sa
            JOIN sites s ON s.id = sa.site_id
            WHERE sa.account_id = $1
            ORDER BY s.address_line1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Person → Sites (via person_site junction table)
app.get('/api/people/:id/sites', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT ps.site_id, s.address_line1, s.city, s.state, s.zip, ps.role, ps.is_primary_contact
            FROM person_site ps
            JOIN sites s ON s.id = ps.site_id
            WHERE ps.person_id = $1
            ORDER BY s.address_line1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// ACCOUNTS ROUTES
// ============================================================================

app.get('/api/accounts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, sl.label AS service_level_label,
                   COALESCE(site_count.n, 0) AS total_sites,
                   COALESCE(person_count.n, 0) AS total_people
            FROM accounts a
            LEFT JOIN service_levels sl ON sl.id = a.service_level
            LEFT JOIN LATERAL (SELECT count(*) AS n FROM site_account sa WHERE sa.account_id = a.id) site_count ON true
            LEFT JOIN LATERAL (SELECT count(*) AS n FROM person_account pa WHERE pa.account_id = a.id) person_count ON true
            ORDER BY a.name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/accounts error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/accounts', async (req, res) => {
    const { name, billing_status, service_level, is_vip, external_link, next_contact_date,
            notes, membership_tier_label, extra } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO accounts (name, billing_status, service_level, is_vip, external_link,
             next_contact_date, notes, membership_tier_label, extra)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [name, billing_status || 'active', service_level || 0, is_vip || false, external_link,
             next_contact_date, notes, membership_tier_label, extra ? JSON.stringify(extra) : '{}']
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/accounts error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { name, billing_status, service_level, is_vip, external_link, next_contact_date,
            notes, membership_tier_label, extra } = req.body;
    try {
        const result = await pool.query(
            `UPDATE accounts SET name=$1, billing_status=$2, service_level=$3, is_vip=$4,
             external_link=$5, next_contact_date=$6, notes=$7, membership_tier_label=$8,
             extra=COALESCE($9, extra), updated_at=NOW()
             WHERE id=$10 RETURNING *`,
            [name, billing_status, service_level, is_vip, external_link, next_contact_date, notes,
             membership_tier_label, extra ? JSON.stringify(extra) : null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/accounts/:id error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/accounts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM accounts WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete (may have related records)' });
    }
});

// ============================================================================
// SITES ROUTES
// ============================================================================

app.get('/api/sites', async (req, res) => {
    try {
        // site_account and person_site are both many-to-(one-site), so a
        // plain LEFT JOIN can fan a site out into duplicate rows (one
        // account per link, one row per is_primary_contact=true person —
        // found 2026-09-03: two sites had two people both flagged primary
        // contact). LATERAL subqueries with LIMIT 1 / json_agg keep this
        // to one row per site.
        const result = await pool.query(`
            SELECT s.*,
                   fh.first_name || ' ' || fh.last_name AS former_homeowner_name,
                   sa_agg.account_id, sa_agg.account_name, sl.label AS service_level_label,
                   pc.role, pc.is_primary_contact, pc.first_name || ' ' || pc.last_name AS primary_contact_name,
                   pc.person_id AS primary_contact_id
            FROM sites s
            LEFT JOIN people fh ON fh.id = s.former_homeowner_id
            LEFT JOIN LATERAL (
                SELECT a.id AS account_id, a.name AS account_name, a.service_level
                FROM site_account sa JOIN accounts a ON a.id = sa.account_id
                WHERE sa.site_id = s.id ORDER BY a.name LIMIT 1
            ) sa_agg ON true
            LEFT JOIN service_levels sl ON sl.id = sa_agg.service_level
            LEFT JOIN LATERAL (
                SELECT ps.role, ps.is_primary_contact, ps.person_id, p.first_name, p.last_name
                FROM person_site ps JOIN people p ON p.id = ps.person_id
                WHERE ps.site_id = s.id AND ps.is_primary_contact = true
                ORDER BY ps.person_id LIMIT 1
            ) pc ON true
            ORDER BY s.address_line1
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/sites error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/sites', async (req, res) => {
    const { address_line1, address_line2, city, state, zip, site_type, former_homeowner_id, external_link, next_contact_date, notes, extra } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO sites (address_line1, address_line2, city, state, zip, site_type,
             former_homeowner_id, external_link, next_contact_date, notes, extra)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [address_line1, address_line2, city, state, zip, site_type, former_homeowner_id, external_link, next_contact_date, notes, extra ? JSON.stringify(extra) : '{}']
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/sites error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/sites/:id', async (req, res) => {
    const { id } = req.params;
    const { address_line1, address_line2, city, state, zip, site_type, former_homeowner_id, external_link, next_contact_date, notes } = req.body;
    try {
        const result = await pool.query(
            `UPDATE sites SET address_line1=$1, address_line2=$2, city=$3, state=$4,
             zip=$5, site_type=$6, former_homeowner_id=$7, external_link=$8,
             next_contact_date=$9, notes=$10, updated_at=NOW() WHERE id=$11 RETURNING *`,
            [address_line1, address_line2, city, state, zip, site_type, former_homeowner_id, external_link, next_contact_date, notes, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/sites/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM sites WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete (may have related records)' });
    }
});

// ============================================================================
// RELATIONSHIP ROUTES
// ============================================================================

// Link a person to an account
app.post('/api/relationships/person-account', async (req, res) => {
    const { person_id, account_id, is_primary_account_holder, is_billing_contact,
            is_correspondent, is_vip, role_label } = req.body;
    try {
        await pool.query(
            `INSERT INTO person_account (person_id, account_id, is_primary_account_holder,
             is_billing_contact, is_correspondent, is_vip, role_label)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (person_id, account_id) DO UPDATE SET
             is_primary_account_holder=$3, is_billing_contact=$4, is_correspondent=$5, is_vip=$6, role_label=$7 RETURNING *`,
            [person_id, account_id, is_primary_account_holder, is_billing_contact,
             is_correspondent || false, is_vip || false, role_label]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Link a person to an interaction as a non-primary participant
app.post('/api/relationships/interaction-person', async (req, res) => {
    const { interaction_id, person_id, relationship } = req.body;
    try {
        await pool.query(
            `INSERT INTO interaction_person (interaction_id, person_id, relationship)
             VALUES ($1, $2, $3) ON CONFLICT (interaction_id, person_id) DO UPDATE SET
             relationship=$3 RETURNING *`,
            [interaction_id, person_id, relationship || 'participant']
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get participants for an interaction
app.get('/api/interactions/:id/people', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT ip.person_id, ip.relationship, p.first_name, p.last_name
            FROM interaction_person ip
            JOIN people p ON p.id = ip.person_id
            WHERE ip.interaction_id = $1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Link a site to an account
app.post('/api/relationships/site-account', async (req, res) => {
    const { site_id, account_id } = req.body;
    try {
        await pool.query(
            `INSERT INTO site_account (site_id, account_id) VALUES ($1, $2)
             ON CONFLICT (site_id, account_id) DO NOTHING RETURNING *`,
            [site_id, account_id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Link a person to a site (homeowner or property manager)
app.post('/api/relationships/person-site', async (req, res) => {
    const { person_id, site_id, role, is_primary_contact } = req.body;
    try {
        await pool.query(
            `INSERT INTO person_site (person_id, site_id, role, is_primary_contact)
             VALUES ($1, $2, $3, $4) ON CONFLICT (person_id, site_id) DO UPDATE SET
             role=$3, is_primary_contact=$4 RETURNING *`,
            [person_id, site_id, role, is_primary_contact]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get relationships for a person
app.get('/api/relationships/person/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT pa.*, a.name AS account_name,
                   ps.role, ps.is_primary_contact
            FROM person_account pa
            JOIN accounts a ON a.id = pa.account_id
            LEFT JOIN person_site ps ON ps.person_id = pa.person_id AND ps.account_id = pa.account_id
            WHERE pa.person_id = $1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get relationships for a site
app.get('/api/relationships/site/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT sa.account_id, a.name AS account_name, sl.label AS service_level_label,
                   ps.person_id, p.first_name, p.last_name, ps.role, ps.is_primary_contact
            FROM site_account sa
            JOIN accounts a ON a.id = sa.account_id
            LEFT JOIN service_levels sl ON sl.id = a.service_level
            LEFT JOIN person_site ps ON ps.site_id = sa.site_id
            LEFT JOIN people p ON p.id = ps.person_id
            WHERE sa.site_id = $1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// VENDORS ROUTES
// ============================================================================

app.get('/api/vendors', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vendors ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/vendors', async (req, res) => {
    const { name, contact_email, contact_phone, specialty, address, external_link, notes } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO vendors (name, contact_email, contact_phone, specialty, address, external_link, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, contact_email, contact_phone, specialty, address, external_link, notes]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/vendors/:id', async (req, res) => {
    const { id } = req.params;
    const { name, contact_email, contact_phone, specialty, address, external_link, notes } = req.body;
    try {
        const result = await pool.query(
            `UPDATE vendors SET name=$1, contact_email=$2, contact_phone=$3,
             specialty=$4, address=$5, external_link=$6, notes=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
            [name, contact_email, contact_phone, specialty, address, external_link, notes, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/vendors/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM vendors WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// ============================================================================
// SYSTEMS ROUTES
// ============================================================================

app.get('/api/sites/:siteId/systems', async (req, res) => {
    const { siteId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM systems WHERE site_id = $1 ORDER BY name',
            [siteId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/sites/:siteId/systems', async (req, res) => {
    const { siteId } = req.params;
    const { name, category, brand, model, install_date, warranty_expires, status, notes, extra, integrated_with_control_system } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO systems (site_id, name, category, brand, model, install_date,
             warranty_expires, status, notes, extra, integrated_with_control_system) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [siteId, name, category, brand, model, install_date, warranty_expires, status || 'active', notes, extra ? JSON.stringify(extra) : '{}', integrated_with_control_system ?? null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/systems/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category, brand, model, install_date, warranty_expires, status, notes, extra, integrated_with_control_system } = req.body;
    try {
        const result = await pool.query(
            `UPDATE systems SET name=$1, category=$2, brand=$3, model=$4,
             install_date=$5, warranty_expires=$6, status=$7, notes=$8,
             extra=COALESCE($9, extra), integrated_with_control_system=$10,
             updated_at=NOW() WHERE id=$11 RETURNING *`,
            [name, category, brand, model, install_date, warranty_expires, status, notes,
             extra ? JSON.stringify(extra) : null, integrated_with_control_system ?? null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/systems/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM systems WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete (may have components)' });
    }
});

// ============================================================================
// COMPONENTS ROUTES
// ============================================================================

app.get('/api/systems/:systemId/components', async (req, res) => {
    const { systemId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM components WHERE system_id = $1 ORDER BY name',
            [systemId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/systems/:systemId/components', async (req, res) => {
    const { systemId } = req.params;
    const { name, type, brand, model, serial_number, quantity, firmware_version,
            ip_address, mac_address, cable_category, status, notes,
            location, po_number, proposal_ref, service_call_ref, provided_by,
            install_date_approx, config } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO components (system_id, name, type, brand, model, serial_number,
             quantity, firmware_version, ip_address, mac_address, cable_category, status, notes,
             location, po_number, proposal_ref, service_call_ref, provided_by, install_date_approx, config)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *`,
            [systemId, name, type, brand, model, serial_number, quantity || 1,
             firmware_version, ip_address, mac_address, cable_category, status || 'online', notes,
             location, po_number, proposal_ref, service_call_ref, provided_by,
             install_date_approx, config ? JSON.stringify(config) : '{}']
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/components/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, brand, model, serial_number, quantity, firmware_version,
            ip_address, mac_address, cable_category, status, notes,
            location, po_number, proposal_ref, service_call_ref, provided_by,
            install_date_approx, config } = req.body;
    try {
        const result = await pool.query(
            `UPDATE components SET name=$1, type=$2, brand=$3, model=$4, serial_number=$5,
             quantity=$6, firmware_version=$7, ip_address=$8, mac_address=$9,
             cable_category=$10, status=$11, notes=$12,
             location=$13, po_number=$14, proposal_ref=$15, service_call_ref=$16,
             provided_by=$17, install_date_approx=$18, config=COALESCE($19, config),
             updated_at=NOW() WHERE id=$20 RETURNING *`,
            [name, type, brand, model, serial_number, quantity, firmware_version,
             ip_address, mac_address, cable_category, status, notes,
             location, po_number, proposal_ref, service_call_ref, provided_by,
             install_date_approx, config ? JSON.stringify(config) : null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/components/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM components WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// ============================================================================
// SITE SYSTEM INFO ROUTES
// system_info is a single JSONB column on sites, shaped exactly like
// ~/Guey/Abuelo/Memory/accounts/_TEMPLATE_system-info.json (11 categories, each
// with status/brand/platform/category-specific fields, plus a top-level
// general_notes string). PUT merges the given object into the existing
// JSONB (shallow, per top-level key) rather than requiring the full blob
// on every write.
// ============================================================================

app.get('/api/sites/:siteId/system-info', async (req, res) => {
    const { siteId } = req.params;
    try {
        const result = await pool.query(
            'SELECT system_info FROM sites WHERE id = $1',
            [siteId]
        );
        if (result.rows.length === 0) {
            res.json(null);
        } else {
            res.json(result.rows[0].system_info || {});
        }
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/sites/:siteId/system-info', async (req, res) => {
    const { siteId } = req.params;
    const patch = req.body || {};
    try {
        const result = await pool.query(
            `UPDATE sites SET system_info = COALESCE(system_info, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW() WHERE id = $1 RETURNING system_info`,
            [siteId, JSON.stringify(patch)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0].system_info);
    } catch (err) {
        console.error('PUT /api/sites/:siteId/system-info error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// SUBSCRIPTIONS ROUTES (licenses/subscriptions tied to a system, e.g. an
// access-control cloud license or a camera NVR's cloud storage plan)
// ============================================================================

app.get('/api/systems/:systemId/subscriptions', async (req, res) => {
    const { systemId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM subscriptions WHERE system_id = $1 ORDER BY id',
            [systemId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/systems/:systemId/subscriptions', async (req, res) => {
    const { systemId } = req.params;
    const { service, term, expires_approx, note } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO subscriptions (system_id, service, term, expires_approx, note)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [systemId, service, term, expires_approx, note]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/subscriptions/:id', async (req, res) => {
    const { id } = req.params;
    const { service, term, expires_approx, note } = req.body;
    try {
        const result = await pool.query(
            `UPDATE subscriptions SET service=$1, term=$2, expires_approx=$3, note=$4
             WHERE id=$5 RETURNING *`,
            [service, term, expires_approx, note, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/subscriptions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM subscriptions WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// INTERACTIONS ROUTES
// ============================================================================

app.get('/api/sites/:siteId/interactions', async (req, res) => {
    const { siteId } = req.params;
    try {
        const result = await pool.query(`
            SELECT i.*,
                   p.first_name || ' ' || p.last_name AS person_name,
                   v.name AS vendor_name,
                   a.name AS account_name
            FROM interactions i
            LEFT JOIN people p ON p.id = i.person_id
            LEFT JOIN vendors v ON v.id = i.vendor_id
            LEFT JOIN accounts a ON a.id = i.account_id
            WHERE i.site_id = $1
            ORDER BY i.interaction_date DESC
        `, [siteId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/sites/:siteId/interactions', async (req, res) => {
    const { siteId } = req.params;
    const { system_id, component_id, person_id, vendor_id, interaction_type,
            is_service, interaction_date, description, cost, warranty_claim,
            invoice_number, notes, account_id } = req.body;
    try {
        // Cast string booleans from import tool
        const castBool = (val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') return val.toLowerCase() === 'true';
            return Boolean(val);
        };
        const result = await pool.query(
            `INSERT INTO interactions (site_id, system_id, component_id, person_id, vendor_id,
             interaction_type, is_service, interaction_date, description, cost,
             warranty_claim, invoice_number, notes, account_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [siteId, system_id, component_id, person_id, vendor_id, interaction_type,
             castBool(is_service), interaction_date, description, cost,
             castBool(warranty_claim), invoice_number, notes, account_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/sites/:siteId/interactions error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/interactions/:id', async (req, res) => {
    const { id } = req.params;
    const { system_id, component_id, person_id, vendor_id, interaction_type,
            is_service, interaction_date, description, cost, warranty_claim,
            invoice_number, notes, account_id } = req.body;
    try {
        const castBool = (val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') return val.toLowerCase() === 'true';
            return Boolean(val);
        };
        const result = await pool.query(
            `UPDATE interactions SET system_id=$1, component_id=$2, person_id=$3,
             vendor_id=$4, interaction_type=$5, is_service=$6, interaction_date=$7,
             description=$8, cost=$9, warranty_claim=$10, invoice_number=$11,
             notes=$12, account_id=$13 WHERE id=$14 RETURNING *`,
            [system_id, component_id, person_id, vendor_id, interaction_type,
             castBool(is_service), interaction_date, description, cost, castBool(warranty_claim),
             invoice_number, notes, account_id, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/interactions/:id error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/interactions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // interaction_person rows have no ON DELETE CASCADE, so they must be
        // cleared first or the FK blocks deletion of any multi-participant
        // interaction (found 2026-08-31 during 320-N-Sangamon dedup cleanup).
        await pool.query('DELETE FROM interaction_person WHERE interaction_id = $1', [id]);
        await pool.query('DELETE FROM components_used WHERE interaction_id = $1', [id]);
        await pool.query('DELETE FROM interactions WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// Generic POST /api/interactions (optional site_id)
app.post('/api/interactions', async (req, res) => {
    const { site_id, system_id, component_id, person_id, vendor_id, interaction_type,
            is_service, interaction_date, description, cost, warranty_claim,
            invoice_number, notes, account_id } = req.body;
    try {
        const castBool = (val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'boolean') return val;
            if (typeof val === 'string') return val.toLowerCase() === 'true';
            return Boolean(val);
        };
        const result = await pool.query(
            `INSERT INTO interactions (site_id, system_id, component_id, person_id, vendor_id,
             interaction_type, is_service, interaction_date, description, cost,
             warranty_claim, invoice_number, notes, account_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [site_id, system_id, component_id, person_id, vendor_id, interaction_type,
             castBool(is_service), interaction_date, description, cost, castBool(warranty_claim),
             invoice_number, notes, account_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/interactions error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Generic POST /api/components (optional system_id)
app.post('/api/components', async (req, res) => {
    const { system_id, name, type, brand, model, serial_number, quantity,
            firmware_version, ip_address, mac_address, cable_category, status, notes,
            location, po_number, proposal_ref, service_call_ref, provided_by,
            install_date_approx, config } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO components (system_id, name, type, brand, model, serial_number,
             quantity, firmware_version, ip_address, mac_address, cable_category, status, notes,
             location, po_number, proposal_ref, service_call_ref, provided_by, install_date_approx, config)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *`,
            [system_id, name, type, brand, model, serial_number, quantity || 1,
             firmware_version, ip_address, mac_address, cable_category, status || 'online', notes,
             location, po_number, proposal_ref, service_call_ref, provided_by,
             install_date_approx, config ? JSON.stringify(config) : '{}']
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Generic POST /api/systems (optional site_id)
app.post('/api/systems', async (req, res) => {
    const { site_id, name, category, brand, model, install_date,
            warranty_expires, status, notes, extra, integrated_with_control_system } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO systems (site_id, name, category, brand, model, install_date,
             warranty_expires, status, notes, extra, integrated_with_control_system)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [site_id, name, category, brand, model, install_date, warranty_expires, status || 'active', notes,
             extra ? JSON.stringify(extra) : '{}', integrated_with_control_system ?? null]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// CREDENTIALS ROUTES (protected)
// ============================================================================

app.get('/api/credentials', requireAuth, requireManager, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM credentials ORDER BY label');
        // Decrypt usernames and passwords before sending
        const decrypted = result.rows.map(row => ({
            ...row,
            username: decrypt(row.username),
            password: decrypt(row.password)
        }));
        res.json(decrypted);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/credentials', requireAuth, requireManager, async (req, res) => {
    const { site_id, system_id, label, username, password, notes } = req.body;
    try {
        const encUsername = encrypt(username || '');
        const encPassword = encrypt(password || '');
        const result = await pool.query(
            `INSERT INTO credentials (site_id, system_id, label, username, password, notes)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [site_id, system_id, label, encUsername, encPassword, notes]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.put('/api/credentials/:id', requireAuth, requireManager, async (req, res) => {
    const { id } = req.params;
    const { site_id, system_id, label, username, password, notes } = req.body;
    try {
        const encUsername = encrypt(username || '');
        const encPassword = encrypt(password || '');
        const result = await pool.query(
            `UPDATE credentials SET site_id=$1, system_id=$2, label=$3,
             username=$4, password=$5, notes=$6 WHERE id=$7 RETURNING *`,
            [site_id, system_id, label, encUsername, encPassword, notes, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/credentials/:id', requireAuth, requireManager, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM credentials WHERE id = $1', [id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// ============================================================================
// RECORD VIEWS (one call per record page — account/person/site/vendor,
// each with its full nested web of relationships). Credentials are
// deliberately excluded here and served only via the protected
// /credentials endpoints below, so the security boundary that already
// exists on GET /api/credentials holds for these too once auth is back on.
// ============================================================================

app.get('/api/accounts/:id/full', async (req, res) => {
    const { id } = req.params;
    try {
        const acctR = await pool.query(`
            SELECT a.*, sl.label AS service_level_label
            FROM accounts a LEFT JOIN service_levels sl ON sl.id = a.service_level
            WHERE a.id = $1
        `, [id]);
        if (acctR.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const account = acctR.rows[0];

        const peopleR = await pool.query(`
            SELECT pa.person_id, pa.is_primary_account_holder, pa.is_billing_contact,
                   pa.is_correspondent, pa.is_vip, pa.role_label,
                   p.first_name, p.last_name, p.email, p.phone, p.next_contact_date
            FROM person_account pa JOIN people p ON p.id = pa.person_id
            WHERE pa.account_id = $1
            ORDER BY pa.is_primary_account_holder DESC, p.last_name, p.first_name
        `, [id]);

        const sitesR = await pool.query(`
            SELECT s.* FROM sites s
            JOIN site_account sa ON sa.site_id = s.id
            WHERE sa.account_id = $1
            ORDER BY s.address_line1
        `, [id]);
        const sites = sitesR.rows;
        const siteIds = sites.map(s => s.id);

        let interactions = [];
        const vendorMap = new Map();
        if (siteIds.length > 0) {
            const sysR = await pool.query('SELECT * FROM systems WHERE site_id = ANY($1) ORDER BY name', [siteIds]);
            const systemsBySite = {};
            for (const sys of sysR.rows) (systemsBySite[sys.site_id] ||= []).push(sys);

            const systemIds = sysR.rows.map(s => s.id);
            const componentsBySystem = {};
            if (systemIds.length > 0) {
                const compR = await pool.query('SELECT * FROM components WHERE system_id = ANY($1) ORDER BY name', [systemIds]);
                for (const c of compR.rows) (componentsBySystem[c.system_id] ||= []).push(c);
            }
            for (const s of sites) {
                s.systems = (systemsBySite[s.id] || []).map(sys => ({ ...sys, components: componentsBySystem[sys.id] || [] }));
            }

            const intR = await pool.query(`
                SELECT i.*, p.first_name || ' ' || p.last_name AS person_name,
                       v.name AS vendor_name, s.address_line1 AS site_address
                FROM interactions i
                LEFT JOIN people p ON p.id = i.person_id
                LEFT JOIN vendors v ON v.id = i.vendor_id
                LEFT JOIN sites s ON s.id = i.site_id
                WHERE i.site_id = ANY($1)
                ORDER BY i.interaction_date DESC NULLS LAST
            `, [siteIds]);
            interactions = intR.rows;
            for (const i of interactions) {
                if (i.vendor_id && !vendorMap.has(i.vendor_id)) vendorMap.set(i.vendor_id, { id: i.vendor_id, name: i.vendor_name });
            }
        } else {
            for (const s of sites) s.systems = [];
        }

        res.json({ account, people: peopleR.rows, sites, interactions, vendors: [...vendorMap.values()] });
    } catch (err) {
        console.error('GET /api/accounts/:id/full error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/people/:id/full', async (req, res) => {
    const { id } = req.params;
    try {
        const pR = await pool.query('SELECT * FROM people WHERE id = $1', [id]);
        if (pR.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const acctR = await pool.query(`
            SELECT pa.account_id, pa.is_primary_account_holder, pa.is_billing_contact,
                   pa.is_correspondent, pa.is_vip AS person_is_vip, pa.role_label, a.name AS account_name,
                   a.is_vip AS account_is_vip, a.billing_status
            FROM person_account pa JOIN accounts a ON a.id = pa.account_id
            WHERE pa.person_id = $1 ORDER BY a.name
        `, [id]);

        const siteR = await pool.query(`
            SELECT ps.site_id, ps.role, ps.is_primary_contact,
                   s.address_line1, s.city, s.state, s.zip, s.site_type
            FROM person_site ps JOIN sites s ON s.id = ps.site_id
            WHERE ps.person_id = $1 ORDER BY s.address_line1
        `, [id]);

        const vendorR = await pool.query(`
            SELECT pv.vendor_id, v.name AS vendor_name, pv.role_label, pv.notes AS link_notes
            FROM person_vendor pv JOIN vendors v ON v.id = pv.vendor_id
            WHERE pv.person_id = $1 ORDER BY v.name
        `, [id]);

        const intR = await pool.query(`
            SELECT DISTINCT i.*, s.address_line1 AS site_address, a.name AS account_name,
                   v.name AS vendor_name,
                   CASE WHEN i.person_id = $1 THEN 'primary' ELSE ip.relationship END AS person_role
            FROM interactions i
            LEFT JOIN interaction_person ip ON ip.interaction_id = i.id AND ip.person_id = $1
            LEFT JOIN sites s ON s.id = i.site_id
            LEFT JOIN accounts a ON a.id = i.account_id
            LEFT JOIN vendors v ON v.id = i.vendor_id
            WHERE i.person_id = $1 OR ip.person_id = $1
            ORDER BY i.interaction_date DESC NULLS LAST
        `, [id]);

        res.json({ person: pR.rows[0], accounts: acctR.rows, sites: siteR.rows, vendors: vendorR.rows, interactions: intR.rows });
    } catch (err) {
        console.error('GET /api/people/:id/full error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/sites/:id/full', async (req, res) => {
    const { id } = req.params;
    try {
        const sR = await pool.query(`
            SELECT s.*, fh.first_name || ' ' || fh.last_name AS former_homeowner_name
            FROM sites s LEFT JOIN people fh ON fh.id = s.former_homeowner_id
            WHERE s.id = $1
        `, [id]);
        if (sR.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const acctR = await pool.query(`
            SELECT a.id, a.name, a.is_vip, a.billing_status, sl.label AS service_level_label
            FROM site_account sa JOIN accounts a ON a.id = sa.account_id
            LEFT JOIN service_levels sl ON sl.id = a.service_level
            WHERE sa.site_id = $1
        `, [id]);

        const peopleR = await pool.query(`
            SELECT ps.person_id, ps.role, ps.is_primary_contact,
                   p.first_name, p.last_name, p.email, p.phone
            FROM person_site ps JOIN people p ON p.id = ps.person_id
            WHERE ps.site_id = $1
            ORDER BY ps.is_primary_contact DESC, p.last_name
        `, [id]);

        const sysR = await pool.query('SELECT * FROM systems WHERE site_id = $1 ORDER BY name', [id]);
        const systemIds = sysR.rows.map(s => s.id);
        const componentsBySystem = {};
        const subsBySystem = {};
        if (systemIds.length > 0) {
            const compR = await pool.query('SELECT * FROM components WHERE system_id = ANY($1) ORDER BY name', [systemIds]);
            for (const c of compR.rows) (componentsBySystem[c.system_id] ||= []).push(c);
            const subR = await pool.query('SELECT * FROM subscriptions WHERE system_id = ANY($1)', [systemIds]);
            for (const s2 of subR.rows) (subsBySystem[s2.system_id] ||= []).push(s2);
        }
        const systems = sysR.rows.map(sys => ({ ...sys, components: componentsBySystem[sys.id] || [], subscriptions: subsBySystem[sys.id] || [] }));

        const intR = await pool.query(`
            SELECT i.*, p.first_name || ' ' || p.last_name AS person_name, v.name AS vendor_name
            FROM interactions i
            LEFT JOIN people p ON p.id = i.person_id
            LEFT JOIN vendors v ON v.id = i.vendor_id
            WHERE i.site_id = $1
            ORDER BY i.interaction_date DESC NULLS LAST
        `, [id]);

        res.json({ site: sR.rows[0], accounts: acctR.rows, people: peopleR.rows, systems, interactions: intR.rows });
    } catch (err) {
        console.error('GET /api/sites/:id/full error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/vendors/:id/full', async (req, res) => {
    const { id } = req.params;
    try {
        const vR = await pool.query('SELECT * FROM vendors WHERE id = $1', [id]);
        if (vR.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const intR = await pool.query(`
            SELECT i.*, s.address_line1 AS site_address, a.name AS account_name,
                   p.first_name || ' ' || p.last_name AS person_name
            FROM interactions i
            LEFT JOIN sites s ON s.id = i.site_id
            LEFT JOIN accounts a ON a.id = i.account_id
            LEFT JOIN people p ON p.id = i.person_id
            WHERE i.vendor_id = $1
            ORDER BY i.interaction_date DESC NULLS LAST
        `, [id]);
        const peopleR = await pool.query(`
            SELECT pv.person_id, pv.role_label, pv.notes AS link_notes,
                   p.first_name, p.last_name, p.email, p.phone,
                   COALESCE(pa_agg.accounts, '[]') AS accounts
            FROM person_vendor pv
            JOIN people p ON p.id = pv.person_id
            LEFT JOIN LATERAL (
                SELECT json_agg(json_build_object('account_id', a.id, 'account_name', a.name))
                FROM person_account pa JOIN accounts a ON a.id = pa.account_id
                WHERE pa.person_id = p.id
            ) pa_agg(accounts) ON true
            WHERE pv.vendor_id = $1
            ORDER BY p.last_name, p.first_name
        `, [id]);
        res.json({ vendor: vR.rows[0], interactions: intR.rows, people: peopleR.rows });
    } catch (err) {
        console.error('GET /api/vendors/:id/full error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Vendor → People (via person_vendor junction table)
app.get('/api/vendors/:id/people', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT pv.person_id, p.first_name, p.last_name, p.email, p.phone,
                   pv.role_label, pv.notes AS link_notes
            FROM person_vendor pv
            JOIN people p ON p.id = pv.person_id
            WHERE pv.vendor_id = $1
            ORDER BY p.last_name, p.first_name
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Person → Vendors (via person_vendor junction table)
app.get('/api/people/:id/vendors', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT pv.vendor_id, v.name AS vendor_name, pv.role_label, pv.notes AS link_notes
            FROM person_vendor pv
            JOIN vendors v ON v.id = pv.vendor_id
            WHERE pv.person_id = $1
            ORDER BY v.name
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Link a person to a vendor
app.post('/api/relationships/person-vendor', async (req, res) => {
    const { person_id, vendor_id, role_label, notes } = req.body;
    try {
        await pool.query(
            `INSERT INTO person_vendor (person_id, vendor_id, role_label, notes)
             VALUES ($1, $2, $3, $4) ON CONFLICT (person_id, vendor_id) DO UPDATE SET
             role_label=$3, notes=$4`,
            [person_id, vendor_id, role_label, notes]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('POST /api/relationships/person-vendor error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Credentials scoped to an account/site — same protection as GET /api/credentials.
app.get('/api/accounts/:id/credentials', requireAuth, requireManager, async (req, res) => {
    const { id } = req.params;
    try {
        const r = await pool.query(`
            SELECT c.* FROM credentials c
            JOIN site_account sa ON sa.site_id = c.site_id
            WHERE sa.account_id = $1 ORDER BY c.label
        `, [id]);
        res.json(r.rows.map(row => ({ ...row, username: decrypt(row.username), password: decrypt(row.password) })));
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/sites/:id/credentials', requireAuth, requireManager, async (req, res) => {
    const { id } = req.params;
    try {
        const r = await pool.query('SELECT * FROM credentials WHERE site_id = $1 ORDER BY label', [id]);
        res.json(r.rows.map(row => ({ ...row, username: decrypt(row.username), password: decrypt(row.password) })));
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// HIERARCHICAL ACCOUNT VIEW (expanded with nested data)
// ============================================================================

app.get('/api/accounts/hierarchical', requireAuth, async (req, res) => {
    try {
        const accounts = await pool.query(`
            SELECT a.*, sl.label AS service_level_label
            FROM accounts a
            LEFT JOIN service_levels sl ON sl.id = a.service_level
            ORDER BY a.name
        `);

        const result = [];
        for (const acct of accounts.rows) {
            // Get people for this account (via person_account)
            const peopleResult = await pool.query(`
                SELECT pa.person_id, pa.is_primary_account_holder, pa.is_billing_contact,
                       pa.role, p.first_name, p.last_name, p.email, p.phone
                FROM person_account pa
                JOIN people p ON p.id = pa.person_id
                WHERE pa.account_id = $1
                ORDER BY pa.is_primary_account_holder DESC, p.last_name, p.first_name
            `, [acct.id]);

            // Get sites for this account (via site_account)
            const sitesResult = await pool.query(`
                SELECT sa.site_id, s.address_line1, s.address_line2, s.city, s.state, s.zip,
                       s.site_type, s.primary_contact_id, s.former_homeowner_id
                FROM site_account sa
                JOIN sites s ON s.id = sa.site_id
                WHERE sa.account_id = $1
                ORDER BY s.address_line1
            `, [acct.id]);

            // Get interactions for this account (via sites)
            const siteIds = sitesResult.rows.map(s => s.site_id);
            let interactions = [];
            if (siteIds.length > 0) {
                const intResult = await pool.query(`
                    SELECT i.*, p.first_name, p.last_name AS person_name
                    FROM interactions i
                    LEFT JOIN people p ON p.id = i.person_id
                    WHERE i.site_id = ANY($1)
                    ORDER BY i.interaction_date DESC
                `, [siteIds]);
                interactions = intResult.rows;
            }

            // Get primary contact name for each site
            for (const site of sitesResult.rows) {
                if (site.primary_contact_id) {
                    const pcResult = await pool.query(
                        'SELECT first_name, last_name FROM people WHERE id = $1',
                        [site.primary_contact_id]
                    );
                    site.primary_contact_name = pcResult.rows[0]
                        ? pcResult.rows[0].first_name + ' ' + pcResult.rows[0].last_name
                        : null;
                }
            }

            result.push({
                ...acct,
                people: peopleResult.rows,
                sites: sitesResult.rows,
                interactions: interactions
            });
        }

        res.json(result);
    } catch (err) {
        console.error('GET /api/accounts/hierarchical error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// SEARCH (global + scoped)
// ============================================================================

app.get('/api/search', requireAuth, async (req, res) => {
    const { q, type } = req.query;
    if (!q) return res.json({ people: [], accounts: [], sites: [], vendors: [] });

    const pattern = `%${q}%`;
    try {
        const result = { people: [], accounts: [], sites: [], vendors: [] };

        if (!type || type === 'people') {
            const r = await pool.query(
                "SELECT id, first_name, last_name, email, phone FROM people WHERE (first_name || ' ' || last_name) ILIKE $1 OR email ILIKE $1 ORDER BY last_name, first_name",
                [pattern]
            );
            result.people = r.rows;
        }
        if (!type || type === 'accounts') {
            const r = await pool.query(
                'SELECT id, name FROM accounts WHERE name ILIKE $1 ORDER BY name',
                [pattern]
            );
            result.accounts = r.rows;
        }
        if (!type || type === 'sites') {
            const r = await pool.query(
                'SELECT id, address_line1, city, state, zip FROM sites WHERE address_line1 ILIKE $1 OR city ILIKE $1 ORDER BY address_line1',
                [pattern]
            );
            result.sites = r.rows;
        }
        if (!type || type === 'vendors') {
            const r = await pool.query(
                'SELECT id, name, specialty FROM vendors WHERE name ILIKE $1 OR specialty ILIKE $1 ORDER BY name',
                [pattern]
            );
            result.vendors = r.rows;
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// INTERACTIONS BY ACCOUNT (via sites)
// ============================================================================

app.get('/api/accounts/:id/interactions', async (req, res) => {
    const { id } = req.params;
    try {
        const sitesResult = await pool.query(
            'SELECT site_id FROM site_account WHERE account_id = $1',
            [id]
        );
        const siteIds = sitesResult.rows.map(s => s.site_id);

        if (siteIds.length === 0) return res.json([]);

        const intResult = await pool.query(`
            SELECT i.*, s.address_line1, s.city, s.state, s.zip,
                   p.first_name, p.last_name AS person_name
            FROM interactions i
            LEFT JOIN sites s ON s.id = i.site_id
            LEFT JOIN people p ON p.id = i.person_id
            WHERE i.site_id = ANY($1)
            ORDER BY i.interaction_date DESC
        `, [siteIds]);

        res.json(intResult.rows);
    } catch (err) {
        console.error('GET /api/accounts/:id/interactions error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// DASHBOARD / SUMMARY
// ============================================================================

app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const [peopleCount, sitesCount, accountsCount, vipCount, systemsCount, componentsCount,
               recentInteractions, busiestAccounts, followUps] = await Promise.all([
            pool.query('SELECT count(*) FROM people'),
            pool.query('SELECT count(*) FROM sites'),
            pool.query('SELECT count(*) FROM accounts'),
            pool.query('SELECT count(*) FROM accounts WHERE is_vip = true'),
            pool.query("SELECT count(*) FROM systems WHERE status = 'active'"),
            pool.query("SELECT count(*) FROM components WHERE status = 'online'"),
            pool.query(`
                SELECT i.*, s.address_line1 AS site_address, a.name AS account_name,
                       p.first_name || ' ' || p.last_name AS person_name, v.name AS vendor_name
                FROM interactions i
                LEFT JOIN sites s ON s.id = i.site_id
                LEFT JOIN accounts a ON a.id = i.account_id
                LEFT JOIN people p ON p.id = i.person_id
                LEFT JOIN vendors v ON v.id = i.vendor_id
                WHERE i.interaction_date >= NOW() - INTERVAL '30 days'
                ORDER BY i.interaction_date DESC LIMIT 10
            `),
            pool.query(`
                SELECT a.id AS account_id, a.name AS account_name, a.is_vip,
                       COUNT(*) FILTER (WHERE i.is_service) AS issue_count,
                       COUNT(*) AS interaction_count
                FROM interactions i
                JOIN accounts a ON a.id = i.account_id
                WHERE i.interaction_date >= NOW() - INTERVAL '30 days'
                GROUP BY a.id, a.name, a.is_vip
                HAVING COUNT(*) FILTER (WHERE i.is_service) > 0
                ORDER BY issue_count DESC, interaction_count DESC
                LIMIT 8
            `),
            pool.query(`
                SELECT 'account' AS entity_type, id, name AS label, next_contact_date, is_vip
                FROM accounts WHERE next_contact_date IS NOT NULL AND next_contact_date <= CURRENT_DATE + INTERVAL '7 days'
                UNION ALL
                SELECT 'person', id, first_name || ' ' || last_name, next_contact_date, false
                FROM people WHERE next_contact_date IS NOT NULL AND next_contact_date <= CURRENT_DATE + INTERVAL '7 days'
                UNION ALL
                SELECT 'site', id, address_line1, next_contact_date, false
                FROM sites WHERE next_contact_date IS NOT NULL AND next_contact_date <= CURRENT_DATE + INTERVAL '7 days'
                ORDER BY next_contact_date ASC
            `)
        ]);
        res.json({
            people: parseInt(peopleCount.rows[0].count),
            sites: parseInt(sitesCount.rows[0].count),
            accounts: parseInt(accountsCount.rows[0].count),
            vipAccounts: parseInt(vipCount.rows[0].count),
            activeSystems: parseInt(systemsCount.rows[0].count),
            onlineComponents: parseInt(componentsCount.rows[0].count),
            recentInteractions: recentInteractions.rows,
            busiestAccounts: busiestAccounts.rows,
            followUps: followUps.rows
        });
    } catch (err) {
        console.error('GET /api/dashboard error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// GENERIC LIST ROUTES (needed by the import tool's dedup + the front end)
// ============================================================================

app.get('/api/systems', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sys.*, s.address_line1 AS site_address
            FROM systems sys
            LEFT JOIN sites s ON s.id = sys.site_id
            ORDER BY sys.name
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/components', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM components ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/interactions', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*,
                   s.address_line1 AS site_address,
                   p.first_name || ' ' || p.last_name AS person_name,
                   v.name AS vendor_name,
                   a.name AS account_name
            FROM interactions i
            LEFT JOIN sites s ON s.id = i.site_id
            LEFT JOIN people p ON p.id = i.person_id
            LEFT JOIN vendors v ON v.id = i.vendor_id
            LEFT JOIN accounts a ON a.id = i.account_id
            ORDER BY i.interaction_date DESC NULLS LAST
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/site_system_info', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id AS site_id, system_info FROM sites WHERE system_info IS NOT NULL AND system_info != '{}'::jsonb"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================================================
// SERVE FRONT-END
// ============================================================================

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Coffee Corner running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser.`);
});
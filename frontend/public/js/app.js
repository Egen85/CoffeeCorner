/* ============================================================================
   Coffee Corner — Front-end Application
   Account-centric record pages over a hash router. Each entity has a list
   view (searchable table) and a record view (full nested detail, reusing
   the /full aggregate endpoints server.js exposes per entity).
   ============================================================================ */

const API = '/api';
let currentUser = null;

// ============================================================================
// INIT + ROUTER
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => { location.hash = '#/' + item.dataset.route; });
    });

    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('setup-form').addEventListener('submit', handleSetup);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    const searchInput = document.getElementById('global-search-input');
    searchInput.addEventListener('input', debounce(runGlobalSearch, 250));
    searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) runGlobalSearch(); });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.global-search')) closeSearchResults();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('modal').classList.contains('active')) closeModal();
        else closeSearchResults();
    });

    window.addEventListener('hashchange', router);

    checkAuth();
});

function router() {
    const hash = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    const section = parts[0] || 'dashboard';
    const id = parts[1] ? parseInt(parts[1], 10) : null;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === section));

    const root = document.getElementById('view-root');
    root.innerHTML = '<div class="loading-row">Loading…</div>';

    switch (section) {
        case 'dashboard': return renderDashboard(root);
        case 'accounts': return id ? renderAccountRecord(root, id) : renderAccountsList(root);
        case 'people': return id ? renderPersonRecord(root, id) : renderPeopleList(root);
        case 'sites': return id ? renderSiteRecord(root, id) : renderSitesList(root);
        case 'vendors': return id ? renderVendorRecord(root, id) : renderVendorsList(root);
        default: return renderDashboard(root);
    }
}

function goTo(path) { location.hash = '#/' + path; }

function checkAuth() {
    fetch(`${API}/auth/status`)
        .then(r => r.json())
        .then(data => {
            if (data.error) checkSetupNeeded();
            else { currentUser = data; showApp(); }
        })
        .catch(() => checkSetupNeeded());
}

async function checkSetupNeeded() {
    try {
        const r = await fetch(`${API}/setup/needed`);
        const data = await r.json();
        if (data.needed) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('setup-screen').style.display = 'flex';
        }
    } catch {
        document.getElementById('login-screen').style.display = 'flex';
    }
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('user-display').textContent = currentUser.name;
    router();
}

// ============================================================================
// AUTH
// ============================================================================

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    try {
        const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await r.json();
        if (data.error) showToast('Invalid credentials');
        else { currentUser = data; showApp(); }
    } catch { showToast('Server error'); }
}

async function handleSetup(e) {
    e.preventDefault();
    const username = document.getElementById('setup-username').value;
    const name = document.getElementById('setup-name').value;
    const password = document.getElementById('setup-password').value;
    const confirm = document.getElementById('setup-confirm').value;
    if (password !== confirm) return showToast('Passwords do not match');
    try {
        const r = await fetch(`${API}/setup-admin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, name }) });
        const data = await r.json();
        if (data.ok) {
            showToast('Admin account created — log in now.');
            document.getElementById('setup-screen').style.display = 'none';
            document.getElementById('login-screen').style.display = 'flex';
        }
    } catch { showToast('Server error'); }
}

async function handleLogout() {
    await fetch(`${API}/auth/logout`, { method: 'POST' });
    currentUser = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
}

// ============================================================================
// API HELPER
// ============================================================================

async function api(path, opts) {
    const r = await fetch(`${API}${path}`, opts);
    let body = null;
    try { body = await r.json(); } catch { /* empty body */ }
    if (!r.ok) throw new Error((body && body.error) || `Request failed (${r.status})`);
    return body;
}

// ============================================================================
// GLOBAL SEARCH
// ============================================================================

async function runGlobalSearch() {
    const q = document.getElementById('global-search-input').value.trim();
    const box = document.getElementById('global-search-results');
    if (!q) { closeSearchResults(); return; }
    try {
        const data = await api(`/search?q=${encodeURIComponent(q)}`);
        const groups = [
            ['Accounts', data.accounts, a => ({ label: a.name, go: `accounts/${a.id}` })],
            ['People', data.people, p => ({ label: `${p.first_name || ''} ${p.last_name || ''}`.trim(), sub: p.email, go: `people/${p.id}` })],
            ['Sites', data.sites, s => ({ label: s.address_line1, sub: [s.city, s.state].filter(Boolean).join(', '), go: `sites/${s.id}` })],
            ['Vendors', data.vendors, v => ({ label: v.name, sub: v.specialty, go: `vendors/${v.id}` })]
        ];
        const nonEmpty = groups.filter(([, rows]) => rows && rows.length);
        if (nonEmpty.length === 0) {
            box.innerHTML = `<div class="sr-empty">No matches for "${esc(q)}"</div>`;
        } else {
            box.innerHTML = nonEmpty.map(([label, rows, mapFn]) => `
                <div class="sr-group-label">${label}</div>
                ${rows.slice(0, 6).map(row => {
                    const m = mapFn(row);
                    return `<div class="sr-item" onclick="goToSearchResult('${m.go}')"><strong>${esc(m.label)}</strong>${m.sub ? ' — ' + esc(m.sub) : ''}</div>`;
                }).join('')}
            `).join('');
        }
        box.classList.add('open');
    } catch { closeSearchResults(); }
}

function goToSearchResult(path) {
    closeSearchResults();
    document.getElementById('global-search-input').value = '';
    goTo(path);
}

function closeSearchResults() {
    const box = document.getElementById('global-search-results');
    box.classList.remove('open');
}

// ============================================================================
// DASHBOARD
// ============================================================================

async function renderDashboard(root) {
    try {
        const data = await api('/dashboard');
        root.innerHTML = `
            <div class="page-header"><h1>Dashboard</h1></div>
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${data.accounts}</div><div class="stat-label">Accounts</div></div>
                <div class="stat-card accent"><div class="stat-value">${data.vipAccounts}</div><div class="stat-label">VIP Accounts</div></div>
                <div class="stat-card"><div class="stat-value">${data.people}</div><div class="stat-label">People</div></div>
                <div class="stat-card"><div class="stat-value">${data.sites}</div><div class="stat-label">Sites</div></div>
                <div class="stat-card"><div class="stat-value">${data.activeSystems}</div><div class="stat-label">Active Systems</div></div>
                <div class="stat-card"><div class="stat-value">${data.onlineComponents}</div><div class="stat-label">Online Devices</div></div>
            </div>
            <div class="panels">
                <div class="panel">
                    <h3>Follow Up Soon</h3>
                    ${listOrEmpty(data.followUps, f => `
                        <div class="item">
                            <a class="name-link" onclick="goTo('${f.entity_type}s/${f.id}')">${esc(f.label)}</a>
                            ${f.is_vip ? '<span class="badge badge-vip">VIP</span> ' : ''}
                            — ${fmtDate(f.next_contact_date)}
                        </div>
                    `, 'Nothing due in the next 7 days')}
                </div>
                <div class="panel">
                    <h3>Recent Interactions</h3>
                    ${renderRecentInteractions(data.recentInteractions)}
                </div>
                <div class="panel panel-placeholder">
                    <h3>Upcoming Service Calls</h3>
                    <div class="panel-placeholder-body">Coming soon</div>
                </div>
            </div>
            <div class="panels-2" style="margin-top:20px">
                <div class="panel">
                    <h3>Most Active Accounts <span class="text-muted" style="font-weight:400">— last 30 days</span></h3>
                    ${listOrEmpty(data.busiestAccounts, a => `
                        <div class="item" style="display:flex; justify-content:space-between; align-items:center">
                            <span>
                                <a class="name-link" onclick="goTo('accounts/${a.account_id}')">${esc(a.account_name)}</a>
                                ${a.is_vip ? ' <span class="badge badge-vip">VIP</span>' : ''}
                            </span>
                            <span><span class="badge badge-fault">${a.issue_count} issue${a.issue_count == 1 ? '' : 's'}</span></span>
                        </div>
                    `, 'No service activity in the last 30 days')}
                </div>
                <div class="panel panel-placeholder">
                    <h3>Service Calls <span class="text-muted" style="font-weight:400">— last 30 days</span></h3>
                    <div class="panel-placeholder-body">Coming soon</div>
                </div>
            </div>
        `;
    } catch {
        root.innerHTML = '<div class="empty-state">Failed to load dashboard.</div>';
    }
}

function listOrEmpty(rows, mapFn, emptyMsg) {
    if (!rows || rows.length === 0) return `<div class="item-empty">${emptyMsg}</div>`;
    return rows.map(mapFn).join('');
}

function dateGroupLabel(dateStr) {
    if (!dateStr) return 'No Date';
    const d = new Date(dateStr);
    if (isNaN(d)) return 'No Date';
    // interaction_date is a DATE column (no time-of-day), so compare in UTC
    // to avoid the local timezone shifting it onto the wrong day.
    const dayStart = (dt) => Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    const diffDays = Math.round((dayStart(new Date()) - dayStart(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function renderRecentInteractions(rows) {
    if (!rows || rows.length === 0) return '<div class="item-empty">No recent interactions</div>';
    let html = '';
    let lastGroup = null;
    for (const i of rows) {
        const group = dateGroupLabel(i.interaction_date);
        if (group !== lastGroup) {
            html += `<div class="group-label">${esc(group)}</div>`;
            lastGroup = group;
        }
        const who = i.person_name || i.vendor_name || i.account_name || 'Unknown';
        html += `
            <div class="item">
                <div class="item-person">${esc(who)}</div>
                <div class="item-type">
                    ${esc(labelize(i.interaction_type))}
                    ${i.account_name ? ' · <a class="name-link" onclick="goTo(\'accounts/' + i.account_id + '\')">' + esc(i.account_name) + '</a>' : ''}
                    ${i.is_service ? ' <span class="badge badge-service">Service</span>' : ''}
                </div>
            </div>
        `;
    }
    return html;
}

// ============================================================================
// ACCOUNTS
// ============================================================================

async function renderAccountsList(root) {
    root.innerHTML = `
        <div class="page-header">
            <h1>Accounts</h1>
            <div class="actions"><button class="btn btn-primary" onclick="openModal('accounts')">+ New Account</button></div>
        </div>
        <div class="page-toolbar">
            <input type="text" id="accounts-search" placeholder="Search accounts…">
            <span class="result-count" id="accounts-count"></span>
        </div>
        <div class="table-container">
            <table id="accounts-table">
                <thead><tr>
                    <th data-sort="name">Name</th>
                    <th data-sort="billing">Billing</th>
                    <th data-sort="service_level">Service Level</th>
                    <th data-sort="sites">Sites</th>
                    <th data-sort="next_contact">Next Contact</th>
                    <th></th>
                </tr></thead>
                <tbody><tr><td colspan="6" class="loading-row">Loading…</td></tr></tbody>
            </table>
        </div>
    `;
    const accessors = {
        name: a => a.name,
        billing: a => a.billing_status,
        service_level: a => a.service_level_label,
        sites: a => a.total_sites,
        next_contact: a => a.next_contact_date,
    };
    const sortState = { key: null, dir: 1 };
    try {
        const accounts = await api('/accounts');
        window.__accountsCache = accounts;
        const refresh = () => {
            const q = document.getElementById('accounts-search').value.toLowerCase();
            const filtered = accounts.filter(a => (a.name || '').toLowerCase().includes(q));
            renderAccountsRows(applySort(filtered, accessors, sortState));
            attachSortableHeaders('accounts-table', accessors, sortState, refresh);
        };
        attachSortableHeaders('accounts-table', accessors, sortState, refresh);
        refresh();
        document.getElementById('accounts-search').addEventListener('input', debounce(refresh, 200));
    } catch {
        document.querySelector('#accounts-table tbody').innerHTML = '<tr><td colspan="6">Failed to load accounts.</td></tr>';
    }
}

function renderAccountsRows(accounts) {
    document.getElementById('accounts-count').textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;
    const tbody = document.querySelector('#accounts-table tbody');
    if (accounts.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No accounts match.</td></tr>'; return; }
    tbody.innerHTML = accounts.map(a => `
        <tr class="clickable" onclick="goTo('accounts/${a.id}')">
            <td>
                <span class="name-link">${esc(a.name)}</span>
                ${a.is_vip ? ' <span class="badge badge-vip">VIP</span>' : ''}
            </td>
            <td>${statusBadge(a.billing_status)}</td>
            <td>${esc(a.service_level_label || '—')}</td>
            <td>${a.total_sites ?? '—'}</td>
            <td>${fmtDate(a.next_contact_date)}</td>
            <td class="row-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="editEntity('accounts', ${a.id})">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteEntity('accounts', ${a.id})">Del</button>
            </td>
        </tr>
    `).join('');
}

async function renderAccountRecord(root, id) {
    try {
        const data = await api(`/accounts/${id}/full`);
        const a = data.account;
        let credentials = [];
        if (currentUser?.can_view_credentials) {
            try { credentials = await api(`/accounts/${id}/credentials`); } catch { /* not permitted / none */ }
        }
        const credsBySite = groupBy(credentials, 'site_id');

        root.innerHTML = `
            <div class="breadcrumb"><a onclick="goTo('accounts')" style="cursor:pointer">Accounts</a> / ${esc(a.name)}</div>
            <div class="record-header">
                <div class="record-header-top">
                    <div>
                        <div class="record-title">${esc(a.name)}
                            ${a.is_vip ? '<span class="badge badge-vip">VIP</span>' : ''}
                            ${statusBadge(a.billing_status)}
                        </div>
                        <div class="record-subtitle">${esc(a.service_level_label || 'No service level')}${a.membership_tier_label ? ' · ' + esc(a.membership_tier_label) : ''}</div>
                    </div>
                    <div class="record-actions">
                        ${a.external_link ? `<a class="btn btn-secondary btn-sm" href="${esc(a.external_link)}" target="_blank" rel="noopener">Open Link ↗</a>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="editEntity('accounts', ${a.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEntity('accounts', ${a.id}, true)">Delete</button>
                    </div>
                </div>
                <div class="record-facts">
                    <div><div class="fact-label">Next Contact</div><div class="fact-value">${fmtDate(a.next_contact_date)}</div></div>
                    <div><div class="fact-label">Sites</div><div class="fact-value">${data.sites.length}</div></div>
                    <div><div class="fact-label">People</div><div class="fact-value">${data.people.length}</div></div>
                    <div><div class="fact-label">Interactions</div><div class="fact-value">${data.interactions.length}</div></div>
                </div>
                ${a.notes ? `<div class="record-notes">${esc(a.notes)}</div>` : ''}
            </div>

            <div class="record-section">
                <div class="record-section-header">
                    <h2>People <span class="count">(${data.people.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openLinkPersonModal(${a.id})">+ Add Person</button>
                </div>
                ${data.people.length === 0 ? '<div class="empty-state">No people linked to this account yet.</div>' : `
                    <div class="people-grid">${data.people.map(p => personCard(p)).join('')}</div>
                `}
            </div>

            <div class="record-section">
                <div class="record-section-header">
                    <h2>Sites <span class="count">(${data.sites.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openAddSiteModal(${a.id})">+ Add Site</button>
                </div>
                ${data.sites.length === 0 ? '<div class="empty-state">No sites linked to this account yet.</div>' : data.sites.map((s, idx) => siteBlock(s, credsBySite[s.id] || [], idx === 0)).join('')}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>Vendors Involved <span class="count">(${data.vendors.length})</span></h2></div>
                ${data.vendors.length === 0 ? '<div class="empty-state">No vendor activity recorded yet.</div>' : `
                    <div>${data.vendors.map(v => `<span class="chip" style="cursor:pointer" onclick="goTo('vendors/${v.id}')">${esc(v.name)}</span>`).join('')}</div>
                `}
            </div>

            <div class="record-section">
                <div class="record-section-header">
                    <h2>Interaction Timeline <span class="count">(${data.interactions.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openInteractionModal(${a.id}, ${data.sites[0]?.id || 'null'})">+ Log Interaction</button>
                </div>
                ${renderTimeline(data.interactions)}
            </div>
        `;
        document.querySelectorAll('.site-block-header').forEach(h => h.addEventListener('click', () => h.closest('.site-block').classList.toggle('expanded')));
    } catch (err) {
        root.innerHTML = `<div class="empty-state">Account not found, or failed to load. <a onclick="goTo('accounts')" style="cursor:pointer">Back to accounts</a></div>`;
    }
}

function personCard(p) {
    const roles = [];
    if (p.is_primary_account_holder) roles.push('Primary Holder');
    if (p.is_billing_contact) roles.push('Billing');
    if (p.is_correspondent) roles.push('Correspondent');
    if (p.role_label) roles.push(p.role_label);
    return `
        <div class="person-card">
            <div class="pc-name"><a class="name-link" onclick="goTo('people/${p.person_id}')">${esc(fullName(p))}</a> ${p.is_vip ? '<span class="badge badge-vip">VIP</span>' : ''}</div>
            <div class="pc-meta">${esc(p.email || p.phone || '—')}</div>
            <div>${roles.map(r => `<span class="badge badge-neutral">${esc(r)}</span> `).join('')}</div>
        </div>
    `;
}

function vendorPersonCard(p) {
    const roles = [];
    if (p.role_label) roles.push(p.role_label);
    const accountLinks = (p.accounts || []).map(a => `<span class="badge badge-neutral" style="cursor:pointer" onclick="goTo('accounts/${a.account_id}')">${esc(a.account_name)}</span> `).join('');
    return `
        <div class="person-card">
            <div class="pc-name"><a class="name-link" onclick="goTo('people/${p.person_id}')">${esc(fullName(p))}</a></div>
            <div class="pc-meta">${esc(p.email || p.phone || '—')}</div>
            <div>${roles.map(r => `<span class="badge badge-neutral">${esc(r)}</span> `).join('')}${accountLinks}</div>
            ${p.link_notes ? `<div class="text-muted" style="margin-top:4px;font-size:13px">${esc(p.link_notes)}</div>` : ''}
        </div>
    `;
}

function siteBlock(s, credentials, expanded) {
    const sysCount = (s.systems || []).length;
    const compCount = (s.systems || []).reduce((n, sys) => n + (sys.components || []).length, 0);
    return `
        <div class="site-block ${expanded ? 'expanded' : ''}">
            <div class="site-block-header">
                <div>
                    <span class="site-block-toggle">▸</span>
                    <span class="sb-addr" style="cursor:pointer" onclick="event.stopPropagation(); goTo('sites/${s.id}')">${esc(s.address_line1)}${s.address_line2 ? ', ' + esc(s.address_line2) : ''}</span>
                    <div class="sb-sub">${[s.city, s.state, s.zip].filter(Boolean).map(esc).join(', ')} · ${esc(s.site_type || 'Type unknown')} · ${sysCount} system${sysCount === 1 ? '' : 's'}, ${compCount} device${compCount === 1 ? '' : 's'}</div>
                </div>
                <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); goTo('sites/${s.id}')">Open Site →</button>
            </div>
            <div class="site-block-body">
                ${renderSystemInfoGrid(s.system_info)}
                ${renderSystemsAccordion(s.systems, s.id)}
                ${credentials.length > 0 ? `<div class="form-section-label">Credentials</div>${credentials.map(credRow).join('')}` : ''}
            </div>
        </div>
    `;
}

// ============================================================================
// PEOPLE
// ============================================================================

async function renderPeopleList(root) {
    root.innerHTML = `
        <div class="page-header">
            <h1>People</h1>
            <div class="actions"><button class="btn btn-primary" onclick="openModal('people')">+ New Person</button></div>
        </div>
        <div class="page-toolbar">
            <input type="text" id="people-search" placeholder="Search by name, email, or phone…">
            <label class="checkbox-label"><input type="checkbox" id="people-hide-vendors"> Hide Vendor Contacts</label>
            <label class="checkbox-label"><input type="checkbox" id="people-hide-clients"> Hide Client Contacts</label>
            <span class="result-count" id="people-count"></span>
        </div>
        <div class="table-container">
            <table id="people-table">
                <thead><tr>
                    <th data-sort="name">Name</th>
                    <th data-sort="email">Email</th>
                    <th data-sort="phone">Phone</th>
                    <th data-sort="assoc">Accounts / Vendors</th>
                    <th data-sort="next_contact">Next Contact</th>
                    <th></th>
                </tr></thead>
                <tbody><tr><td colspan="6" class="loading-row">Loading…</td></tr></tbody>
            </table>
        </div>
    `;
    const accessors = {
        name: p => fullName(p),
        email: p => p.email,
        phone: p => p.phone,
        assoc: p => [...(p.accounts || []).map(a => a.account_name), ...(p.vendors || []).map(v => v.vendor_name)].sort().join(', '),
        next_contact: p => p.next_contact_date,
    };
    const sortState = { key: null, dir: 1 };
    try {
        const people = await api('/people');
        const refresh = () => {
            const q = document.getElementById('people-search').value.toLowerCase();
            const hideVendors = document.getElementById('people-hide-vendors').checked;
            const hideClients = document.getElementById('people-hide-clients').checked;
            const filtered = people.filter(p => {
                if (hideVendors && (p.vendors || []).length > 0) return false;
                if (hideClients && ((p.accounts || []).length > 0 || (p.sites || []).length > 0)) return false;
                return fullName(p).toLowerCase().includes(q) ||
                    (p.email || '').toLowerCase().includes(q) ||
                    (p.phone || '').includes(q);
            });
            renderPeopleRows(applySort(filtered, accessors, sortState));
            attachSortableHeaders('people-table', accessors, sortState, refresh);
        };
        attachSortableHeaders('people-table', accessors, sortState, refresh);
        refresh();
        document.getElementById('people-search').addEventListener('input', debounce(refresh, 200));
        document.getElementById('people-hide-vendors').addEventListener('change', refresh);
        document.getElementById('people-hide-clients').addEventListener('change', refresh);
    } catch {
        document.querySelector('#people-table tbody').innerHTML = '<tr><td colspan="6">Failed to load people.</td></tr>';
    }
}

function renderPeopleRows(people) {
    document.getElementById('people-count').textContent = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;
    const tbody = document.querySelector('#people-table tbody');
    if (people.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No people match.</td></tr>'; return; }
    tbody.innerHTML = people.map(p => `
        <tr class="clickable" onclick="goTo('people/${p.id}')">
            <td><span class="name-link">${esc(fullName(p)) || '—'}</span></td>
            <td>${esc(p.email || '—')}</td>
            <td>${esc(p.phone || '—')}</td>
            <td>${
                (p.accounts || []).map(a => `<span class="chip chip-account" style="cursor:pointer" onclick="event.stopPropagation(); goTo('accounts/${a.account_id}')">${esc(a.account_name)}</span>`).join('') +
                (p.vendors || []).map(v => `<span class="chip chip-vendor" style="cursor:pointer" onclick="event.stopPropagation(); goTo('vendors/${v.vendor_id}')">${esc(v.vendor_name)}</span>`).join('')
                || '<span class="text-muted">—</span>'
            }</td>
            <td>${fmtDate(p.next_contact_date)}</td>
            <td class="row-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="editEntity('people', ${p.id})">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteEntity('people', ${p.id})">Del</button>
            </td>
        </tr>
    `).join('');
}

async function renderPersonRecord(root, id) {
    try {
        const data = await api(`/people/${id}/full`);
        const p = data.person;
        root.innerHTML = `
            <div class="breadcrumb"><a onclick="goTo('people')" style="cursor:pointer">People</a> / ${esc(fullName(p))}</div>
            <div class="record-header">
                <div class="record-header-top">
                    <div>
                        <div class="record-title">${esc(fullName(p)) || 'Unnamed'}</div>
                        <div class="record-subtitle">${esc(p.email || '')}${p.email && p.phone ? ' · ' : ''}${esc(p.phone || '')}</div>
                    </div>
                    <div class="record-actions">
                        ${p.external_link ? `<a class="btn btn-secondary btn-sm" href="${esc(p.external_link)}" target="_blank" rel="noopener">Open Link ↗</a>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="editEntity('people', ${p.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEntity('people', ${p.id}, true)">Delete</button>
                    </div>
                </div>
                <div class="record-facts">
                    <div><div class="fact-label">Since</div><div class="fact-value">${p.client_since_year || '—'}</div></div>
                    <div><div class="fact-label">Next Contact</div><div class="fact-value">${fmtDate(p.next_contact_date)}</div></div>
                    <div><div class="fact-label">Personal Address</div><div class="fact-value">${esc(p.personal_address || '—')}</div></div>
                    <div><div class="fact-label">Accounts</div><div class="fact-value">${data.accounts.length}</div></div>
                    <div><div class="fact-label">Sites</div><div class="fact-value">${data.sites.length}</div></div>
                </div>
                ${p.notes ? `<div class="record-notes">${esc(p.notes)}</div>` : ''}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>Accounts <span class="count">(${data.accounts.length})</span></h2></div>
                ${data.accounts.length === 0 ? '<div class="empty-state">Not linked to any account.</div>' : `
                    <div class="people-grid">${data.accounts.map(a => `
                        <div class="person-card">
                            <div class="pc-name"><a class="name-link" onclick="goTo('accounts/${a.account_id}')">${esc(a.account_name)}</a> ${a.account_is_vip ? '<span class="badge badge-vip">VIP</span>' : ''}</div>
                            <div class="pc-meta">${statusBadge(a.billing_status)}</div>
                            <div>${[a.person_is_vip && 'VIP', a.is_primary_account_holder && 'Primary Holder', a.is_billing_contact && 'Billing', a.is_correspondent && 'Correspondent', a.role_label].filter(Boolean).map(r => `<span class="badge badge-neutral">${esc(r)}</span> `).join('')}</div>
                        </div>
                    `).join('')}</div>
                `}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>Sites <span class="count">(${data.sites.length})</span></h2></div>
                ${data.sites.length === 0 ? '<div class="empty-state">Not linked to any site.</div>' : `
                    <div class="people-grid">${data.sites.map(s => `
                        <div class="person-card">
                            <div class="pc-name"><a class="name-link" onclick="goTo('sites/${s.site_id}')">${esc(s.address_line1)}</a></div>
                            <div class="pc-meta">${[s.city, s.state].filter(Boolean).map(esc).join(', ')}</div>
                            <div>${s.role ? `<span class="badge badge-neutral">${esc(labelize(s.role))}</span>` : ''} ${s.is_primary_contact ? '<span class="badge badge-active">Primary Contact</span>' : ''}</div>
                        </div>
                    `).join('')}</div>
                `}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>Vendors <span class="count">(${data.vendors.length})</span></h2></div>
                ${data.vendors.length === 0 ? '<div class="empty-state">Not linked to any vendor.</div>' : `
                    <div class="people-grid">${data.vendors.map(v => `
                        <div class="person-card">
                            <div class="pc-name"><a class="name-link" onclick="goTo('vendors/${v.vendor_id}')">${esc(v.vendor_name)}</a></div>
                            <div>${v.role_label ? `<span class="badge badge-neutral">${esc(v.role_label)}</span>` : ''}</div>
                            ${v.link_notes ? `<div class="text-muted" style="margin-top:4px;font-size:13px">${esc(v.link_notes)}</div>` : ''}
                        </div>
                    `).join('')}</div>
                `}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>Interaction History <span class="count">(${data.interactions.length})</span></h2></div>
                ${renderTimeline(data.interactions)}
            </div>
        `;
    } catch {
        root.innerHTML = `<div class="empty-state">Person not found. <a onclick="goTo('people')" style="cursor:pointer">Back to people</a></div>`;
    }
}

// ============================================================================
// SITES
// ============================================================================

async function renderSitesList(root) {
    root.innerHTML = `
        <div class="page-header">
            <h1>Sites</h1>
            <div class="actions"><button class="btn btn-primary" onclick="openModal('sites')">+ New Site</button></div>
        </div>
        <div class="page-toolbar">
            <input type="text" id="sites-search" placeholder="Search by address or city…">
            <span class="result-count" id="sites-count"></span>
        </div>
        <div class="table-container">
            <table id="sites-table">
                <thead><tr>
                    <th data-sort="address">Address</th>
                    <th data-sort="type">Type</th>
                    <th data-sort="account">Account</th>
                    <th data-sort="contact">Primary Contact</th>
                    <th></th>
                </tr></thead>
                <tbody><tr><td colspan="5" class="loading-row">Loading…</td></tr></tbody>
            </table>
        </div>
    `;
    const accessors = {
        address: s => s.address_line1,
        type: s => s.site_type,
        account: s => s.account_name,
        contact: s => s.primary_contact_name,
    };
    const sortState = { key: null, dir: 1 };
    try {
        const sites = await api('/sites');
        const refresh = () => {
            const q = document.getElementById('sites-search').value.toLowerCase();
            const filtered = sites.filter(s => (s.address_line1 || '').toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q));
            renderSitesRows(applySort(filtered, accessors, sortState));
            attachSortableHeaders('sites-table', accessors, sortState, refresh);
        };
        attachSortableHeaders('sites-table', accessors, sortState, refresh);
        refresh();
        document.getElementById('sites-search').addEventListener('input', debounce(refresh, 200));
    } catch {
        document.querySelector('#sites-table tbody').innerHTML = '<tr><td colspan="5">Failed to load sites.</td></tr>';
    }
}

function renderSitesRows(sites) {
    document.getElementById('sites-count').textContent = `${sites.length} site${sites.length === 1 ? '' : 's'}`;
    const tbody = document.querySelector('#sites-table tbody');
    if (sites.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No sites match.</td></tr>'; return; }
    tbody.innerHTML = sites.map(s => `
        <tr class="clickable" onclick="goTo('sites/${s.id}')">
            <td>
                <span class="name-link">${esc(s.address_line1)}${s.address_line2 ? ', ' + esc(s.address_line2) : ''}</span>
                <div class="cell-sub">${[s.city, s.state, s.zip].filter(Boolean).map(esc).join(', ')}</div>
            </td>
            <td>${esc(s.site_type || '—')}</td>
            <td>${s.account_name ? `<a class="name-link" onclick="event.stopPropagation(); goTo('accounts/${s.account_id}')">${esc(s.account_name)}</a>` : '<span class="text-muted">—</span>'}</td>
            <td>${s.primary_contact_name ? esc(s.primary_contact_name) : '<span class="text-muted">—</span>'}</td>
            <td class="row-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="editEntity('sites', ${s.id})">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteEntity('sites', ${s.id})">Del</button>
            </td>
        </tr>
    `).join('');
}

async function renderSiteRecord(root, id) {
    try {
        const data = await api(`/sites/${id}/full`);
        const s = data.site;
        let credentials = [];
        if (currentUser?.can_view_credentials) {
            try { credentials = await api(`/sites/${id}/credentials`); } catch { /* not permitted */ }
        }
        root.innerHTML = `
            <div class="breadcrumb"><a onclick="goTo('sites')" style="cursor:pointer">Sites</a> / ${esc(s.address_line1)}</div>
            <div class="record-header">
                <div class="record-header-top">
                    <div>
                        <div class="record-title">${esc(s.address_line1)}${s.address_line2 ? ', ' + esc(s.address_line2) : ''}</div>
                        <div class="record-subtitle">${[s.city, s.state, s.zip].filter(Boolean).map(esc).join(', ')} · ${esc(s.site_type || 'Type unknown')}</div>
                        <div class="record-badges">${data.accounts.map(a => `<span class="badge badge-neutral" style="cursor:pointer" onclick="goTo('accounts/${a.id}')">${esc(a.name)}</span>`).join('')}</div>
                    </div>
                    <div class="record-actions">
                        ${s.external_link ? `<a class="btn btn-secondary btn-sm" href="${esc(s.external_link)}" target="_blank" rel="noopener">Open Link ↗</a>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="editEntity('sites', ${s.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEntity('sites', ${s.id}, true)">Delete</button>
                    </div>
                </div>
                <div class="record-facts">
                    <div><div class="fact-label">Next Contact</div><div class="fact-value">${fmtDate(s.next_contact_date)}</div></div>
                    <div><div class="fact-label">Former Homeowner</div><div class="fact-value">${esc(s.former_homeowner_name || '—')}</div></div>
                    <div><div class="fact-label">Systems</div><div class="fact-value">${data.systems.length}</div></div>
                    <div><div class="fact-label">People On-site</div><div class="fact-value">${data.people.length}</div></div>
                </div>
                ${s.notes ? `<div class="record-notes">${esc(s.notes)}</div>` : ''}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>System Info</h2></div>
                ${renderSystemInfoGrid(s.system_info)}
            </div>

            <div class="record-section">
                <div class="record-section-header">
                    <h2>Installed Systems <span class="count">(${data.systems.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openModal('systems', null, ${s.id})">+ Add System</button>
                </div>
                ${renderSystemsAccordion(data.systems, s.id)}
            </div>

            <div class="record-section">
                <div class="record-section-header">
                    <h2>People On-site <span class="count">(${data.people.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openLinkPersonToSiteModal(${s.id})">+ Add Person</button>
                </div>
                ${data.people.length === 0 ? '<div class="empty-state">No people linked to this site.</div>' : `
                    <div class="people-grid">${data.people.map(p => `
                        <div class="person-card">
                            <div class="pc-name"><a class="name-link" onclick="goTo('people/${p.person_id}')">${esc(fullName(p))}</a></div>
                            <div class="pc-meta">${esc(p.email || p.phone || '—')}</div>
                            <div>${p.role ? `<span class="badge badge-neutral">${esc(labelize(p.role))}</span>` : ''} ${p.is_primary_contact ? '<span class="badge badge-active">Primary</span>' : ''}</div>
                        </div>
                    `).join('')}</div>
                `}
            </div>

            <div class="record-section">
                <div class="record-section-header"><h2>Credentials <span class="count">(${credentials.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openModal('credentials', null, ${s.id})">+ Add Credential</button>
                </div>
                ${currentUser?.can_view_credentials
                    ? (credentials.length === 0 ? '<div class="empty-state">No credentials on file for this site.</div>' : credentials.map(credRow).join(''))
                    : '<div class="empty-state">You do not have permission to view credentials.</div>'}
            </div>

            <div class="record-section">
                <div class="record-section-header">
                    <h2>Interactions <span class="count">(${data.interactions.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openModal('interactions', null, ${s.id})">+ Log Interaction</button>
                </div>
                ${renderTimeline(data.interactions)}
            </div>
        `;
    } catch {
        root.innerHTML = `<div class="empty-state">Site not found. <a onclick="goTo('sites')" style="cursor:pointer">Back to sites</a></div>`;
    }
}

// ============================================================================
// VENDORS
// ============================================================================

async function renderVendorsList(root) {
    root.innerHTML = `
        <div class="page-header">
            <h1>Vendors</h1>
            <div class="actions"><button class="btn btn-primary" onclick="openModal('vendors')">+ New Vendor</button></div>
        </div>
        <div class="table-container">
            <table id="vendors-table">
                <thead><tr>
                    <th data-sort="name">Name</th>
                    <th data-sort="specialty">Specialty</th>
                    <th data-sort="email">Email</th>
                    <th data-sort="phone">Phone</th>
                    <th></th>
                </tr></thead>
                <tbody><tr><td colspan="5" class="loading-row">Loading…</td></tr></tbody>
            </table>
        </div>
    `;
    const accessors = {
        name: v => v.name,
        specialty: v => v.specialty,
        email: v => v.contact_email,
        phone: v => v.contact_phone,
    };
    const sortState = { key: null, dir: 1 };
    try {
        const vendors = await api('/vendors');
        const refresh = () => {
            renderVendorsRows(applySort(vendors, accessors, sortState));
            attachSortableHeaders('vendors-table', accessors, sortState, refresh);
        };
        attachSortableHeaders('vendors-table', accessors, sortState, refresh);
        refresh();
    } catch {
        document.querySelector('#vendors-table tbody').innerHTML = '<tr><td colspan="5">Failed to load vendors.</td></tr>';
    }
}

function renderVendorsRows(vendors) {
    document.querySelector('#vendors-table tbody').innerHTML = vendors.length === 0 ? '<tr><td colspan="5" class="text-muted">No vendors yet.</td></tr>' : vendors.map(v => `
        <tr class="clickable" onclick="goTo('vendors/${v.id}')">
            <td><span class="name-link">${esc(v.name)}</span></td>
            <td>${esc(truncate(v.specialty, 80) || '—')}</td>
            <td>${esc(v.contact_email || '—')}</td>
            <td>${esc(v.contact_phone || '—')}</td>
            <td class="row-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="editEntity('vendors', ${v.id})">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteEntity('vendors', ${v.id})">Del</button>
            </td>
        </tr>
    `).join('');
}

async function renderVendorRecord(root, id) {
    try {
        const data = await api(`/vendors/${id}/full`);
        const v = data.vendor;
        root.innerHTML = `
            <div class="breadcrumb"><a onclick="goTo('vendors')" style="cursor:pointer">Vendors</a> / ${esc(v.name)}</div>
            <div class="record-header">
                <div class="record-header-top">
                    <div>
                        <div class="record-title">${esc(v.name)}</div>
                        <div class="record-subtitle">${esc(v.specialty || 'No specialty on file')}</div>
                    </div>
                    <div class="record-actions">
                        ${v.external_link ? `<a class="btn btn-secondary btn-sm" href="${esc(v.external_link)}" target="_blank" rel="noopener">Open Link ↗</a>` : ''}
                        <button class="btn btn-secondary btn-sm" onclick="editEntity('vendors', ${v.id})">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteEntity('vendors', ${v.id}, true)">Delete</button>
                    </div>
                </div>
                <div class="record-facts">
                    <div><div class="fact-label">Email</div><div class="fact-value">${esc(v.contact_email || '—')}</div></div>
                    <div><div class="fact-label">Phone</div><div class="fact-value">${esc(v.contact_phone || '—')}</div></div>
                    <div><div class="fact-label">Address</div><div class="fact-value">${esc(v.address || '—')}</div></div>
                    <div><div class="fact-label">Interactions</div><div class="fact-value">${data.interactions.length}</div></div>
                </div>
                ${v.notes ? `<div class="record-notes">${esc(v.notes)}</div>` : ''}
            </div>
            <div class="record-section">
                <div class="record-section-header">
                    <h2>Contacts <span class="count">(${data.people.length})</span></h2>
                    <button class="btn btn-ghost btn-sm" onclick="openLinkPersonToVendorModal(${v.id})">+ Add Person</button>
                </div>
                ${data.people.length === 0 ? '<div class="empty-state">No contacts on file.</div>' : `
                    <div class="people-grid">${data.people.map(p => vendorPersonCard(p)).join('')}</div>
                `}
            </div>
            <div class="record-section">
                <div class="record-section-header"><h2>Interaction History <span class="count">(${data.interactions.length})</span></h2></div>
                ${renderTimeline(data.interactions)}
            </div>
        `;
    } catch {
        root.innerHTML = `<div class="empty-state">Vendor not found. <a onclick="goTo('vendors')" style="cursor:pointer">Back to vendors</a></div>`;
    }
}

// ============================================================================
// SHARED RECORD-PAGE RENDERERS
// ============================================================================

const SYSINFO_CATEGORIES = [
    ['access_control', 'Access Control'], ['control_system', 'Control System'],
    ['security_alarm', 'Security Alarm'], ['video_surveillance', 'Video Surveillance'],
    ['av_system', 'AV System'], ['lighting', 'Lighting'], ['shades', 'Shades'],
    ['climate', 'Climate'], ['network', 'Network'], ['phone_system', 'Phone System'],
    ['remote_access', 'Remote Access']
];

function renderSystemInfoGrid(systemInfo) {
    if (!systemInfo || Object.keys(systemInfo).length === 0) return '<div class="empty-state">No system info on file.</div>';
    const tiles = SYSINFO_CATEGORIES.map(([key, label]) => {
        const cat = systemInfo[key];
        const present = cat && cat.status && cat.status !== 'unknown';
        const brand = cat ? (cat.brand || cat.platform || cat.type) : null;
        return `
            <div class="sysinfo-tile ${present ? '' : 'si-absent'}">
                <div class="si-label">${label}</div>
                <div class="si-brand">${present ? esc(brand || labelize(cat.status)) : '—'}</div>
            </div>
        `;
    }).join('');
    const notes = systemInfo.general_notes ? `<div class="record-notes" style="margin-top:0">${esc(systemInfo.general_notes)}</div>` : '';
    return `<div class="sysinfo-grid">${tiles}</div>${notes}`;
}

function renderSystemsAccordion(systems, siteId) {
    if (!systems || systems.length === 0) return '<div class="empty-state">No systems recorded for this site.</div>';
    return systems.map(sys => `
        <div class="system-block">
            <div class="system-block-header">
                <div class="system-block-title">${esc(sys.name)} <span class="text-muted">— ${esc(labelize(sys.category))}${sys.brand ? ' · ' + esc(sys.brand) : ''}</span></div>
                <div>
                    ${statusBadge(sys.status)}
                    <button class="btn btn-ghost btn-sm" onclick="editEntity('systems', ${sys.id})">Edit</button>
                    <button class="btn btn-ghost btn-sm" onclick="deleteEntity('systems', ${sys.id})">Del</button>
                    <button class="btn btn-ghost btn-sm" onclick="openModal('components', null, ${sys.id})">+ Component</button>
                </div>
            </div>
            ${(sys.components || []).map(c => `
                <div class="component-row">
                    <div><span class="comp-name">${esc(c.name)}</span> ${c.model ? '<span class="comp-meta">— ' + esc(c.model) + '</span>' : (c.brand ? '<span class="comp-meta">— ' + esc(c.brand) + '</span>' : '')} ${c.serial_number ? '<span class="comp-meta">(SN ' + esc(c.serial_number) + ')</span>' : ''}</div>
                    <div>
                        ${statusBadge(c.status)}
                        <button class="btn btn-ghost btn-sm" onclick="editEntity('components', ${c.id})">Edit</button>
                        <button class="btn btn-ghost btn-sm" onclick="deleteEntity('components', ${c.id})">Del</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function renderTimeline(interactions) {
    if (!interactions || interactions.length === 0) return '<div class="empty-state">No interactions logged yet.</div>';
    return `<div class="timeline">${interactions.map(i => `
        <div class="timeline-item ${i.is_service ? 'is-service' : ''}">
            <div class="timeline-date">${fmtDate(i.interaction_date)}${i.is_service ? ' · <span class="badge badge-service">Service</span>' : ''}${i.warranty_claim ? ' · <span class="badge badge-fault">Warranty</span>' : ''}
                <button class="btn btn-ghost btn-sm" onclick="editEntity('interactions', ${i.id})">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteEntity('interactions', ${i.id})">Del</button>
            </div>
            <div class="timeline-title">${esc(labelize(i.interaction_type))}${i.site_address ? ' — <a class="name-link" onclick="goTo(\'sites/' + i.site_id + '\')" style="font-weight:600">' + esc(i.site_address) + '</a>' : ''}</div>
            ${i.description ? `<div class="timeline-desc">${esc(i.description)}</div>` : ''}
            <div class="timeline-meta">
                ${i.person_name ? `<span>Contact: ${esc(i.person_name)}</span>` : ''}
                ${i.vendor_name ? `<span>Vendor: ${esc(i.vendor_name)}</span>` : ''}
                ${i.account_name ? `<span>Account: ${esc(i.account_name)}</span>` : ''}
                ${i.cost ? `<span>${fmtMoney(i.cost)}</span>` : ''}
            </div>
        </div>
    `).join('')}</div>`;
}

window.__credCache = {};

function credRow(c) {
    window.__credCache[c.id] = c;
    return `
        <div class="cred-row">
            <div>
                <div class="cred-label">${esc(c.label || 'Untitled')}</div>
                <div class="cred-sub">${c.system_id ? 'System ' + c.system_id : (c.notes ? esc(truncate(c.notes, 60)) : '')}</div>
            </div>
            <div class="cred-fields">
                <div class="cred-field"><span class="cf-label">Username</span>${esc(c.username || '—')}</div>
                <div class="cred-field"><span class="cf-label">Password</span><span class="cred-masked" data-cred-id="${c.id}" onclick="toggleCredReveal(this)">••••••••</span></div>
                <button class="btn btn-ghost btn-sm" onclick="editEntity('credentials', ${c.id})">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="deleteEntity('credentials', ${c.id})">Del</button>
            </div>
        </div>
    `;
}

function toggleCredReveal(el) {
    const cred = window.__credCache[el.dataset.credId];
    if (!cred) return;
    const isMasked = el.classList.contains('cred-masked');
    el.textContent = isMasked ? (cred.password || '') : '••••••••';
    el.classList.toggle('cred-masked');
}

// ============================================================================
// HELPERS
// ============================================================================

function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fullName(p) { return `${p.first_name || ''} ${p.last_name || ''}`.trim(); }

function labelize(s) {
    if (!s) return '—';
    return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

function statusBadge(status) {
    if (!status) return '<span class="badge badge-unknown">—</span>';
    return `<span class="badge badge-${slug(status)}">${esc(labelize(status))}</span>`;
}

function fmtDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date)) return esc(d);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtMoney(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
}

function groupBy(rows, key) {
    const out = {};
    for (const r of rows || []) { (out[r[key]] ||= []).push(r); }
    return out;
}

function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// Generic click-to-sort for list-page tables. `accessors` maps a th's
// data-sort key to a fn(row) => comparable value. `sortState` is a
// {key, dir} object owned by the caller so it persists across re-renders
// (search/filter) without losing the active sort.
function sortRows(rows, accessor, dir) {
    return rows.slice().sort((a, b) => {
        let av = accessor(a), bv = accessor(b);
        const aNil = av === null || av === undefined || av === '';
        const bNil = bv === null || bv === undefined || bv === '';
        if (aNil && bNil) return 0;
        if (aNil) return 1;
        if (bNil) return -1;
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av < bv) return -dir;
        if (av > bv) return dir;
        return 0;
    });
}

function attachSortableHeaders(tableId, accessors, sortState, onChange) {
    const thead = document.querySelector(`#${tableId} thead`);
    if (!thead) return;
    thead.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.add('sortable');
        th.classList.toggle('sort-asc', sortState.key === th.dataset.sort && sortState.dir === 1);
        th.classList.toggle('sort-desc', sortState.key === th.dataset.sort && sortState.dir === -1);
        th.onclick = () => {
            if (sortState.key === th.dataset.sort) sortState.dir *= -1;
            else { sortState.key = th.dataset.sort; sortState.dir = 1; }
            onChange();
        };
    });
}

function applySort(rows, accessors, sortState) {
    if (!sortState.key || !accessors[sortState.key]) return rows;
    return sortRows(rows, accessors[sortState.key], sortState.dir);
}

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================================
// MODAL SYSTEM (create / edit for each entity type + relationship linking)
// ============================================================================

const FIELD_DEFS = {
    people: [
        { row: [['first_name', 'First Name'], ['last_name', 'Last Name']] },
        ['email', 'Email'], ['phone', 'Phone'], ['personal_address', 'Personal Address'],
        ['external_link', 'External Link'],
        { row: [['next_contact_date', 'Next Contact Date', 'date'], ['client_since_year', 'Since (Year)', 'number']] },
        ['notes', 'Notes', 'textarea']
    ],
    accounts: [
        ['name', 'Name'],
        { row: [
            ['billing_status', 'Billing Status', 'select', ['active', 'past due', 'on hold']],
            ['service_level', 'Service Level', 'select', [['0', 'None'], ['1', 'Bronze'], ['2', 'Silver'], ['3', 'Gold'], ['4', 'Platinum']]]
        ] },
        ['membership_tier_label', 'Membership Tier (client-facing name)'],
        ['is_vip', 'VIP', 'checkbox'],
        ['external_link', 'External Link'], ['next_contact_date', 'Next Contact Date', 'date'],
        ['notes', 'Notes', 'textarea']
    ],
    sites: [
        ['address_line1', 'Address Line 1'], ['address_line2', 'Address Line 2'],
        { row3: [['city', 'City'], ['state', 'State'], ['zip', 'ZIP']] },
        ['site_type', 'Site Type', 'select', ['Residential', 'Commercial', 'Residential Tenant', 'Commercial Tenant', 'Mixed', 'Other']],
        ['external_link', 'External Link'], ['next_contact_date', 'Next Contact Date', 'date'],
        ['notes', 'Notes', 'textarea']
    ],
    vendors: [
        ['name', 'Name'], ['specialty', 'Specialty', 'textarea'],
        { row: [['contact_email', 'Email'], ['contact_phone', 'Phone']] },
        ['address', 'Address'],
        ['external_link', 'External Link'], ['notes', 'Notes', 'textarea']
    ],
    systems: [
        ['name', 'Name'],
        { row: [
            ['category', 'Category', 'select', ['access_control', 'control_system', 'security_alarm', 'video_surveillance', 'av_system', 'lighting', 'shades', 'climate', 'network', 'phone_system', 'remote_access']],
            ['status', 'Status', 'select', ['active', 'offline', 'maintenance', 'decommissioned']]
        ] },
        { row: [['brand', 'Brand'], ['model', 'Model']] },
        { row: [['install_date', 'Install Date', 'date'], ['warranty_expires', 'Warranty Expires', 'date']] },
        ['integrated_with_control_system', 'Integrated w/ Control System', 'checkbox'],
        ['notes', 'Notes', 'textarea']
    ],
    components: [
        ['name', 'Name'],
        { row: [['type', 'Type'], ['status', 'Status', 'select', ['online', 'offline', 'fault']]] },
        { row3: [['brand', 'Brand'], ['model', 'Model'], ['serial_number', 'Serial #']] },
        { row3: [['quantity', 'Quantity', 'number'], ['firmware_version', 'Firmware'], ['cable_category', 'Cable Category']] },
        { row: [['ip_address', 'IP Address'], ['mac_address', 'MAC Address']] },
        { row3: [['location', 'Location'], ['provided_by', 'Provided By'], ['install_date_approx', 'Install Date (approx)']] },
        { row3: [['po_number', 'PO #'], ['proposal_ref', 'Proposal Ref'], ['service_call_ref', 'Service Call Ref']] },
        ['notes', 'Notes', 'textarea']
    ],
    interactions: [
        { row3: [
            ['interaction_type', 'Type', 'select', ['phone_call', 'email', 'on_site_visit', 'remote_session', 'sales', 'scheduled_checkup', 'change_order', 'other']],
            ['is_service', 'Is Service?', 'select', [['false', 'No'], ['true', 'Yes']]],
            ['interaction_date', 'Date', 'date']
        ] },
        { row: [['person_id', 'Person ID'], ['vendor_id', 'Vendor ID']] },
        { row: [['cost', 'Cost', 'number'], ['invoice_number', 'Invoice #']] },
        ['warranty_claim', 'Warranty Claim', 'checkbox'],
        ['description', 'Description', 'textarea'], ['notes', 'Notes', 'textarea']
    ],
    credentials: [
        ['label', 'Label', 'text', null, 'e.g. Netflix, Crestron Admin'],
        { row: [['username', 'Username'], ['password', 'Password']] },
        ['notes', 'Notes', 'textarea']
    ]
};

const TITLES = { people: 'Person', accounts: 'Account', sites: 'Site', vendors: 'Vendor', systems: 'System', components: 'Component', interactions: 'Interaction', credentials: 'Credential' };

function fieldHtml([key, label, type, options, placeholder], data) {
    const id = `m-${key}`;
    const val = data ? data[key] : '';
    if (type === 'textarea') return `<div class="form-group"><label>${label}</label><textarea id="${id}">${esc(val)}</textarea></div>`;
    if (type === 'checkbox') return `<div class="form-group"><label>${label}</label><input type="checkbox" id="${id}" ${val ? 'checked' : ''}></div>`;
    if (type === 'select') {
        const opts = options.map(o => Array.isArray(o) ? o : [o, o]);
        return `<div class="form-group"><label>${label}</label><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
    }
    if (type === 'date') return `<div class="form-group"><label>${label}</label><input type="date" id="${id}" value="${val ? String(val).slice(0, 10) : ''}"></div>`;
    if (type === 'number') return `<div class="form-group"><label>${label}</label><input type="number" step="0.01" id="${id}" value="${val ?? ''}"></div>`;
    return `<div class="form-group"><label>${label}</label><input type="text" id="${id}" value="${esc(val ?? '')}" ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}></div>`;
}

function renderFields(defs, data) {
    return defs.map(f => {
        if (f.row) return `<div class="form-row">${f.row.map(sub => fieldHtml(sub, data)).join('')}</div>`;
        if (f.row3) return `<div class="form-row-3">${f.row3.map(sub => fieldHtml(sub, data)).join('')}</div>`;
        return fieldHtml(f, data);
    }).join('');
}

let modalContext = {}; // holds parent ids for context-scoped creation (site_id, system_id, account link, etc.)

function openModal(type, data = null, contextId = null) {
    const modal = document.getElementById('modal');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const isEdit = !!data;
    title.textContent = (isEdit ? 'Edit ' : 'Add ') + TITLES[type];

    modalContext = { type, id: data?.id || null, contextId, data };
    body.innerHTML = renderFields(FIELD_DEFS[type], data);

    if (type === 'systems') body.innerHTML = `<div class="form-hint">Site: #${contextId ?? data?.site_id}</div>` + body.innerHTML;
    if (type === 'components') body.innerHTML = `<div class="form-hint">System: #${contextId ?? data?.system_id}</div>` + body.innerHTML;
    if (type === 'interactions') body.innerHTML = `<div class="form-hint">Site: #${contextId ?? data?.site_id}</div>` + body.innerHTML;
    if (type === 'credentials') body.innerHTML = `<div class="form-hint">Site: #${contextId ?? data?.site_id}</div>` + body.innerHTML;

    modal.classList.add('active');
}

async function editEntity(type, id) {
    try {
        let data, contextId = null;
        if (type === 'people') data = await api(`/people/${id}/full`).then(r => r.person);
        else if (type === 'accounts') data = (await api('/accounts')).find(x => x.id === id);
        else if (type === 'sites') data = (await api('/sites')).find(x => x.id === id);
        else if (type === 'vendors') data = (await api('/vendors')).find(x => x.id === id);
        else if (type === 'credentials') { data = (await api('/credentials')).find(x => x.id === id); contextId = data?.site_id; }
        else if (type === 'systems') { data = (await api('/systems')).find(x => x.id === id); contextId = data?.site_id; }
        else if (type === 'components') { data = (await api('/components')).find(x => x.id === id); contextId = data?.system_id; }
        else if (type === 'interactions') { data = (await api('/interactions')).find(x => x.id === id); contextId = data?.site_id; }
        if (!data) return showToast('Not found');
        openModal(type, data, contextId);
    } catch { showToast('Failed to load record'); }
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

function collectFormData(type) {
    const g = (id) => document.getElementById(id)?.value;
    const cb = (id) => document.getElementById(id)?.checked;
    switch (type) {
        case 'people':
            return { first_name: g('m-first_name'), last_name: g('m-last_name'), email: g('m-email'), phone: g('m-phone'), personal_address: g('m-personal_address'), external_link: g('m-external_link'), next_contact_date: g('m-next_contact_date') || null, client_since_year: parseInt(g('m-client_since_year')) || null, notes: g('m-notes') };
        case 'accounts':
            return { name: g('m-name'), billing_status: g('m-billing_status'), service_level: parseInt(g('m-service_level')), membership_tier_label: g('m-membership_tier_label'), is_vip: cb('m-is_vip'), external_link: g('m-external_link'), next_contact_date: g('m-next_contact_date') || null, notes: g('m-notes') };
        case 'sites':
            return { address_line1: g('m-address_line1'), address_line2: g('m-address_line2'), city: g('m-city'), state: g('m-state'), zip: g('m-zip'), site_type: g('m-site_type'), former_homeowner_id: modalContext.data?.former_homeowner_id ?? null, external_link: g('m-external_link'), next_contact_date: g('m-next_contact_date') || null, notes: g('m-notes') };
        case 'vendors':
            return { name: g('m-name'), specialty: g('m-specialty'), contact_email: g('m-contact_email'), contact_phone: g('m-contact_phone'), address: g('m-address'), external_link: g('m-external_link'), notes: g('m-notes') };
        case 'systems':
            return { name: g('m-name'), category: g('m-category'), status: g('m-status'), brand: g('m-brand'), model: g('m-model'), install_date: g('m-install_date') || null, warranty_expires: g('m-warranty_expires') || null, integrated_with_control_system: cb('m-integrated_with_control_system'), notes: g('m-notes') };
        case 'components':
            return { name: g('m-name'), type: g('m-type'), status: g('m-status'), brand: g('m-brand'), model: g('m-model'), serial_number: g('m-serial_number'), quantity: parseInt(g('m-quantity')) || 1, firmware_version: g('m-firmware_version'), cable_category: g('m-cable_category'), ip_address: g('m-ip_address'), mac_address: g('m-mac_address'), location: g('m-location'), provided_by: g('m-provided_by'), install_date_approx: g('m-install_date_approx'), po_number: g('m-po_number'), proposal_ref: g('m-proposal_ref'), service_call_ref: g('m-service_call_ref'), notes: g('m-notes') };
        case 'interactions':
            return { interaction_type: g('m-interaction_type'), is_service: g('m-is_service') === 'true', interaction_date: g('m-interaction_date') || null, person_id: parseInt(g('m-person_id')) || null, vendor_id: parseInt(g('m-vendor_id')) || null, cost: parseFloat(g('m-cost')) || null, invoice_number: g('m-invoice_number'), warranty_claim: cb('m-warranty_claim'), description: g('m-description'), notes: g('m-notes'), system_id: modalContext.data?.system_id ?? null, component_id: modalContext.data?.component_id ?? null, account_id: modalContext.data?.account_id ?? null };
        case 'credentials':
            return { label: g('m-label'), username: g('m-username'), password: g('m-password'), notes: g('m-notes'), site_id: modalContext.id ? (modalContext.data?.site_id ?? null) : modalContext.contextId, system_id: modalContext.data?.system_id ?? null };
    }
}

async function saveModal() {
    const { type, id, contextId } = modalContext;
    const data = collectFormData(type);

    try {
        let result;
        if (id) {
            result = await api(`/${type}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else if (type === 'systems') {
            result = await api(`/sites/${contextId}/systems`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else if (type === 'components') {
            result = await api(`/systems/${contextId}/components`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else if (type === 'interactions') {
            result = await api(`/sites/${contextId}/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        } else if (type === 'credentials') {
            result = await api('/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, site_id: contextId }) });
        } else {
            result = await api(`/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        }
        closeModal();
        showToast(`${TITLES[type]} saved`);
        router();
    } catch (err) {
        showToast(err.message || 'Save failed');
    }
}

async function deleteEntity(type, id, goBackAfter = false) {
    if (!confirm(`Delete this ${TITLES[type].toLowerCase()}? This cannot be undone.`)) return;
    try {
        await api(`/${type}/${id}`, { method: 'DELETE' });
        showToast(`${TITLES[type]} deleted`);
        if (goBackAfter) goTo(type);
        else router();
    } catch (err) {
        showToast(err.message || 'Delete failed');
    }
}

// ============================================================================
// RELATIONSHIP LINKING MODALS
// ============================================================================

function openAddSiteModal(accountId) {
    openModal('sites');
    // Wrap the save button: after the site is created, link it to this account.
    document.getElementById('modal-save').onclick = async () => {
        const data = collectFormData('sites');
        try {
            const site = await api('/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            await api('/relationships/site-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: site.id, account_id: accountId }) });
            closeModal();
            showToast('Site added and linked');
            router();
        } catch (err) {
            showToast(err.message || 'Failed to add site');
        } finally {
            document.getElementById('modal-save').onclick = saveModal;
        }
    };
}

function openLinkPersonModal(accountId) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = 'Add Person to Account';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-section-label">Person</div>
        ${renderFields(FIELD_DEFS.people, null)}
        <div class="form-section-label">Role on This Account</div>
        <div class="form-row">
            <div class="form-group"><label>Primary Holder</label><input type="checkbox" id="m-is_primary_account_holder"></div>
            <div class="form-group"><label>Billing Contact</label><input type="checkbox" id="m-is_billing_contact"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Correspondent</label><input type="checkbox" id="m-is_correspondent"></div>
            <div class="form-group"><label>VIP</label><input type="checkbox" id="m-is_vip"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Role Label</label><input type="text" id="m-role_label" placeholder="e.g. Estate Manager"></div>
        </div>
        <div class="form-hint">Creates a new person and links them to this account. To link an existing person, add them from the People page instead, then set their role here later via the API.</div>
    `;
    document.getElementById('modal-save').onclick = async () => {
        try {
            const person = await api('/people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectFormData('people')) });
            await api('/relationships/person-account', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    person_id: person.id, account_id: accountId,
                    is_primary_account_holder: document.getElementById('m-is_primary_account_holder').checked,
                    is_billing_contact: document.getElementById('m-is_billing_contact').checked,
                    is_correspondent: document.getElementById('m-is_correspondent').checked,
                    is_vip: document.getElementById('m-is_vip').checked,
                    role_label: document.getElementById('m-role_label').value
                })
            });
            closeModal();
            showToast('Person added and linked');
            router();
        } catch (err) {
            showToast(err.message || 'Failed to add person');
        } finally {
            document.getElementById('modal-save').onclick = saveModal;
        }
    };
    modal.classList.add('active');
}

function openLinkPersonToSiteModal(siteId) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = 'Add Person to Site';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-section-label">Person</div>
        ${renderFields(FIELD_DEFS.people, null)}
        <div class="form-section-label">Role at This Site</div>
        <div class="form-row">
            <div class="form-group"><label>Role</label>
                <select id="m-role">
                    ${['homeowner', 'property_manager', 'tenant', 'family_member', 'household_staff', 'general_contractor', 'vendor_contact', 'other'].map(r => `<option value="${r}">${labelize(r)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Primary Contact</label><input type="checkbox" id="m-is_primary_contact"></div>
        </div>
    `;
    document.getElementById('modal-save').onclick = async () => {
        try {
            const person = await api('/people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectFormData('people')) });
            await api('/relationships/person-site', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ person_id: person.id, site_id: siteId, role: document.getElementById('m-role').value, is_primary_contact: document.getElementById('m-is_primary_contact').checked })
            });
            closeModal();
            showToast('Person added and linked');
            router();
        } catch (err) {
            showToast(err.message || 'Failed to add person');
        } finally {
            document.getElementById('modal-save').onclick = saveModal;
        }
    };
    modal.classList.add('active');
}

function openLinkPersonToVendorModal(vendorId) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = 'Add Person to Vendor';
    document.getElementById('modal-body').innerHTML = `
        <div class="form-section-label">Person</div>
        ${renderFields(FIELD_DEFS.people, null)}
        <div class="form-section-label">Role at This Vendor</div>
        <div class="form-row">
            <div class="form-group"><label>Role Label</label><input type="text" id="m-role_label" placeholder="e.g. Sales Rep"></div>
        </div>
        <div class="form-hint">Creates a new person and links them to this vendor. If this person already has a Coffee Corner record (e.g. they're also a client contact on an account), add them from the People page instead, then set their vendor role here later via the API.</div>
    `;
    document.getElementById('modal-save').onclick = async () => {
        try {
            const person = await api('/people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectFormData('people')) });
            await api('/relationships/person-vendor', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ person_id: person.id, vendor_id: vendorId, role_label: document.getElementById('m-role_label').value })
            });
            closeModal();
            showToast('Person added and linked');
            router();
        } catch (err) {
            showToast(err.message || 'Failed to add person');
        } finally {
            document.getElementById('modal-save').onclick = saveModal;
        }
    };
    modal.classList.add('active');
}

function openInteractionModal(accountId, defaultSiteId) {
    openModal('interactions', null, defaultSiteId);
}

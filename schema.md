# Coffee Corner Schema Reference

**Canonical schema doc — owned by the Coffee Corner session.** Every other session (Sweep, Research, and any general session) reads this file to know what to write and where. Only the Coffee Corner session edits it, and only when it changes the actual Postgres schema (a new migration under `database/`) — treat any mismatch you notice from another session as a signal to flag to Will, not to fix here yourself.

**Connection:** `psql -h localhost -U s-groupservice -d home_integration` (DB name not yet renamed to `coffee corner` — see STATUS.md). API server (if running): `http://localhost:3000/api`, `frontend/server.js`.

**Writing data:** direct SQL for a single quick fact; `frontend/enter_account.py` (JSON manifest → API) for a fuller structured pass covering many related facts at once — see its module docstring for the manifest schema, which mirrors this file. Always check identity before inserting a new row (name/email/address match) — every table below that represents a real-world entity should be deduped against, never blindly re-inserted.

## Core entities

**accounts** — id, name, billing_status (`active`/`past due`/`on hold`), service_level (0-4, see `service_levels`), is_vip, external_link, next_contact_date, notes, membership_tier_label (free-text real tier name), extra (jsonb escape valve, use sparingly).

**people** — id, first_name, last_name, email, phone, personal_address, external_link, next_contact_date, notes, extra, client_since_year (int, year-only "how long have we known this person" — **forward-looking only**: fill in when found on a new person or a person you're actively re-checking, never backfilled just to populate it).

**sites** — id, address_line1, address_line2, city, state, zip, site_type (`Residential`/`Commercial`/`Residential Tenant`/`Commercial Tenant`/`Mixed`/`Other`), former_homeowner_id (FK people), external_link, next_contact_date, notes, extra, system_info (jsonb — per-category snapshot: `{"lighting": {"brand":..., "status": "present"|"absent"|"unknown", "platform":...}, "control_system": {...}, ...}`, one key per systems.category; PUTs merge rather than overwrite).

**vendors** — id, name, contact_email, contact_phone, specialty, address, external_link, notes. A trade-specific vendor (guarding, GC, locksmith, electrician, AV integrator, relocation, manufacturer rep) gets a row here even from a single account — they tend to recur. A client-side property/building management company (Tishman Speyer, FirstService Residential, JLL, Sudler...) is **not** a vendor — its staff link via `person_account` only, not `person_vendor`.

**systems** — id, site_id (FK), name, category (`access_control`/`control_system`/`security_alarm`/`video_surveillance`/`av_system`/`lighting`/`shades`/`climate`/`network`/`phone_system`/`remote_access` — closed enum, exactly these values), brand, model, install_date, warranty_expires, status (`active`/`offline`/`maintenance`/`decommissioned`), notes, integrated_with_control_system (bool), extra.

**components** — id, system_id (FK), name, type (free text), brand, model, serial_number, quantity, firmware_version, ip_address, mac_address, cable_category, status (`online`/`offline`/`fault`), notes, location (room/zone), po_number, proposal_ref (Sound Specialists proposal/job #), service_call_ref (Salesforce field-service ticket #), provided_by, install_date_approx (free text, e.g. `"2022"` is fine), config (jsonb, free-form).

**interactions** — id, site_id, system_id, component_id, person_id (the primary contact — for multiple participants also use `interaction_person`), vendor_id, account_id, interaction_type (`phone_call`/`email`/`on_site_visit`/`remote_session`/`sales`/`scheduled_checkup`/`change_order`/`other`), is_service (bool), interaction_date, description, cost, warranty_claim (bool), invoice_number, notes. This is the flat contact/service log — every account-relevant email or call should generally produce one of these.

**credentials** — id, site_id, system_id, label, username, password (both `username`/`password` are encrypted at rest by the API — always write through the API/`enter_account.py`, never insert plaintext directly via psql into this table), notes.

**subscriptions** — id, system_id, service, term, expires_approx, note.

## Junction tables (relationships)

**person_account** — (person_id, account_id) PK, is_primary_account_holder, is_billing_contact, is_correspondent, is_vip, role_label. `role_label` is a **short bare title only** — no parentheses, no company name, no correspondent/VIP/billing prose folded in (those are the boolean columns). Leave `NULL` rather than guess. `is_vip` here flags a *specific person* as high-priority even when the account itself isn't (e.g. a property manager whose being CC'd is a deliberate escalation signal) — never infer VIP from a person simply reaching out personally, that's usually the opposite signal. `is_correspondent` is for the actual primary point of contact/decision-maker — usually 1 person per account, occasionally 2 for a genuine co-primary (e.g. a couple) — not everyone who's just been talked to a lot.

**person_site** — (person_id, site_id) PK, role (`homeowner`/`property_manager`/`tenant`/`family_member`/`household_staff`/`general_contractor`/`vendor_contact`/`other`), is_primary_contact.

**person_vendor** — (person_id, vendor_id) PK, role_label, notes. A person can be linked via **both** `person_account` and `person_vendor` when they're vendor staff embedded full-time at one account (e.g. a security company's on-site director dedicated to one building) — one `people` row, dual-linked, not duplicated.

**site_account** — (site_id, account_id) PK. Links a site to the account(s) it belongs to (usually one, occasionally more for shared/multi-tenant situations).

**interaction_person** — (interaction_id, person_id) PK, relationship (`primary`/`participant`/`mentioned`). Use for a multi-participant thread beyond `interactions.person_id`'s single primary contact.

**components_used** — (interaction_id, part_number) PK, description, cost, quantity. A lighter-weight parts/cost ledger tied to a single interaction — distinct from the full `components` table (no FK to a real component row, no install/removal lifecycle). Prefer real `components` rows for anything durable; this is for simple cost tracking on a one-off visit.

## Internal-only tables

**users** — id, username, password_hash, role (`admin`/`manager`/`technician`), name, can_view_credentials. Sound Specialists staff logins — not client/vendor contacts.

**service_levels** — id (0-4), label. Lookup table for `accounts.service_level`.

## Conventions that apply regardless of which table you're writing to

- **Auto-create the moment new info surfaces**, even incomplete (e.g. no surname yet) — don't wait to have the full picture.
- **VIP is tracked at both levels** (`accounts.is_vip` and `person_account.is_vip`) — judge escalation priority by how severe the client *feels* an issue is, not just root-cause complexity, especially on a VIP account/person.
- **Internal domain trust** — anyone emailing from @soundspecialists.com or @4ssecurity.com is a trusted source for account facts.
- Full narrative detail (open items, frequent issues, root-cause patterns) has no home in this schema yet — that gap is tracked in the main `~/Guey/Abuelo/CLAUDE.md`/`Memory/` project, not here.

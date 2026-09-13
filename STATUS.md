# STATUS — Coffee Corner

> This file is the session-to-session source of truth for the project: current
> state, the execution plan (work the CURRENT STEP it points to), and history.
> Track it in git now (single-machine project) — update it as you go, and never
> put real client/member PII in it.

## What this is

Coffee Corner — a community-organizing webapp. Forked 2026-09-13 from ClowdForce
(`Egen85/ClowdForce` @ `4387fef`, the Sound Specialists / 4S client-services CRM),
renamed, re-branded, and re-oriented. Original repo is untouched and remains the
fork parent.

- Stack: Express single-file backend (`frontend/server.js`), vanilla JS SPA (`frontend/public/`), PostgreSQL.
- Inherited schema (accounts/people/sites/vendors/systems/components/interactions/credentials + junctions) is the **starting point**, to be reshaped for community organizing.
- DB: local Postgres, database `home_integration` (name is legacy; rename is backlog). **Intentionally empty** — the old client data is not wanted; new member data will come in separately and must never be committed.
- `community-model.md` — the approved v2 community schema (people / sites / site_person / gatherings / gathering_person / users; conversations as a jsonb blob on gatherings) — ready to build.

## Current state (2026-09-13)

- [x] Forked `Egen85/clowdforce` from `Egen85/ClowdForce` on GitHub (official fork; renamed to "Coffee Corner")
- [x] Re-branded Clowdforce → Coffee Corner (UI, package.json, docs, console)
- [x] Dropped the old KB/tooling (enter_account.py, import_data.py, check_kb_changes.py, cleanup_dup_320*, kb_sync_state.json, .agents/skills) — irrelevant to the new purpose
- [x] DB config env-driven (`DB_HOST/DB_NAME/DB_USER/DB_PASSWORD/DB_PORT`), nothing machine-specific in git
- [x] `.gitignore` PII guardrails: `data/`, `manifests/`, `*.csv`, `*.xlsx`, `.encryption-key`, `server.log` are all gitignored
- [x] Running locally via `com.tower.coffee-corner` launchd agent (:3000) + Homebrew Postgres 18
- [x] Migrations 001–009 applied; schema loads clean

## CURRENT STEP

1. **Build the v2 community schema** — `community-model.md` is approved (2026-09-13: user confirmed gatherings yes; people as one flat table with engagement-as-behavior; sites by geolocation not address; many sites anywhere; QR-scan opt-in + host-anywhere + notify loop; conversations as a jsonb debrief on gatherings, no topics table). Execute its Build steps in order: migration 010 → schema.md → frontend repoint (People/Sites/Gatherings + conversations editor) → ARCHITECTURE.md → verify.
2. QR intake + notification delivery + public exposure are the **next** phase after the core app works — see community-model.md's "Later features".

## Backlog

- Rename the `home_integration` database to something on-theme
- Notification delivery channel (SMS/email) behind `site_person.notify`
- Re-enable auth (`DEV_NO_AUTH = false` + users table seeding) once the app is in shape
- New PII data import path (when the user has the data: CSV under gitignored `data/` → import path → DB)
- Map view (lat/lon in `sites.extra`)
- Groups/sub-communities — only once they've actually emerged as topics

## History

- 2026-09-13 (3): User approved the model with revisions → **v2**: no topics table (conversations = jsonb debrief on gatherings), no host/member roles (engagement is behavior), sites by lat/lon not address, many sites anywhere, QR opt-in / host-anywhere / notify loop documented as the product loop. Ready to build.
- 2026-09-13 (2): User explained the actual community (public-space neighbor gatherings; principles: connected = safer, intentional/kind/open, keep what people dream). Wrote `community-model.md` v1 for review.
- 2026-09-13: Forked from ClowdForce, re-oriented as Coffee Corner, deployed locally.

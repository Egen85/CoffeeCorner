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

## Current state (2026-09-13)

- [x] Forked `Egen85/clowdforce` from `Egen85/ClowdForce` on GitHub (official fork; renamed to "Coffee Corner")
- [x] Re-branded Clowdforce → Coffee Corner (UI, package.json, docs, console)
- [x] Dropped the old KB/tooling (enter_account.py, import_data.py, check_kb_changes.py, cleanup_dup_320*, kb_sync_state.json, .agents/skills) — irrelevant to the new purpose
- [x] DB config env-driven (`DB_HOST/DB_NAME/DB_USER/DB_PASSWORD/DB_PORT`), nothing machine-specific in git
- [x] `.gitignore` PII guardrails: `data/`, `manifests/`, `*.csv`, `*.xlsx`, `.encryption-key`, `server.log` are all gitignored
- [x] Running locally via `com.tower.coffee-corner` launchd agent (:3000) + Homebrew Postgres 18
- [x] Migrations 001–009 applied; schema loads clean

## CURRENT STEP

1. **Define the community-organizing domain model.** Decide what a "member", an "event", a "cause/initiative", a "group", and a "contact/interaction" look like for the user's actual community work (who are we organizing? what do we track: attendance, shifts, petitions, meetings?). Output: a sketch of the new entity model to review with the user **before** writing migrations. The inherited accounts/people/etc. tables get mapped onto or replaced by this.

## Backlog

- Rename the `home_integration` database to something on-theme
- Write the real `ARCHITECTURE.md` (currently a skeleton)
- Decide the UI theme (the inherited design system is the ClowdForce look)
- Re-enable auth (`DEV_NO_AUTH = false` + users table seeding) once the app is in shape
- New PII data import path (when the user has the data: CSV under gitignored `data/` → import script/API → DB)

## History

- 2026-09-13: Forked from ClowdForce, re-oriented as Coffee Corner, deployed locally. (ClowdForce history before the fork lives in that repo / its dev machine.)

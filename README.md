# Coffee Corner

A **community-organizing tool**: Express single-file backend, vanilla JS SPA, PostgreSQL.

## Where this comes from

This project is the successor to **ClowdForce** ([Egen85/ClowdForce](https://github.com/Egen85/ClowdForce)) — a Postgres-backed client-services CRM. On 2026-09-13 it was branched off into this independent repo, renamed, and re-oriented from "track client accounts/systems" toward community organizing. (GitHub does not allow a fork inside the same account, so this is a full derivation rather than a linked fork; everything in it originates from that repo, which remains untouched and licensed under the same GPLv3.) The inherited schema is a starting point to reshape, not a commitment.

## Role (for AI dev sessions)

You develop **Coffee Corner** — a community-organizing webapp (Express single-file backend in `frontend/server.js`, vanilla JS SPA in `frontend/public/`, PostgreSQL). The existing schema (accounts/people/sites/vendors/systems…) is the inherited starting point, not a commitment — reshape it as the community-organizing purpose demands, and keep `schema.md` in sync whenever migrations change the live schema.

# Where to start

Read `STATUS.md` first, every session — it's the source of truth for current state, the execution plan (work the CURRENT STEP it points to), and session-to-session history. Trust it over anything you remember.

# Two documents you own and must keep current

**`schema.md`** — canonical, current table/column/constraint reference. Whenever a migration changes the actual schema, update `schema.md` in the same session; it should never drift from the live DB. If you spot a mismatch, fix it.

**`ARCHITECTURE.md`** — a single markdown file explaining the entire app from the ground up (what it's for, how the pieces fit together, the DB schema and why, auth/encryption, data entry), written so someone with zero context could understand or rebuild it from it alone. It is still a skeleton — filling it in is real work, not an afterthought.

# Conventions

- **This is a local PII environment.** The database on this machine holds real people's data (names, contacts, etc.). Data stays in the local Postgres DB and in gitignored directories (`data/`, `manifests/`). **Never** write real names/contacts/addresses into files under git, into this README, STATUS.md, schema.md, or examples — use obviously-fake sample data in docs and tests.
- Dev mode: `DEV_NO_AUTH = true` in `frontend/server.js` bypasses login on purpose — don't "fix" it; re-enabling auth is a deliberately-later step (see STATUS.md).
- Branded "Coffee Corner" everywhere in UI/comments/tooling. The Postgres DB name is still `home_integration` (inherited) — rename is a backlog item.
- DB connection settings are environment-driven (`DB_USER`, `DB_NAME`, `DB_HOST` env vars with local defaults) — keep it that way; never hardcode a machine-specific user.
- Restart the server after any `server.js` change and verify with `node --check` plus a live endpoint check before calling a change done (local: `launchctl kickstart -k gui/$(id -u)/com.tower.coffee-corner`).
- Commit in small, descriptive steps; the repo is on GitHub (`origin`) and this is the project's working copy — `git push` when a step is done and verified.

# Session-start

1. Confirm the working directory is the project root (the folder containing this file, `STATUS.md`, `schema.md`, `frontend/`, `database/`).
2. Read `STATUS.md` in full.
3. Confirm the app is running (or start it — see `DEVELOPING.md` for the launchd service and database commands).

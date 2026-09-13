# Local deployment notes (tower's Mac)

This directory (`~/Pi/CoffeeCorner`) **is the git working copy** of the
`Egen85/clowdforce` fork (official fork of `Egen85/ClowdForce`, re-oriented as
Coffee Corner). Changes get committed here and pushed to `origin`.

## Access

- Local:  http://localhost:3000
- LAN:    http://192.168.64.3:3000  (Express binds all interfaces; no external exposure by design)
- Auth:   `DEV_NO_AUTH = true` in `frontend/server.js` — no login; shows the "dev / admin" user.

## Services

| Service | What | Control |
|---|---|---|
| `com.tower.coffee-corner` | the Node app (`frontend/server.js`, port 3000, KeepAlive, start-at-login) | `launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.tower.coffee-corner.plist` / `launchctl bootout gui/501/com.tower.coffee-corner` |
| `sh.brew.postgresql@18` | Postgres 18 (Homebrew, starts at login) | `brew services start/stop postgresql@18` |

Log: `frontend/server.log` (gitignored). Restart the app after `server.js` changes:
`launchctl kickstart -k gui/501/com.tower.coffee-corner`

## Database

- Postgres superuser here is `tower` (Homebrew default). Connection settings in `server.js` are environment-driven: `DB_HOST` / `DB_NAME` (default `home_integration`) / `DB_USER` (default `tower`) / `DB_PASSWORD` / `DB_PORT` (default 5432) — no machine-specific values in the code.
- DB `home_integration` (created 2026-09-13, migrations `database/001–009` applied). Currently **empty** by design.
- Fresh schema: `dropdb home_integration && createdb home_integration && cd database && for f in 0*.sql; do /opt/homebrew/opt/postgresql@18/bin/psql -v ON_ERROR_STOP=1 -q -d home_integration -f $f; done`
- Dump: `pg_dump -d home_integration > data/$(date +%F).sql` (use `data/`, which is gitignored — a dump is PII)
- psql: `/opt/homebrew/opt/postgresql@18/bin/psql -d home_integration`

## PII guardrails (important)

- **Never commit real data.** `.gitignore` excludes `data/`, `manifests/`, `*.csv`, `*.xlsx`, `frontend/.encryption-key`, `account_progress.md`, logs.
- New member data (when it arrives): put source files in gitignored `data/`, load into the DB via the import path we build; the DB itself is local-only and holds the real data.
- `frontend/.encryption-key` is auto-generated on first run and is **load-bearing**: deleting it makes all encrypted credentials unreadable. Back it up next to any DB dump.

## Dependencies

- `cd frontend && npm install` (node 26, homebrew)
- Python tooling: none left — the old KB tools (`enter_account.py`, `import_data.py`, `check_kb_changes.py`) were removed with the re-orientation.

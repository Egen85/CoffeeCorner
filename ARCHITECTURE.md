# Coffee Corner — Architecture (ground-up explanation)

**Status: skeleton only, not yet written.** Goal: a single file that explains the entire app well enough that someone with zero prior context could understand or rebuild it from this alone. Build this out incrementally during Coffee Corner dev sessions — keep it current, not a stale snapshot. See `README.md` for the ownership rule.

## Planned sections

- **What this is and why** — the problem it solves, who uses it, why Postgres over NoSQL (see `STATUS.md`'s intro for the existing reasoning to fold in here).
- **Stack overview** — Express single-file backend, vanilla JS SPA, PostgreSQL. No build step, no framework — why, and what that trades away.
- **Database schema** — the entity model and why it's shaped this way (accounts/people/sites/vendors/systems/components/interactions/credentials + junction tables). Point to `schema.md` for the live column-level reference rather than duplicating it here; this section should explain the *shape* and *reasoning*, not restate every column.
- **Backend (`frontend/server.js`)** — route structure, auth model (`DEV_NO_AUTH`, `users` table, `requireAuth`/`requireManager`), the `/full` aggregate endpoints pattern, credential encryption (`ENCRYPTION_KEY`, persisted in `frontend/.encryption-key`).
- **Frontend (`frontend/public/`)** — the hash-routed SPA structure, `app.js` organization (FIELD_DEFS, record pages, modals), styling approach (`Memory/brand-style-guide.md`-derived — note: that file now lives at `~/Guey/Abuelo/Memory/brand-style-guide.md`).
- **Data entry tooling** — `enter_account.py`'s manifest-driven approach and why it replaced the old regex-based `import_data.py` (see STATUS.md's "Data-entry approach" section for the full history to summarize here).
- **Known gaps / where this is headed** — the Open Items/Cases gap, the Inactive-classification gap, anything else structurally unfinished (cross-reference STATUS.md's "Planned" sections rather than duplicating).

## Not yet started

This file was created 2026-09-04 as a placeholder with the outline above. No content has been written into the sections yet — a future Coffee Corner session should treat filling this in as real, valuable work, not an afterthought.

-- ============================================================================
-- Coffee Corner — Migration 005
-- Widens vendors.specialty from VARCHAR(200) to TEXT.
--
-- Found during 320-N-Sangamon account entry (2026-08-31): a natural-language
-- vendor specialty description (Genea's access-control role at that account,
-- including which support reps have appeared in correspondence) overflowed
-- the 200-char cap, and the POST /api/vendors route swallows the underlying
-- Postgres error into a generic {"error":"Server error"} (see server.js's
-- try/catch there — worth improving to surface the real DB error message,
-- but out of scope for this migration). Same rationale as migration 004
-- (which widened brand/model columns after 1932-Seminary's itemized parts
-- list overflowed security_system_model): richly-documented, proposal- or
-- correspondence-sourced accounts will keep producing free-text descriptions
-- that don't fit a short VARCHAR, and vendor specialty is exactly this kind
-- of field. Applied proactively rather than just trimming this one manifest.
-- ============================================================================

ALTER TABLE vendors ALTER COLUMN specialty TYPE TEXT;

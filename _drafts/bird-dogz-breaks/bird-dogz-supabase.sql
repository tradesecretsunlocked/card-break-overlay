-- ═══════════════════════════════════════════════════════════════
-- BIRD DOGZ BREAKS — Supabase SQL
-- Run these in: Supabase → SQL Editor → paste each block → Run
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- STEP 1: Activate bridge key
-- Run this if the full migration-keys.sql bulk INSERT hasn't been
-- run yet, OR if you need to confirm the key is in the table.
-- ON CONFLICT DO NOTHING = safe to re-run.
-- ─────────────────────────────────────────────────────────────────

INSERT INTO bridge_keys (key, client_name, active, notes)
VALUES (
  '35d7a9fe-60c6-4cc0-a61e-3987ee72d9be',
  'Bird Dogz Breaks',
  true,
  'migrated May 2026'
)
ON CONFLICT (key) DO UPDATE
  SET active      = true,
      client_name = EXCLUDED.client_name,
      updated_at  = now();


-- ─────────────────────────────────────────────────────────────────
-- STEP 2: Verify the key is live
-- Should return 1 row: key, Bird Dogz Breaks, active=true
-- ─────────────────────────────────────────────────────────────────

SELECT key, client_name, active, created_at, updated_at
FROM bridge_keys
WHERE key = '35d7a9fe-60c6-4cc0-a61e-3987ee72d9be';


-- ─────────────────────────────────────────────────────────────────
-- CLIENT REFERENCE (keep for your records)
-- ─────────────────────────────────────────────────────────────────
--
--   Client:      Bird Dogz Breaks
--   Bridge Key:  35d7a9fe-60c6-4cc0-a61e-3987ee72d9be
--   Bridge URL:  https://bridge.tradesecretsunlocked.com
--   Sport:       nil (multi-sport — NFL / NBA / MLB)
--   Overlay ID:  bird-dogz-breaks-overlay
--   Extension:   _drafts/bird-dogz-breaks/bird-dogz-breaks-extension.zip
--   Draft:       _drafts/bird-dogz-breaks/index.html
--
-- ─────────────────────────────────────────────────────────────────

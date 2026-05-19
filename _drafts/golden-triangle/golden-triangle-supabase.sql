-- ═══════════════════════════════════════════════════════════════
-- GOLDEN TRIANGLE RIPZ — Supabase SQL
-- Run in: Supabase → SQL Editor → paste → Run
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- STEP 1: Activate bridge key
-- Safe to re-run — ON CONFLICT DO UPDATE upserts and re-activates.
-- ─────────────────────────────────────────────────────────────────

INSERT INTO bridge_keys (key, client_name, active, notes)
VALUES (
  '16d5f085-00d1-4dfd-9eb4-9908c56481a3',
  'Golden Triangle',
  true,
  'migrated May 2026'
)
ON CONFLICT (key) DO UPDATE
  SET active      = true,
      client_name = EXCLUDED.client_name,
      updated_at  = now();


-- ─────────────────────────────────────────────────────────────────
-- STEP 2: Verify
-- Should return 1 row: key, Golden Triangle, active=true
-- ─────────────────────────────────────────────────────────────────

SELECT key, client_name, active, created_at, updated_at
FROM bridge_keys
WHERE key = '16d5f085-00d1-4dfd-9eb4-9908c56481a3';


-- ─────────────────────────────────────────────────────────────────
-- CLIENT REFERENCE
-- ─────────────────────────────────────────────────────────────────
--
--   Client:      Golden Triangle Ripz
--   Bridge Key:  16d5f085-00d1-4dfd-9eb4-9908c56481a3
--   Bridge URL:  https://bridge.tradesecretsunlocked.com
--   Overlay ID:  golden-triangle
--   Extension:   _drafts/golden-triangle/golden-triangle-extension-05-18-2026.zip
--   Overlay:     overlays/golden-triangle/index.html
--
-- ─────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────
-- USEFUL QUERIES
-- ─────────────────────────────────────────────────────────────────

-- Recent events for Golden Triangle (last 50):
-- SELECT occurred_at, channel, event_type, payload
-- FROM bridge_events
-- WHERE client_name = 'Golden Triangle'
-- ORDER BY occurred_at DESC
-- LIMIT 50;

-- Check if they're currently connected:
-- SELECT MAX(occurred_at) AS last_seen
-- FROM bridge_events
-- WHERE client_name = 'Golden Triangle';

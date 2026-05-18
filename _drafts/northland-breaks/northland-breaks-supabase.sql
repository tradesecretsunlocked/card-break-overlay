-- ═══════════════════════════════════════════════════════════════
-- NORTHLAND BREAKS — Supabase SQL
-- Run these in: Supabase → SQL Editor → paste each block → Run
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- STEP 1: Activate / confirm bridge key
-- The key was included in the bulk migration-keys.sql INSERT.
-- This block is safe to re-run — ON CONFLICT DO UPDATE upserts
-- any missing fields and re-activates the key if it was revoked.
-- ─────────────────────────────────────────────────────────────────

INSERT INTO bridge_keys (key, client_name, active, notes)
VALUES (
  '6405252d-d27a-40df-bc2e-d04fe56aa6bd',
  'Northland Breaks',
  true,
  'migrated May 2026'
)
ON CONFLICT (key) DO UPDATE
  SET active      = true,
      client_name = EXCLUDED.client_name,
      updated_at  = now();


-- ─────────────────────────────────────────────────────────────────
-- STEP 2: Verify the key is live
-- Should return 1 row: key, Northland Breaks, active=true
-- ─────────────────────────────────────────────────────────────────

SELECT key, client_name, active, created_at, updated_at
FROM bridge_keys
WHERE key = '6405252d-d27a-40df-bc2e-d04fe56aa6bd';


-- ─────────────────────────────────────────────────────────────────
-- STEP 3: Backfill client_name on any existing events
-- Only needed if bridge_events rows exist before client_name column
-- was added. Safe to run even if already backfilled (updates 0 rows).
-- ─────────────────────────────────────────────────────────────────

UPDATE bridge_events e
SET    client_name = k.client_name
FROM   bridge_keys k
WHERE  e.bridge_key::text = k.key::text
  AND  k.key = '6405252d-d27a-40df-bc2e-d04fe56aa6bd'
  AND  e.client_name IS NULL;


-- ─────────────────────────────────────────────────────────────────
-- CLIENT REFERENCE (keep for your records)
-- ─────────────────────────────────────────────────────────────────
--
--   Client:      Northland Breaks
--   Bridge Key:  6405252d-d27a-40df-bc2e-d04fe56aa6bd
--   Bridge URL:  https://bridge.tradesecretsunlocked.com
--   Sport:       nil (multi-sport — NFL / NBA / MLB / NHL)
--   Overlay ID:  northland-breaks-overlay
--   Extension:   _drafts/northland-breaks/northland-breaks-extension.zip
--   Draft:       _drafts/northland-breaks/index.html
--
-- ─────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────
-- USEFUL QUERIES (run any time in SQL Editor)
-- ─────────────────────────────────────────────────────────────────

-- All events for Northland (last 100):
-- SELECT occurred_at, channel, event_type, payload
-- FROM bridge_events
-- WHERE client_name = 'Northland Breaks'
-- ORDER BY occurred_at DESC
-- LIMIT 100;

-- team_sold events for Northland today:
-- SELECT occurred_at, channel, payload->>'code' AS team
-- FROM bridge_events
-- WHERE client_name = 'Northland Breaks'
--   AND event_type = 'team_sold'
--   AND occurred_at > now() - interval '24 hours'
-- ORDER BY occurred_at DESC;

-- Last time Northland connected:
-- SELECT MAX(occurred_at) AS last_seen
-- FROM bridge_events
-- WHERE client_name = 'Northland Breaks';

-- All event types Northland has ever sent:
-- SELECT event_type, COUNT(*) AS total
-- FROM bridge_events
-- WHERE client_name = 'Northland Breaks'
-- GROUP BY event_type
-- ORDER BY total DESC;

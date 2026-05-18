-- ═══════════════════════════════════════════════════════════════════
-- TSU Bridge — Client-Named Logging
-- Run in: Supabase → SQL Editor
-- Purpose: makes bridge_events queryable by client name so you can
--          isolate one client's traffic without scrolling Render logs
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- STEP 1: Add client_name to bridge_events (if not already there)
-- Safe to re-run — IF NOT EXISTS / IF NOT EXISTS guards it.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE bridge_events
  ADD COLUMN IF NOT EXISTS client_name text;

-- Index for fast per-client queries
CREATE INDEX IF NOT EXISTS idx_bridge_events_client
  ON bridge_events (client_name, occurred_at DESC);


-- ─────────────────────────────────────────────────────────────────
-- STEP 2: Backfill client_name on existing rows (one-time)
-- Joins bridge_events → bridge_keys on bridge_key = key
-- ─────────────────────────────────────────────────────────────────

UPDATE bridge_events e
SET    client_name = k.client_name
FROM   bridge_keys k
WHERE  e.bridge_key::text = k.key::text
  AND  e.client_name IS NULL;


-- ─────────────────────────────────────────────────────────────────
-- STEP 3: Verify — should show rows per client with recent events
-- ─────────────────────────────────────────────────────────────────

SELECT
  client_name,
  COUNT(*)                    AS total_events,
  MAX(occurred_at)            AS last_seen,
  COUNT(DISTINCT event_type)  AS unique_event_types
FROM bridge_events
GROUP BY client_name
ORDER BY last_seen DESC NULLS LAST
LIMIT 50;


-- ─────────────────────────────────────────────────────────────────
-- USEFUL QUERIES (run any time in SQL Editor)
-- ─────────────────────────────────────────────────────────────────

-- All events for a specific client (last 100):
-- SELECT occurred_at, channel, event_type, payload
-- FROM bridge_events
-- WHERE client_name = 'Bird Dogz Breaks'
-- ORDER BY occurred_at DESC
-- LIMIT 100;

-- All team_sold events across all clients today:
-- SELECT occurred_at, client_name, channel, payload->>'code' AS team
-- FROM bridge_events
-- WHERE event_type = 'team_sold'
--   AND occurred_at > now() - interval '24 hours'
-- ORDER BY occurred_at DESC;

-- Which clients connected in the last hour:
-- SELECT DISTINCT client_name, MAX(occurred_at) AS last_event
-- FROM bridge_events
-- WHERE occurred_at > now() - interval '1 hour'
-- GROUP BY client_name
-- ORDER BY last_event DESC;

-- Run this once in Supabase SQL Editor
-- Creates the bridge_keys table for client access control

CREATE TABLE IF NOT EXISTS bridge_keys (
  key          TEXT        PRIMARY KEY,
  client_name  TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bridge_keys_updated_at
  BEFORE UPDATE ON bridge_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed PMM (Pokemaster Mates) — your test client
INSERT INTO bridge_keys (key, client_name, notes)
VALUES (
  'd7590321265f7a13091dfa4275bb4e4a',
  'Pokemaster Mates',
  'Test client — PMM overlay'
)
ON CONFLICT (key) DO NOTHING;

-- Map-first Atlas format.
--
-- Run this once in the Supabase SQL editor before shipping the new Atlas UI.
-- Existing collection-style atlas rows are intentionally not deleted: marking
-- new rows as format_version = 2 keeps legacy data out of the new experience
-- without destructively removing another user's saved collections.

ALTER TABLE atlas
  ADD COLUMN IF NOT EXISTS format_version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS route_geojson JSONB,
  ADD COLUMN IF NOT EXISTS route_visible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE atlas_places
  ADD COLUMN IF NOT EXISTS timeline_day INT,
  ADD COLUMN IF NOT EXISTS timeline_time TEXT,
  ADD COLUMN IF NOT EXISTS place_name TEXT,
  ADD COLUMN IF NOT EXISTS place_subtitle TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS external_place_id TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT;

-- A row represents either a saved My Places row or an Atlas-only search result.
ALTER TABLE atlas_places ALTER COLUMN place_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_atlas_format_version ON atlas(format_version);

-- New Atlas rows must include format_version = 2. Existing rows remain at 1
-- and are excluded by the mobile read query.

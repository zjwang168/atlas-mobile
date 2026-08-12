-- System-owned, sensitive place roles. A user can have at most one row for
-- each role; the existing `places` row remains the source of map coordinates.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS special_role VARCHAR(16)
  CHECK (special_role IN ('home', 'office', 'school'));

CREATE UNIQUE INDEX IF NOT EXISTS places_one_special_role_per_user
  ON places (user_id, special_role)
  WHERE special_role IS NOT NULL;

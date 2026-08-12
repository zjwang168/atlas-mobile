-- ============================================================
-- Auth & RLS (2026-07-16)
-- User identity: silent anonymous sign-in on first launch;
-- upgradeable to email (same uid, data retained).
-- ============================================================

-- Ownership columns (DEFAULT auth.uid(): frontend direct inserts
-- are stamped automatically; backend acts as user via JWT pass-through)
ALTER TABLE places            ADD COLUMN user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE atlas             ADD COLUMN user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();

CREATE UNIQUE INDEX places_one_special_role_per_user
  ON places (user_id, special_role) WHERE special_role IS NOT NULL;
ALTER TABLE conversations     ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE long_term_memory  ALTER COLUMN user_id SET DEFAULT auth.uid();
-- (legacy rows backfilled to the project owner's uid)

-- RLS: top-level tables — own rows only
ALTER TABLE places            ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own places" ON places FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON conversations FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE long_term_memory  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own memories" ON long_term_memory FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
ALTER TABLE atlas             ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own atlas" ON atlas FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- RLS: child tables — access via owned parent
ALTER TABLE place_sources          ENABLE ROW LEVEL SECURITY;
CREATE POLICY "via parent place" ON place_sources FOR ALL
  USING (EXISTS (SELECT 1 FROM places p WHERE p.id = place_id AND p.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM places p WHERE p.id = place_id AND p.user_id = auth.uid()));
ALTER TABLE conversation_messages  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "via parent conversation" ON conversation_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
ALTER TABLE conversation_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "via parent conversation" ON conversation_locations FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "via parent conversation" ON conversation_summaries FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
ALTER TABLE atlas_places            ENABLE ROW LEVEL SECURITY;
CREATE POLICY "via parent atlas" ON atlas_places FOR ALL
  USING (EXISTS (SELECT 1 FROM atlas col WHERE col.id = atlas_id AND col.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM atlas col WHERE col.id = atlas_id AND col.user_id = auth.uid()));

-- Notes:
-- * Anonymous users share the `authenticated` role; per-uid policies
--   isolate them the same as email users.
-- * If we later need "permanent users only" actions, gate with
--   (auth.jwt()->>'is_anonymous')::boolean via a RESTRICTIVE policy.
-- * plans/itinerary tables: add user_id + RLS when the plan feature
--   lands real data.

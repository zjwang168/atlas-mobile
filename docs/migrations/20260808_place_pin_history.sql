-- Durable audit trail for the map pin <-> My Places row relationship.
-- place_id is text so offline-generated local IDs can be recorded too.

CREATE TABLE IF NOT EXISTS place_pin_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    place_id TEXT NOT NULL,
    stable_key TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('saved', 'deleted')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_pin_history_place_id ON place_pin_history(place_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_pin_history_user_id ON place_pin_history(user_id, occurred_at DESC);

ALTER TABLE place_pin_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own place pin history" ON place_pin_history FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

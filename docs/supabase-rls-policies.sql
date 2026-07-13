-- Supabase Row Level Security Policies for anon key access
-- Run this in Supabase SQL Editor to allow anonymous read/write

-- Allow anonymous users to read/write conversations
CREATE POLICY "Enable all for anon" ON conversations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all for anon" ON conversation_messages
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all for anon" ON conversation_locations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all for anon" ON conversation_summaries
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all for anon" ON long_term_memory
  FOR ALL USING (true) WITH CHECK (true);


-- Conversation persistence tables for chat history and attached place snapshots.
-- Chat history is product data; it is not automatically injected as user memory.

-- Reverse-engineered from backend/services/supabase_service.py:

-- every column below is read or written by that service.

-- Applied to the team Supabase (Zijin's project) on 2026-07-03.

CREATE TABLE conversations (

    id UUID PRIMARY KEY,                    -- code supplies its own uuid (no default needed)

    user_id UUID,                           -- filtered in list_conversations; nullable until auth

    title TEXT NOT NULL DEFAULT 'Untitled',

    source_url TEXT,

    source_type VARCHAR(50),                -- 'reddit' | 'generic'

    inferred_region TEXT,

    location_count INTEGER DEFAULT 0,

    message_count INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE TABLE conversation_messages (

    id UUID PRIMARY KEY,

    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

    role VARCHAR(20) NOT NULL,              -- 'user' | 'assistant' | 'tool'

    content TEXT,

    tool_calls TEXT,                        -- JSON serialized (code json.dumps's it)

    tool_results TEXT,                      -- JSON serialized

    message_index INTEGER NOT NULL DEFAULT 0,   -- ordered by this on load

    created_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE INDEX idx_conv_messages_conv ON conversation_messages(conversation_id, message_index);

CREATE TABLE conversation_locations (

    id UUID PRIMARY KEY,

    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,

    latitude DECIMAL(10, 7),

    longitude DECIMAL(10, 7),

    full_address TEXT,

    hierarchy_level INTEGER DEFAULT 2,

    is_active BOOLEAN DEFAULT TRUE,         -- load filters .eq('is_active', True)

    sentiment VARCHAR(50),

    description TEXT,

    category VARCHAR(100),

    created_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE INDEX idx_conv_locations_conv ON conversation_locations(conversation_id);

CREATE TABLE conversation_summaries (

    id UUID PRIMARY KEY,

    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

    summary TEXT NOT NULL,

    start_message_index INTEGER NOT NULL DEFAULT 0,

    end_message_index INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE INDEX idx_conv_summaries_conv ON conversation_summaries(conversation_id, end_message_index DESC);

CREATE TABLE long_term_memory (

    id UUID PRIMARY KEY,

    user_id UUID,                           -- filtered in list_memories; nullable until auth

    key TEXT NOT NULL,                      -- deleted-by-key before insert (logical unique key)

    value TEXT,

    category VARCHAR(50) DEFAULT 'preference',

    updated_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE INDEX idx_ltm_key ON long_term_memory(key);

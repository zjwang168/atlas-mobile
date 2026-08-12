-- OurAtlas Database Schema
-- PostgreSQL + PostGIS

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(255),
    avatar_url TEXT,
    auth_provider VARCHAR(50),
    location VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE places (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    description TEXT,
    ai_summary TEXT,
    category VARCHAR(100),
    tags TEXT[],
    address TEXT,
    city VARCHAR(100),
    region VARCHAR(100),
    country VARCHAR(100),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    location GEOGRAPHY(POINT, 4326),
    external_place_id VARCHAR(255),
    external_source VARCHAR(100),
    visibility VARCHAR(50) DEFAULT 'private',
    recommended BOOLEAN,
    photo_url TEXT,
    note TEXT,
    special_role VARCHAR(16) CHECK (special_role IN ('home', 'office', 'school')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE place_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    place_id UUID REFERENCES places(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    source_type VARCHAR(100),
    source_url TEXT,
    raw_text TEXT,
    screenshot_url TEXT,
    ai_extracted_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE atlas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(50) DEFAULT 'private',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE atlas_places (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    atlas_id UUID REFERENCES atlas(id) ON DELETE CASCADE,
    place_id UUID REFERENCES places(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (atlas_id, place_id)
);

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,  -- legacy, unused by RLS
    user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),  -- RLS ownership column, mirrors places.user_id / atlas.user_id
    title VARCHAR(255) NOT NULL,
    destination VARCHAR(255),
    start_date DATE,
    end_date DATE,
    description TEXT,
    visibility VARCHAR(50) DEFAULT 'private',
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plan_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (plan_id, user_id)
);

-- A place may appear more than once in the same plan (e.g. the same coffee
-- shop visited on two different mornings), so there is no UNIQUE(plan_id, place_id).
-- Ownership for RLS is proven via the parent `plans.user_id`, not a column here.
CREATE TABLE plan_itinerary_place_flexible (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
    place_id UUID REFERENCES places(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'saved',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ownership for RLS is proven via the parent `plans.user_id`, not a column here.
CREATE TABLE plan_itinerary_days (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
    date DATE,
    title VARCHAR(255),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- sort_order is scoped within (itinerary_day_id, visit_slot), not just the day.
-- Ownership for RLS is proven via itinerary_day_id -> plan_itinerary_days.plan_id -> plans.user_id.
CREATE TABLE plan_itinerary_places (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    itinerary_day_id UUID REFERENCES plan_itinerary_days(id) ON DELETE CASCADE,
    place_id UUID REFERENCES places(id) ON DELETE SET NULL,
    visit_slot VARCHAR(20) CHECK (visit_slot IN ('morning', 'noon', 'afternoon', 'night')),
    note TEXT,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    atlas_id UUID REFERENCES atlas(id) ON DELETE SET NULL,
    input_type VARCHAR(100),
    input_url TEXT,
    input_text TEXT,
    file_url TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE extracted_places (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id UUID REFERENCES imports(id) ON DELETE CASCADE,
    name VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    location GEOGRAPHY(POINT, 4326),
    ai_summary TEXT,
    confidence DECIMAL(4, 3),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    title VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender_type VARCHAR(50),
    content TEXT NOT NULL,
    extracted_places JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_place_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    place_id UUID REFERENCES places(id) ON DELETE CASCADE,
    interaction_type VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes

CREATE INDEX idx_places_created_by ON places(created_by);
CREATE INDEX idx_places_location_gist ON places USING GIST(location);
CREATE INDEX idx_places_category ON places(category);

CREATE INDEX idx_place_sources_place_id ON place_sources(place_id);
CREATE INDEX idx_place_sources_user_id ON place_sources(user_id);

CREATE INDEX idx_atlas_owner_id ON atlas(owner_id);
CREATE INDEX idx_atlas_places_atlas_id ON atlas_places(atlas_id);
CREATE INDEX idx_atlas_places_place_id ON atlas_places(place_id);

CREATE INDEX idx_plans_owner_id ON plans(owner_id);
CREATE INDEX idx_plan_members_plan_id ON plan_members(plan_id);
CREATE INDEX idx_plan_members_user_id ON plan_members(user_id);
CREATE INDEX idx_plan_itinerary_place_flexible_plan_id ON plan_itinerary_place_flexible(plan_id);
CREATE INDEX idx_plan_itinerary_place_flexible_place_id ON plan_itinerary_place_flexible(place_id);

CREATE INDEX idx_plan_itinerary_days_plan_id ON plan_itinerary_days(plan_id);
CREATE INDEX idx_plan_itinerary_places_day_id ON plan_itinerary_places(itinerary_day_id);
CREATE INDEX idx_plan_itinerary_places_place_id ON plan_itinerary_places(place_id);

CREATE INDEX idx_imports_user_id ON imports(user_id);
CREATE INDEX idx_imports_plan_id ON imports(plan_id);
CREATE INDEX idx_imports_status ON imports(status);
CREATE INDEX idx_extracted_places_import_id ON extracted_places(import_id);

CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_plan_id ON chat_sessions(plan_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(chat_session_id);

CREATE INDEX idx_user_place_interactions_user_id ON user_place_interactions(user_id);
CREATE INDEX idx_user_place_interactions_place_id ON user_place_interactions(place_id);

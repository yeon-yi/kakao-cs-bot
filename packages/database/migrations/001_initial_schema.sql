-- 001_initial_schema.sql
-- 초기 데이터베이스 스키마

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_usage_count(knowledge_uuid UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE knowledge_base
    SET usage_count = usage_count + 1
    WHERE id = knowledge_uuid;
END;
$$ LANGUAGE plpgsql;

-- 1. knowledge_base
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
    question TEXT NOT NULL,
    answer TEXT,
    category VARCHAR(100),
    embedding vector(768),
    source VARCHAR(500),
    taught_by VARCHAR(100),
    tags TEXT[],
    notes TEXT,
    usage_count INTEGER DEFAULT 0,
    confidence_score FLOAT DEFAULT 1.0 CHECK (confidence_score BETWEEN 0 AND 1),
    is_active BOOLEAN DEFAULT TRUE,
    parent_knowledge_id UUID REFERENCES knowledge_base(id),
    verification_status VARCHAR(50) DEFAULT 'unverified',
    ai_interpretation TEXT,
    verified_by VARCHAR(100),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge_base USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_knowledge_tier ON knowledge_base(tier);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_active ON knowledge_base(is_active);
CREATE INDEX IF NOT EXISTS idx_knowledge_usage ON knowledge_base(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_question_trgm ON knowledge_base USING gin (question gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_base USING gin(tags);

CREATE TRIGGER update_knowledge_updated_at
    BEFORE UPDATE ON knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- search_knowledge function
CREATE OR REPLACE FUNCTION search_knowledge(
    query_embedding vector(768),
    query_text TEXT,
    p_tier INTEGER DEFAULT NULL,
    p_category VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID, question TEXT, answer TEXT, category VARCHAR,
    similarity FLOAT, tier INTEGER, source VARCHAR, usage_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT kb.id, kb.question, kb.answer, kb.category,
        1 - (kb.embedding <=> query_embedding) AS similarity,
        kb.tier, kb.source, kb.usage_count
    FROM knowledge_base kb
    WHERE kb.is_active = TRUE
        AND (p_tier IS NULL OR kb.tier = p_tier)
        AND (p_category IS NULL OR kb.category = p_category)
        AND (kb.embedding <=> query_embedding < 0.5 OR kb.question % query_text)
    ORDER BY kb.tier ASC, similarity DESC, kb.usage_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 2. knowledge_history
CREATE TABLE IF NOT EXISTS knowledge_history (
    id BIGSERIAL PRIMARY KEY,
    knowledge_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE')),
    previous_question TEXT,
    previous_answer TEXT,
    new_question TEXT,
    new_answer TEXT,
    change_reason TEXT,
    changed_by VARCHAR(100) NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_knowledge ON knowledge_history(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_history_changed_at ON knowledge_history(changed_at DESC);

-- 3. conversations
CREATE TABLE IF NOT EXISTS conversations (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(100),
    user_message TEXT NOT NULL,
    bot_response TEXT,
    context JSONB DEFAULT '{}',
    knowledge_tier INTEGER,
    ai_model VARCHAR(50),
    confidence FLOAT,
    was_helpful BOOLEAN,
    response_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_room_user ON conversations(room_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_context ON conversations USING gin(context);

-- 4. room_members
CREATE TABLE IF NOT EXISTS room_members (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(100),
    role VARCHAR(50) NOT NULL CHECK (role IN ('advertiser', 'company_staff', 'bot', 'partner', 'unknown')),
    confirmed_by VARCHAR(100),
    confidence FLOAT DEFAULT 0.5,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

-- 5. company_staff
CREATE TABLE IF NOT EXISTS company_staff (
    id SERIAL PRIMARY KEY,
    kakao_user_id VARCHAR(100) UNIQUE,
    kakao_name VARCHAR(100),
    real_name VARCHAR(100) NOT NULL,
    email VARCHAR(200) UNIQUE,
    phone VARCHAR(20),
    department VARCHAR(100),
    position VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    added_by VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_staff_kakao_id ON company_staff(kakao_user_id);

-- 6. staff_aliases
CREATE TABLE IF NOT EXISTS staff_aliases (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES company_staff(id) ON DELETE CASCADE,
    alias VARCHAR(100) NOT NULL,
    platform VARCHAR(50) DEFAULT 'kakao',
    UNIQUE(alias, platform)
);

-- 7. message_queue
CREATE TABLE IF NOT EXISTS message_queue (
    id VARCHAR(100) PRIMARY KEY,
    data JSONB NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    assigned_to VARCHAR(100),
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON message_queue(status, priority, created_at);

-- 8. app_config
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(200) PRIMARY KEY,
    value JSONB NOT NULL,
    category VARCHAR(100),
    description TEXT,
    updated_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. prompt_templates
CREATE TABLE IF NOT EXISTS prompt_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) UNIQUE NOT NULL,
    template TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    variables JSONB DEFAULT '[]',
    category VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(100)
);

-- 10. prompt_history
CREATE TABLE IF NOT EXISTS prompt_history (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES prompt_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    template TEXT NOT NULL,
    change_reason TEXT,
    changed_by VARCHAR(100),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. analytics_daily
CREATE TABLE IF NOT EXISTS analytics_daily (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_messages INTEGER DEFAULT 0,
    auto_responses INTEGER DEFAULT 0,
    admin_escalations INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER,
    p95_response_time_ms INTEGER,
    gemini_calls INTEGER DEFAULT 0,
    claude_calls INTEGER DEFAULT 0,
    total_ai_cost DECIMAL(10,4) DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    not_helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily(date DESC);

-- 12. escalations
CREATE TABLE IF NOT EXISTS escalations (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100),
    user_name VARCHAR(100),
    category VARCHAR(100),
    reason TEXT,
    user_message TEXT,
    bot_response TEXT,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'resolved', 'dismissed')),
    assigned_staff_id INTEGER REFERENCES company_staff(id),
    resolution TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_room ON escalations(room_id);

-- 13. connected_devices
CREATE TABLE IF NOT EXISTS connected_devices (
    device_id VARCHAR(200) PRIMARY KEY,
    device_name VARCHAR(200),
    device_type VARCHAR(50) DEFAULT 'android',
    app_version VARCHAR(50),
    os_version VARCHAR(50),
    status VARCHAR(50) DEFAULT 'offline',
    last_heartbeat TIMESTAMPTZ,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    messages_today INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. proactive_messages
CREATE TABLE IF NOT EXISTS proactive_messages (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(100),
    message TEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'greeting',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    last_activity TIMESTAMPTZ,
    inactive_days INTEGER,
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_status ON proactive_messages(status, created_at);

-- 15. uncertainty_log
CREATE TABLE IF NOT EXISTS uncertainty_log (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100),
    user_name VARCHAR(100),
    user_message TEXT NOT NULL,
    bot_response TEXT,
    confidence FLOAT,
    reason VARCHAR(200),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'learned', 'dismissed')),
    resolution TEXT,
    resolved_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uncertainty_status ON uncertainty_log(status, created_at DESC);

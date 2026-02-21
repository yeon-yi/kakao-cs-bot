-- ============================================================================
-- AI_Chat Supabase PostgreSQL Schema
-- ============================================================================
-- Description : Full database schema for AI_Chat application
-- Database    : Supabase (PostgreSQL)
-- Generated   : 2026-02-10
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 2. UTILITY FUNCTIONS
-- ============================================================================

-- Automatically update the updated_at column on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Atomically increment the usage_count column
CREATE OR REPLACE FUNCTION increment_usage_count()
RETURNS TRIGGER AS $$
BEGIN
    NEW.usage_count = COALESCE(OLD.usage_count, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. TABLES
-- ============================================================================

-- --------------------------------------------------------------------------
-- 3-1. knowledge_base
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_base (
    id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tier             INT             NOT NULL CHECK (tier BETWEEN 1 AND 3),
    question         TEXT            NOT NULL,
    answer           TEXT            NOT NULL,
    category         VARCHAR(100),
    embedding        vector(768),
    source           VARCHAR(500),
    taught_by        VARCHAR(100),
    tags             TEXT[],
    notes            TEXT,
    usage_count      INT             NOT NULL DEFAULT 0,
    confidence_score FLOAT           NOT NULL DEFAULT 1.0,
    is_active        BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  knowledge_base IS 'Core knowledge store organised by tier (1=exact, 2=pattern, 3=AI-generated)';
COMMENT ON COLUMN knowledge_base.tier IS '1: exact match, 2: pattern/category, 3: AI-generated';

-- HNSW index for fast approximate nearest-neighbour search on embeddings
CREATE INDEX IF NOT EXISTS idx_knowledge_base_embedding_hnsw
    ON knowledge_base
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- GIN index for efficient tag array containment queries
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags_gin
    ON knowledge_base
    USING gin (tags);

-- Trigram index for fuzzy text search on question column
CREATE INDEX IF NOT EXISTS idx_knowledge_base_question_trgm
    ON knowledge_base
    USING gin (question gin_trgm_ops);

-- Additional B-tree indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tier
    ON knowledge_base (tier);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_category
    ON knowledge_base (category);

CREATE INDEX IF NOT EXISTS idx_knowledge_base_is_active
    ON knowledge_base (is_active);

-- Trigger: auto-update updated_at on every row change
CREATE TRIGGER trg_knowledge_base_updated_at
    BEFORE UPDATE ON knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- 3-2. knowledge_history
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_history (
    id                BIGSERIAL       PRIMARY KEY,
    knowledge_id      UUID            NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
    action            VARCHAR(50)     NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE')),
    previous_question TEXT,
    previous_answer   TEXT,
    new_question      TEXT,
    new_answer        TEXT,
    change_reason     TEXT,
    changed_by        VARCHAR(100),
    changed_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE knowledge_history IS 'Audit trail for all mutations on knowledge_base';

CREATE INDEX IF NOT EXISTS idx_knowledge_history_knowledge_id
    ON knowledge_history (knowledge_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_history_changed_at
    ON knowledge_history (changed_at);

-- --------------------------------------------------------------------------
-- 3-3. conversations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id               BIGSERIAL       PRIMARY KEY,
    room_id          VARCHAR(100),
    user_id          VARCHAR(100),
    user_name        VARCHAR(100),
    user_message     TEXT,
    bot_response     TEXT,
    context          JSONB,
    knowledge_tier   INT,
    ai_model         VARCHAR(50),
    confidence       FLOAT,
    was_helpful      BOOLEAN,
    response_time_ms INT,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE conversations IS 'Full conversation log between users and the bot';

CREATE INDEX IF NOT EXISTS idx_conversations_room_id
    ON conversations (room_id);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id
    ON conversations (user_id);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
    ON conversations (created_at);

-- --------------------------------------------------------------------------
-- 3-4. room_members
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_members (
    id            BIGSERIAL       PRIMARY KEY,
    room_id       VARCHAR(100)    NOT NULL,
    user_id       VARCHAR(100)    NOT NULL,
    user_name     VARCHAR(100),
    role          VARCHAR(50)     CHECK (role IN ('advertiser', 'company_staff', 'bot', 'partner', 'unknown')),
    confirmed_by  VARCHAR(100),
    confidence    FLOAT           NOT NULL DEFAULT 0.5,
    joined_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_room_members_room_user UNIQUE (room_id, user_id)
);

COMMENT ON TABLE room_members IS 'Tracks which users belong to which chat rooms and their roles';

CREATE INDEX IF NOT EXISTS idx_room_members_room_id
    ON room_members (room_id);

CREATE INDEX IF NOT EXISTS idx_room_members_user_id
    ON room_members (user_id);

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_room_members_updated_at
    BEFORE UPDATE ON room_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- 3-5. company_staff
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_staff (
    id              SERIAL          PRIMARY KEY,
    kakao_user_id   VARCHAR(100)    UNIQUE,
    kakao_name      VARCHAR(100),
    real_name       VARCHAR(100),
    email           VARCHAR(200)    UNIQUE,
    phone           VARCHAR(20),
    department      VARCHAR(100),
    position        VARCHAR(100),
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    added_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    added_by        VARCHAR(100)
);

COMMENT ON TABLE company_staff IS 'Registry of known company employees (used for role resolution)';

CREATE INDEX IF NOT EXISTS idx_company_staff_kakao_user_id
    ON company_staff (kakao_user_id);

CREATE INDEX IF NOT EXISTS idx_company_staff_is_active
    ON company_staff (is_active);

-- --------------------------------------------------------------------------
-- 3-6. staff_aliases
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_aliases (
    id        SERIAL          PRIMARY KEY,
    staff_id  INT             NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
    alias     VARCHAR(100)    NOT NULL,
    platform  VARCHAR(50)     NOT NULL DEFAULT 'kakao',

    CONSTRAINT uq_staff_aliases_alias_platform UNIQUE (alias, platform)
);

COMMENT ON TABLE staff_aliases IS 'Alternative display names for staff across platforms';

CREATE INDEX IF NOT EXISTS idx_staff_aliases_staff_id
    ON staff_aliases (staff_id);

-- --------------------------------------------------------------------------
-- 3-7. message_queue
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_queue (
    id                    VARCHAR(100)    PRIMARY KEY,
    data                  JSONB,
    status                VARCHAR(50)     NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority              VARCHAR(20)     NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    assigned_to           VARCHAR(100),
    attempts              INT             NOT NULL DEFAULT 0,
    last_error            TEXT,
    created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ
);

COMMENT ON TABLE message_queue IS 'Durable message queue for asynchronous processing';

CREATE INDEX IF NOT EXISTS idx_message_queue_status
    ON message_queue (status);

CREATE INDEX IF NOT EXISTS idx_message_queue_priority
    ON message_queue (priority);

CREATE INDEX IF NOT EXISTS idx_message_queue_created_at
    ON message_queue (created_at);

-- --------------------------------------------------------------------------
-- 3-8. app_config
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
    key         VARCHAR(200)    PRIMARY KEY,
    value       JSONB           NOT NULL,
    category    VARCHAR(100),
    description TEXT,
    updated_by  VARCHAR(100),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app_config IS 'Application-wide key/value configuration store';

CREATE INDEX IF NOT EXISTS idx_app_config_category
    ON app_config (category);

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_app_config_updated_at
    BEFORE UPDATE ON app_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- 3-9. prompt_templates
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompt_templates (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(200)    NOT NULL UNIQUE,
    template    TEXT            NOT NULL,
    version     INT             NOT NULL DEFAULT 1,
    variables   JSONB           NOT NULL DEFAULT '[]'::jsonb,
    category    VARCHAR(100),
    description TEXT,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    created_by  VARCHAR(100)
);

COMMENT ON TABLE prompt_templates IS 'Versioned prompt templates for AI model calls';

CREATE INDEX IF NOT EXISTS idx_prompt_templates_category
    ON prompt_templates (category);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_is_active
    ON prompt_templates (is_active);

-- --------------------------------------------------------------------------
-- 3-10. prompt_history
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompt_history (
    id            SERIAL          PRIMARY KEY,
    template_id   INT             NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
    version       INT             NOT NULL,
    template      TEXT            NOT NULL,
    change_reason TEXT,
    changed_by    VARCHAR(100),
    changed_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE prompt_history IS 'Audit trail for prompt template changes';

CREATE INDEX IF NOT EXISTS idx_prompt_history_template_id
    ON prompt_history (template_id);

CREATE INDEX IF NOT EXISTS idx_prompt_history_changed_at
    ON prompt_history (changed_at);

-- --------------------------------------------------------------------------
-- 3-11. analytics_daily
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_daily (
    id                   SERIAL          PRIMARY KEY,
    date                 DATE            NOT NULL UNIQUE,
    total_messages       INT             NOT NULL DEFAULT 0,
    auto_responses       INT             NOT NULL DEFAULT 0,
    admin_escalations    INT             NOT NULL DEFAULT 0,
    avg_response_time_ms INT,
    p95_response_time_ms INT,
    gemini_calls         INT             NOT NULL DEFAULT 0,
    claude_calls         INT             NOT NULL DEFAULT 0,
    total_ai_cost        DECIMAL(10,4)   NOT NULL DEFAULT 0,
    helpful_count        INT             NOT NULL DEFAULT 0,
    not_helpful_count    INT             NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE analytics_daily IS 'Aggregated daily metrics for dashboards and reporting';

CREATE INDEX IF NOT EXISTS idx_analytics_daily_date
    ON analytics_daily (date);

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_analytics_daily_updated_at
    BEFORE UPDATE ON analytics_daily
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 4. SEARCH FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION search_knowledge(
    query_embedding vector(768),
    query_text      TEXT,
    p_tier          INT     DEFAULT NULL,
    p_category      VARCHAR DEFAULT NULL,
    p_limit         INT     DEFAULT 5
)
RETURNS TABLE (
    id               UUID,
    tier             INT,
    question         TEXT,
    answer           TEXT,
    category         VARCHAR(100),
    tags             TEXT[],
    confidence_score FLOAT,
    usage_count      INT,
    similarity       FLOAT,
    text_similarity  FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb.id,
        kb.tier,
        kb.question,
        kb.answer,
        kb.category,
        kb.tags,
        kb.confidence_score,
        kb.usage_count,
        -- Cosine similarity (1 - cosine distance); NULL when no embedding provided
        CASE
            WHEN query_embedding IS NOT NULL AND kb.embedding IS NOT NULL
            THEN 1 - (kb.embedding <=> query_embedding)
            ELSE NULL
        END::FLOAT AS similarity,
        -- Trigram similarity for fuzzy text matching
        CASE
            WHEN query_text IS NOT NULL AND query_text <> ''
            THEN similarity(kb.question, query_text)
            ELSE NULL
        END::FLOAT AS text_similarity
    FROM knowledge_base kb
    WHERE kb.is_active = TRUE
      AND (p_tier     IS NULL OR kb.tier     = p_tier)
      AND (p_category IS NULL OR kb.category = p_category)
    ORDER BY
        -- Primary sort: vector similarity (descending, NULLs last)
        CASE
            WHEN query_embedding IS NOT NULL AND kb.embedding IS NOT NULL
            THEN 1 - (kb.embedding <=> query_embedding)
            ELSE 0
        END DESC,
        -- Secondary sort: text similarity (descending)
        CASE
            WHEN query_text IS NOT NULL AND query_text <> ''
            THEN similarity(kb.question, query_text)
            ELSE 0
        END DESC,
        -- Tertiary sort: higher confidence first
        kb.confidence_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION search_knowledge IS 'Hybrid search combining vector cosine similarity and trigram text similarity';

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on knowledge_base
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

-- Policy: all authenticated users can read active knowledge
CREATE POLICY knowledge_base_select_policy
    ON knowledge_base
    FOR SELECT
    USING (true);

-- Policy: only users with the 'admin' role can insert
CREATE POLICY knowledge_base_insert_policy
    ON knowledge_base
    FOR INSERT
    WITH CHECK (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    );

-- Policy: only users with the 'admin' role can update
CREATE POLICY knowledge_base_update_policy
    ON knowledge_base
    FOR UPDATE
    USING (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    )
    WITH CHECK (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    );

-- Policy: only users with the 'admin' role can delete
CREATE POLICY knowledge_base_delete_policy
    ON knowledge_base
    FOR DELETE
    USING (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'admin'
    );

-- ============================================================================
-- 6. SEED DATA
-- ============================================================================

-- --------------------------------------------------------------------------
-- 6-1. app_config defaults
-- --------------------------------------------------------------------------
INSERT INTO app_config (key, value, category, description, updated_by) VALUES

-- General settings
('app.name', '"AI_Chat"'::jsonb, 'general',
 'Application display name', 'system'),

('app.version', '"1.0.0"'::jsonb, 'general',
 'Current application version', 'system'),

('app.debug_mode', 'false'::jsonb, 'general',
 'Enable debug logging', 'system'),

-- AI model configuration
('ai.default_model', '"gemini"'::jsonb, 'ai',
 'Default AI model to use (gemini | claude)', 'system'),

('ai.gemini.model_name', '"gemini-2.0-flash"'::jsonb, 'ai',
 'Gemini model identifier', 'system'),

('ai.gemini.temperature', '0.7'::jsonb, 'ai',
 'Gemini sampling temperature', 'system'),

('ai.gemini.max_tokens', '2048'::jsonb, 'ai',
 'Gemini maximum output tokens', 'system'),

('ai.claude.model_name', '"claude-sonnet-4-20250514"'::jsonb, 'ai',
 'Claude model identifier', 'system'),

('ai.claude.temperature', '0.7'::jsonb, 'ai',
 'Claude sampling temperature', 'system'),

('ai.claude.max_tokens', '2048'::jsonb, 'ai',
 'Claude maximum output tokens', 'system'),

('ai.fallback_enabled', 'true'::jsonb, 'ai',
 'Enable automatic fallback to secondary model on failure', 'system'),

-- Knowledge search settings
('knowledge.search.default_limit', '5'::jsonb, 'knowledge',
 'Default number of results for knowledge search', 'system'),

('knowledge.search.similarity_threshold', '0.7'::jsonb, 'knowledge',
 'Minimum cosine similarity to consider a match', 'system'),

('knowledge.search.text_similarity_threshold', '0.3'::jsonb, 'knowledge',
 'Minimum trigram similarity for text fallback', 'system'),

-- Response settings
('response.max_length', '2000'::jsonb, 'response',
 'Maximum character length for bot responses', 'system'),

('response.escalation_threshold', '0.4'::jsonb, 'response',
 'Confidence below which the bot escalates to a human', 'system'),

('response.greeting_enabled', 'true'::jsonb, 'response',
 'Whether the bot sends greeting messages to new rooms', 'system'),

-- Queue settings
('queue.max_retries', '3'::jsonb, 'queue',
 'Maximum retry attempts for failed queue messages', 'system'),

('queue.retry_delay_ms', '5000'::jsonb, 'queue',
 'Delay between retry attempts in milliseconds', 'system'),

('queue.processing_timeout_ms', '30000'::jsonb, 'queue',
 'Maximum time a message can stay in processing state', 'system')

ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------------------
-- 6-2. prompt_templates defaults
-- --------------------------------------------------------------------------
INSERT INTO prompt_templates (name, template, version, variables, category, description, is_active, created_by) VALUES

(
    'default_answer',
    E'You are a helpful customer-support AI assistant.\n\nContext (retrieved knowledge):\n{{context}}\n\nConversation history:\n{{history}}\n\nUser question:\n{{question}}\n\nInstructions:\n- Answer the question based ONLY on the provided context.\n- If the context does not contain enough information, say so honestly.\n- Keep your answer concise and professional.\n- Reply in the same language the user used.',
    1,
    '["context", "history", "question"]'::jsonb,
    'answer',
    'Default prompt for answering user questions with retrieved knowledge context',
    TRUE,
    'system'
),

(
    'greeting',
    E'You are a friendly AI assistant joining a new chat room.\n\nRoom ID: {{room_id}}\nMembers: {{members}}\n\nGenerate a brief, professional greeting introducing yourself.\nKeep it under 3 sentences. Reply in Korean.',
    1,
    '["room_id", "members"]'::jsonb,
    'system',
    'Greeting message when the bot joins a new room',
    TRUE,
    'system'
),

(
    'escalation_notice',
    E'The AI assistant could not confidently answer the following question.\n\nUser: {{user_name}}\nRoom: {{room_id}}\nQuestion: {{question}}\nBest match confidence: {{confidence}}\n\nPlease provide a human response at your earliest convenience.',
    1,
    '["user_name", "room_id", "question", "confidence"]'::jsonb,
    'system',
    'Notification template when a question is escalated to a human',
    TRUE,
    'system'
),

(
    'knowledge_extraction',
    E'Analyze the following conversation and extract any new knowledge that should be stored.\n\nConversation:\n{{conversation}}\n\nFor each piece of knowledge, provide:\n- question: a clear question it answers\n- answer: the factual answer\n- category: a short category label\n- tags: relevant tags as a list\n\nReturn the result as a JSON array. If there is nothing worth extracting, return an empty array [].',
    1,
    '["conversation"]'::jsonb,
    'extraction',
    'Extract structured knowledge from raw conversation logs',
    TRUE,
    'system'
),

(
    'role_detection',
    E'Based on the following message and user information, determine the role of this user.\n\nUser ID: {{user_id}}\nUser Name: {{user_name}}\nMessage: {{message}}\nRoom context: {{room_context}}\n\nPossible roles: advertiser, company_staff, partner, unknown\n\nRespond with a JSON object: {"role": "<role>", "confidence": <0.0-1.0>, "reason": "<explanation>"}',
    1,
    '["user_id", "user_name", "message", "room_context"]'::jsonb,
    'classification',
    'Detect the role of a user from their message context',
    TRUE,
    'system'
),

(
    'summarize_conversation',
    E'Summarize the following conversation concisely.\n\nConversation:\n{{conversation}}\n\nProvide:\n1. A one-line summary\n2. Key topics discussed\n3. Any action items or unresolved questions\n\nReply in the same language as the conversation.',
    1,
    '["conversation"]'::jsonb,
    'utility',
    'Summarize a conversation for logging or review purposes',
    TRUE,
    'system'
)

ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- 6-3. escalations
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalations (
    id               BIGSERIAL       PRIMARY KEY,
    conversation_id  BIGINT          REFERENCES conversations(id),
    room_id          VARCHAR(100)    NOT NULL,
    user_id          VARCHAR(100)    NOT NULL,
    user_name        VARCHAR(100),
    user_message     TEXT            NOT NULL,
    bot_response     TEXT,
    category         VARCHAR(100),
    confidence       FLOAT,
    status           VARCHAR(20)     NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'assigned', 'answered', 'learned', 'dismissed')),
    assigned_to      INT             REFERENCES company_staff(id),
    assigned_at      TIMESTAMPTZ,
    answer           TEXT,
    answered_by      VARCHAR(100),
    answered_at      TIMESTAMPTZ,
    knowledge_id     UUID            REFERENCES knowledge_base(id),
    replied_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE escalations IS 'Tracks questions the bot could not answer, pending human review';

CREATE INDEX IF NOT EXISTS idx_escalations_status
    ON escalations (status);

CREATE INDEX IF NOT EXISTS idx_escalations_category
    ON escalations (category);

CREATE INDEX IF NOT EXISTS idx_escalations_assigned_to
    ON escalations (assigned_to);

CREATE INDEX IF NOT EXISTS idx_escalations_created_at
    ON escalations (created_at);

-- --------------------------------------------------------------------------
-- 6-4. category_assignees
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS category_assignees (
    id          SERIAL          PRIMARY KEY,
    category    VARCHAR(100)    NOT NULL UNIQUE,
    staff_id    INT             NOT NULL REFERENCES company_staff(id),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE category_assignees IS 'Maps knowledge categories to responsible staff members';

CREATE TRIGGER trg_category_assignees_updated_at
    BEFORE UPDATE ON category_assignees
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- 6-5. room_blocks (해지요청 등으로 봇 응답 차단된 방)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_blocks (
    id          BIGSERIAL       PRIMARY KEY,
    room_id     VARCHAR(100)    NOT NULL,
    user_name   VARCHAR(100),
    reason      VARCHAR(200)    NOT NULL DEFAULT '해지요청',
    blocked_by  VARCHAR(100),
    blocked_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    unblocked_at TIMESTAMPTZ,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_room_blocks_active UNIQUE (room_id, is_active)
);

COMMENT ON TABLE room_blocks IS 'Rooms blocked from bot responses (e.g. service cancellation requests)';

CREATE INDEX IF NOT EXISTS idx_room_blocks_room_id
    ON room_blocks (room_id);

CREATE INDEX IF NOT EXISTS idx_room_blocks_is_active
    ON room_blocks (is_active);

-- --------------------------------------------------------------------------
-- 6-6. proactive_messages (자동 문안인사 대기열)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proactive_messages (
    id              BIGSERIAL       PRIMARY KEY,
    room_id         VARCHAR(100)    NOT NULL,
    user_name       VARCHAR(100),
    message         TEXT            NOT NULL,
    message_type    VARCHAR(50)     NOT NULL DEFAULT 'greeting'
                    CHECK (message_type IN ('greeting', 'follow_up', 'announcement')),
    status          VARCHAR(20)     NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    scheduled_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    last_activity   TIMESTAMPTZ,
    inactive_days   INT,
    attempts        INT             NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE proactive_messages IS 'Queued proactive messages (greetings for inactive rooms)';

CREATE INDEX IF NOT EXISTS idx_proactive_messages_status
    ON proactive_messages (status);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_room_id
    ON proactive_messages (room_id);

CREATE INDEX IF NOT EXISTS idx_proactive_messages_scheduled_at
    ON proactive_messages (scheduled_at);

-- ============================================================================
-- 7. AI PERFECTION MIGRATION (2026-02-21)
-- ============================================================================

-- 7-1. knowledge_base 확장 (질문 변형 + 검증 시스템)
ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS parent_knowledge_id UUID REFERENCES knowledge_base(id),
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS ai_interpretation TEXT,
  ADD COLUMN IF NOT EXISTS verified_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_kb_parent ON knowledge_base(parent_knowledge_id);
CREATE INDEX IF NOT EXISTS idx_kb_verification ON knowledge_base(verification_status);

-- 7-2. uncertainty_topics (불확실 주제 추적)
CREATE TABLE IF NOT EXISTS uncertainty_topics (
    id               BIGSERIAL PRIMARY KEY,
    topic            TEXT NOT NULL,
    category         VARCHAR(100),
    sample_question  TEXT,
    source           VARCHAR(50) NOT NULL DEFAULT 'low_similarity'
                     CHECK (source IN ('low_similarity', 'hedging', 'new_topic', 'repeated_escalation', 'confidence_decay')),
    occurrence_count INT NOT NULL DEFAULT 1,
    avg_similarity   FLOAT,
    status           VARCHAR(20) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'addressed', 'dismissed')),
    resolved_knowledge_id UUID REFERENCES knowledge_base(id),
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ
);

COMMENT ON TABLE uncertainty_topics IS 'AI가 불확실한 주제를 실시간 추적. 관리자가 해결 가능';

CREATE INDEX IF NOT EXISTS idx_uncertainty_status ON uncertainty_topics(status);
CREATE INDEX IF NOT EXISTS idx_uncertainty_category ON uncertainty_topics(category);
CREATE INDEX IF NOT EXISTS idx_uncertainty_last_seen ON uncertainty_topics(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_uncertainty_occurrence ON uncertainty_topics(occurrence_count DESC);

-- pg_trgm index for similarity matching on uncertainty topics
CREATE INDEX IF NOT EXISTS idx_uncertainty_topic_trgm
    ON uncertainty_topics USING gin (topic gin_trgm_ops);

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================

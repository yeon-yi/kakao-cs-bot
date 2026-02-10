# 데이터베이스 스키마 전체

## Supabase PostgreSQL

### Extensions
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 1. knowledge_base (지식 베이스)

**목적**: 3-Tier 지식 저장 및 벡터 검색
```sql
CREATE TABLE knowledge_base (
    -- PK
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Tier (1:공식, 2:학습, 3:대화)
    tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
    
    -- 내용
    question TEXT NOT NULL,
    answer TEXT,
    category VARCHAR(100),
    
    -- 벡터 (768차원 - ko-sroberta)
    embedding vector(768),
    
    -- 메타데이터
    source VARCHAR(500),
    taught_by VARCHAR(100),
    tags TEXT[],
    notes TEXT,
    
    -- 통계
    usage_count INTEGER DEFAULT 0,
    confidence_score FLOAT DEFAULT 1.0,
    
    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    
    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 인덱스
    CONSTRAINT valid_tier CHECK (tier BETWEEN 1 AND 3),
    CONSTRAINT valid_confidence CHECK (confidence_score BETWEEN 0 AND 1)
);

-- HNSW 벡터 인덱스 (빠른 검색)
CREATE INDEX idx_knowledge_embedding 
ON knowledge_base 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 일반 인덱스
CREATE INDEX idx_knowledge_tier ON knowledge_base(tier);
CREATE INDEX idx_knowledge_category ON knowledge_base(category);
CREATE INDEX idx_knowledge_active ON knowledge_base(is_active);
CREATE INDEX idx_knowledge_usage ON knowledge_base(usage_count DESC);

-- 전문 검색 인덱스
CREATE INDEX idx_knowledge_question_trgm 
ON knowledge_base 
USING gin (question gin_trgm_ops);

-- GIN 인덱스 (태그 검색)
CREATE INDEX idx_knowledge_tags ON knowledge_base USING gin(tags);

-- 자동 updated_at 갱신
CREATE TRIGGER update_knowledge_updated_at
    BEFORE UPDATE ON knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**함수: 지식 검색**
```sql
CREATE OR REPLACE FUNCTION search_knowledge(
    query_embedding vector(768),
    query_text TEXT,
    p_tier INTEGER DEFAULT NULL,
    p_category VARCHAR DEFAULT NULL,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    id UUID,
    question TEXT,
    answer TEXT,
    category VARCHAR,
    similarity FLOAT,
    tier INTEGER,
    source VARCHAR,
    usage_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        kb.id,
        kb.question,
        kb.answer,
        kb.category,
        1 - (kb.embedding <=> query_embedding) AS similarity,
        kb.tier,
        kb.source,
        kb.usage_count
    FROM knowledge_base kb
    WHERE 
        kb.is_active = TRUE
        AND (p_tier IS NULL OR kb.tier = p_tier)
        AND (p_category IS NULL OR kb.category = p_category)
        AND (
            -- 벡터 유사도 또는 텍스트 검색
            kb.embedding <=> query_embedding < 0.5
            OR
            kb.question % query_text  -- pg_trgm 유사도
        )
    ORDER BY 
        kb.tier ASC,  -- Tier 우선순위
        similarity DESC,
        kb.usage_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

### 2. knowledge_history (지식 변경 이력)

**목적**: 감사 추적, 롤백 지원
```sql
CREATE TABLE knowledge_history (
    id BIGSERIAL PRIMARY KEY,
    knowledge_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
    
    -- 변경 내용
    action VARCHAR(50) NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE')),
    previous_question TEXT,
    previous_answer TEXT,
    new_question TEXT,
    new_answer TEXT,
    
    -- 이유
    change_reason TEXT,
    
    -- 누가
    changed_by VARCHAR(100) NOT NULL,
    
    -- 언제
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_history_knowledge ON knowledge_history(knowledge_id);
CREATE INDEX idx_history_changed_at ON knowledge_history(changed_at DESC);
CREATE INDEX idx_history_changed_by ON knowledge_history(changed_by);
```

### 3. conversations (대화 이력)

**목적**: 대화 기록, 학습 데이터, 맥락 참조
```sql
CREATE TABLE conversations (
    id BIGSERIAL PRIMARY KEY,
    
    -- 위치
    room_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(100),
    
    -- 메시지
    user_message TEXT NOT NULL,
    bot_response TEXT,
    
    -- 맥락
    context JSONB DEFAULT '{}',
    
    -- 처리 정보
    knowledge_tier INTEGER,  -- 어느 Tier로 답변했는지
    ai_model VARCHAR(50),    -- 어느 모델 사용했는지
    confidence FLOAT,
    was_helpful BOOLEAN,
    
    -- 통계
    response_time_ms INTEGER,
    
    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 파티셔닝 (월별)
CREATE TABLE conversations_y2025m01 PARTITION OF conversations
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- 인덱스
CREATE INDEX idx_conversations_room_user 
ON conversations(room_id, user_id, created_at DESC);

CREATE INDEX idx_conversations_created 
ON conversations(created_at DESC);

-- JSONB 인덱스
CREATE INDEX idx_conversations_context 
ON conversations USING gin(context);
```

### 4. room_members (방 멤버 정보)

**목적**: 신원 확인, 역할 관리
```sql
CREATE TABLE room_members (
    id BIGSERIAL PRIMARY KEY,
    
    -- 방/사용자
    room_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(100),
    
    -- 역할
    role VARCHAR(50) NOT NULL CHECK (role IN ('advertiser', 'company_staff', 'bot', 'partner', 'unknown')),
    
    -- 확인 정보
    confirmed_by VARCHAR(100),
    confidence FLOAT DEFAULT 0.5,
    
    -- 타임스탬프
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 유니크 제약
    UNIQUE(room_id, user_id)
);

CREATE INDEX idx_room_members_room ON room_members(room_id);
CREATE INDEX idx_room_members_user ON room_members(user_id);
CREATE INDEX idx_room_members_role ON room_members(role);
```

### 5. company_staff (직원 마스터)

**목적**: 화이트리스트, 신원 확인
```sql
CREATE TABLE company_staff (
    id SERIAL PRIMARY KEY,
    
    -- 카카오 정보
    kakao_user_id VARCHAR(100) UNIQUE,
    kakao_name VARCHAR(100),
    
    -- 실제 정보
    real_name VARCHAR(100) NOT NULL,
    email VARCHAR(200) UNIQUE,
    phone VARCHAR(20),
    
    -- 조직
    department VARCHAR(100),
    position VARCHAR(100),
    
    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    
    -- 타임스탬프
    added_at TIMESTAMPTZ DEFAULT NOW(),
    added_by VARCHAR(100)
);

CREATE INDEX idx_staff_kakao_id ON company_staff(kakao_user_id);
CREATE INDEX idx_staff_email ON company_staff(email);
CREATE INDEX idx_staff_active ON company_staff(is_active);
```

### 6. staff_aliases (직원 별칭)

**목적**: 여러 닉네임 매핑
```sql
CREATE TABLE staff_aliases (
    id SERIAL PRIMARY KEY,
    staff_id INTEGER REFERENCES company_staff(id) ON DELETE CASCADE,
    
    alias VARCHAR(100) NOT NULL,
    platform VARCHAR(50) DEFAULT 'kakao',
    
    UNIQUE(alias, platform)
);

CREATE INDEX idx_aliases_staff ON staff_aliases(staff_id);
CREATE INDEX idx_aliases_alias ON staff_aliases(alias);
```

### 7. message_queue (메시지 큐)

**목적**: Redis Streams 백업, 장애 복구
```sql
CREATE TABLE message_queue (
    id VARCHAR(100) PRIMARY KEY,
    
    -- 메시지 내용
    data JSONB NOT NULL,
    
    -- 상태
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    
    -- 처리 정보
    assigned_to VARCHAR(100),  -- 어느 봇이 처리 중인지
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    
    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processing_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_queue_status ON message_queue(status, priority, created_at);
CREATE INDEX idx_queue_assigned ON message_queue(assigned_to);
```

### 8. app_config (애플리케이션 설정)

**목적**: 동적 설정, Feature Flags
```sql
CREATE TABLE app_config (
    key VARCHAR(200) PRIMARY KEY,
    value JSONB NOT NULL,
    
    -- 메타데이터
    category VARCHAR(100),
    description TEXT,
    
    -- 변경 추적
    updated_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 예시 데이터
INSERT INTO app_config (key, value, category) VALUES
('ai_temperature', '0.2', 'ai'),
('use_pro_for_staff', 'true', 'ai'),
('max_retry_attempts', '3', 'reliability'),
('response_timeout_ms', '30000', 'performance');
```

### 9. prompt_templates (프롬프트 관리)

**목적**: 프롬프트 버전 관리
```sql
CREATE TABLE prompt_templates (
    id SERIAL PRIMARY KEY,
    
    -- 식별자
    name VARCHAR(200) UNIQUE NOT NULL,
    
    -- 내용
    template TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    
    -- 변수 정의
    variables JSONB DEFAULT '[]',
    
    -- 메타데이터
    category VARCHAR(100),
    description TEXT,
    
    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    
    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(100)
);

CREATE INDEX idx_prompts_name ON prompt_templates(name);
CREATE INDEX idx_prompts_active ON prompt_templates(is_active);
```

### 10. prompt_history (프롬프트 변경 이력)
```sql
CREATE TABLE prompt_history (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES prompt_templates(id) ON DELETE CASCADE,
    
    version INTEGER NOT NULL,
    template TEXT NOT NULL,
    
    -- 변경 정보
    change_reason TEXT,
    changed_by VARCHAR(100),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 11. analytics_daily (일일 통계)

**목적**: 대시보드, 리포트
```sql
CREATE TABLE analytics_daily (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    
    -- 메시지 통계
    total_messages INTEGER DEFAULT 0,
    auto_responses INTEGER DEFAULT 0,
    admin_escalations INTEGER DEFAULT 0,
    
    -- 성능
    avg_response_time_ms INTEGER,
    p95_response_time_ms INTEGER,
    
    -- AI 사용
    gemini_calls INTEGER DEFAULT 0,
    claude_calls INTEGER DEFAULT 0,
    total_ai_cost DECIMAL(10,4) DEFAULT 0,
    
    -- 정확도
    helpful_count INTEGER DEFAULT 0,
    not_helpful_count INTEGER DEFAULT 0,
    
    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_date ON analytics_daily(date DESC);
```

## Row Level Security (RLS)
```sql
-- knowledge_base: 모든 사용자 읽기, 관리자만 쓰기
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active knowledge"
    ON knowledge_base FOR SELECT
    USING (is_active = TRUE);

CREATE POLICY "Admins can insert knowledge"
    ON knowledge_base FOR INSERT
    WITH CHECK (auth.role() = 'admin');

CREATE POLICY "Admins can update knowledge"
    ON knowledge_base FOR UPDATE
    USING (auth.role() = 'admin');
```

## Functions

### update_updated_at_column()
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### increment_usage_count()
```sql
CREATE OR REPLACE FUNCTION increment_usage_count(knowledge_uuid UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE knowledge_base
    SET usage_count = usage_count + 1
    WHERE id = knowledge_uuid;
END;
$$ LANGUAGE plpgsql;
```
# 시스템 아키텍처 전체 설계

## 핵심 원칙
- Type Safety First (TypeScript 100%)
- Zero Downtime Deployment
- Graceful Degradation
- Observability by Default
- 12 Factor App 준수

## 기술 스택

### Frontend
- **Framework**: Next.js 15 (App Router)
- **State**: TanStack Query v5
- **Forms**: React Hook Form + Zod
- **UI**: shadcn/ui + Tailwind CSS
- **Charts**: Recharts

### Backend
- **Runtime**: Bun v1.1+
- **API**: tRPC v11
- **Web Framework**: Hono v4 (Edge)
- **Validation**: Zod

### Database
- **Primary**: Supabase (PostgreSQL 15 + pgvector)
- **Cache**: Upstash Redis
- **Queue**: Redis Streams

### AI/ML
- **Gateway**: LiteLLM
- **Models**: Gemini Flash/Pro, Claude Haiku/Sonnet (fallback)
- **Embeddings**: sentence-transformers (jhgan/ko-sroberta-multitask)

### Infrastructure
- **Container**: Docker + Kubernetes
- **CD**: ArgoCD
- **Edge**: Cloudflare Workers
- **Monitoring**: Datadog + Sentry

## 데이터 플로우
```
[카카오톡] 
    ↓ webhook/polling
[Edge Functions] ← 빠른 패턴 매칭 (10ms)
    ↓ cache miss
[API Gateway (tRPC)]
    ↓
[Redis Queue] → [Worker Pool]
    ├─ Coordinator Agent (조정)
    ├─ Message Agent (처리)
    ├─ Knowledge Agent (검색)
    ├─ Learning Agent (학습)
    └─ Identity Agent (신원)
    ↓
[Supabase]
    ├─ pgvector (벡터 검색)
    ├─ RLS (보안)
    └─ Real-time (구독)
```

## 멀티 에이전트 아키텍처

### Coordinator Agent
**역할**: 전체 워크플로우 조정
**책임**:
- 메시지 라우팅
- 에이전트 간 통신
- 장애 감지 및 복구
- 부하 분산

**구현 요구사항**:
```typescript
class CoordinatorAgent {
  // 메시지 수신
  async onMessage(msg: KakaoMessage): Promise<void>
  
  // 에이전트에게 작업 할당
  async assignTask(task: Task, agent: AgentType): Promise<void>
  
  // 작업 상태 추적
  async trackTaskStatus(taskId: string): Promise<TaskStatus>
  
  // 에이전트 헬스체크
  async checkAgentHealth(): Promise<HealthStatus[]>
  
  // 장애 복구
  async recoverFromFailure(agentId: string): Promise<void>
}
```

### Message Agent
**역할**: 실제 메시지 처리
**책임**:
- 맥락 분석 요청
- 지식 검색 요청
- 답변 생성
- 사람다운 타이밍 적용
- 응답 전송

**상태 머신**:
```
IDLE → READING → THINKING → SEARCHING → GENERATING → TYPING → SENDING → IDLE
```

**에러 처리**:
- 맥락 분석 실패 → 안전하게 개입 안함
- 지식 검색 실패 → 관리자에게 에스컬레이션
- AI 생성 실패 → Fallback 답변 (3단계)
- 전송 실패 → 재시도 (Exponential Backoff)

### Knowledge Agent
**역할**: 지식 검색 및 관리
**책임**:
- 3-Tier 지식 검색 (공식 > 학습 > 대화)
- 벡터 유사도 계산
- 컨텍스트 조합
- 사용 통계 업데이트

**검색 알고리즘**:
```
1. 질문 임베딩 생성 (768차원)
2. pgvector HNSW 인덱스 검색
3. Tier 1 (공식): distance < 0.5, top 5
4. Tier 1 충분하면 (relevance > 0.7) 종료
5. 아니면 Tier 2 (학습): distance < 0.4, top 5
6. Tier 2 충분하면 종료
7. 아니면 Tier 3 (대화): distance < 0.35, top 3
8. 결과 없으면 NOT_FOUND
```

### Learning Agent
**역할**: 지속적 학습
**책임**:
- 대화 패턴 저장
- 중요 대화 식별
- 관리자 피드백 반영
- 프롬프트 최적화

**중요도 점수 계산**:
```typescript
importance = 
  (newKnowledgeLearned ? 5 : 0) +
  (adminAnswered ? 4 : 0) +
  (complexityScore * 2) +
  (hasComplaint ? 3 : 0) +
  (uniquePattern ? 2 : 0)

if (importance >= 3) → 장기 메모리 저장
```

### Identity Agent
**역할**: 사용자 신원 확인
**책임**:
- 화이트리스트 조회
- 닉네임 패턴 분석
- 행동 패턴 학습
- 관리자 확인 요청

**신원 확인 우선순위**:
```
1. 화이트리스트 (DB) → confidence: 1.0
2. 닉네임 패턴 (정규식) → confidence: 0.85
3. 프로필 분석 (상태메시지) → confidence: 0.65
4. 행동 패턴 (AI) → confidence: 0.75
5. 불명 → 관리자 확인
```

## 에러 핸들링 전략

### 레벨별 처리

**Level 1: Recoverable (복구 가능)**
- 네트워크 타임아웃 → Retry (3회, exponential backoff)
- API Rate Limit → Queue에 재삽입
- 일시적 DB 락 → 100ms 대기 후 재시도

**Level 2: Degraded (성능 저하)**
- Primary LLM 실패 → Fallback LLM
- 벡터 검색 느림 → 텍스트 검색으로 대체
- Redis 다운 → In-memory cache

**Level 3: Critical (치명적)**
- DB 완전 다운 → Read-only 모드
- 모든 LLM 실패 → 미리 정의된 답변
- Coordinator 다운 → 다른 인스턴스가 Leader 선출

### 에러 로깅 구조
```typescript
interface ErrorLog {
  level: 'info' | 'warn' | 'error' | 'fatal';
  timestamp: string;
  agentId: string;
  agentType: AgentType;
  errorCode: string;
  message: string;
  context: {
    userId?: string;
    roomId?: string;
    messageId?: string;
    taskId?: string;
  };
  stack?: string;
  metadata?: Record<string, any>;
}
```

## 성능 요구사항

### 응답 시간 (p95)
- Edge Cache Hit: < 50ms
- 간단한 질문: < 500ms
- 복잡한 질문: < 2000ms
- 학습 필요: < 30000ms (관리자 대기)

### 처리량
- 메시지 처리: 100 msg/s
- 벡터 검색: 500 qps
- AI 호출: 50 req/s

### 가용성
- API: 99.9% (월 43분 다운타임)
- 봇: 99.5% (월 3.6시간)
- DB: 99.95% (Supabase SLA)

## 보안 요구사항

### 데이터 보호
- 민감정보 자동 마스킹 (전화번호, 주민번호, 카드번호)
- 로그에 민감정보 저장 금지
- 개인정보 30일 후 자동 삭제
- 암호화: 저장 시(AES-256), 전송 시(TLS 1.3)

### 인증/인가
- 관리자 대시보드: JWT + RBAC
- API: API Key + Rate Limiting
- Inter-service: mTLS

### 감사 로그
- 모든 지식 추가/수정/삭제
- 설정 변경
- 관리자 액션
- 개인정보 접근

## 모니터링 지표

### Golden Signals
1. **Latency**: 응답 시간 분포
2. **Traffic**: 초당 메시지 수
3. **Errors**: 에러율 (%)
4. **Saturation**: CPU/Memory 사용률

### Business Metrics
- 일일 활성 사용자 (DAU)
- 답변 정확도 (관리자 피드백)
- 자동 응답률 (관리자 개입 없음)
- 평균 응답 시간
- AI 비용 ($/1000 메시지)

### Alerts
- 에러율 > 5% (5분간)
- 응답시간 p95 > 3초
- AI 비용 > $100/일
- 디스크 사용률 > 80%
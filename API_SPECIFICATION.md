# tRPC API 전체 스펙

## 라우터 구조
```typescript
AppRouter
├── knowledge
│   ├── search (query)
│   ├── get (query)
│   ├── add (mutation)
│   ├── update (mutation)
│   ├── delete (mutation)
│   └── import (mutation)
├── context
│   ├── analyze (query)
│   ├── analyzeStaff (query)
│   └── getHistory (query)
├── identity
│   ├── identify (query)
│   ├── register (mutation)
│   └── confirm (mutation)
├── prompts
│   ├── get (query)
│   ├── list (query)
│   ├── update (mutation)
│   └── startExperiment (mutation)
├── config
│   ├── get (query)
│   ├── list (query)
│   └── update (mutation)
├── analytics
│   ├── daily (query)
│   ├── realtime (subscription)
│   └── export (mutation)
└── messages
    ├── subscribe (subscription)
    └── send (mutation)
```

## 1. knowledge Router

### search
```typescript
input: {
  question: string;
  tier?: 1 | 2 | 3;
  category?: string;
  limit?: number; // default: 5
}

output: {
  results: Array<{
    id: string;
    question: string;
    answer: string;
    similarity: number;
    tier: number;
    source: string;
    usageCount: number;
  }>;
  totalFound: number;
  searchTime: number; // ms
}

// 에러
- InvalidInputError: 질문이 비어있음
- DatabaseError: DB 연결 실패
```

### add
```typescript
input: {
  question: string;
  answer: string;
  category: string;
  tier?: number; // default: 2
  taughtBy: string;
  tags?: string[];
  notes?: string;
}

output: {
  success: boolean;
  id: string;
  message: string;
}

// 유효성 검증
- question: 최소 5자, 최대 500자
- answer: 최소 10자, 최대 2000자
- category: 필수
- tier: 1, 2, 3 중 하나

// 에러
- ValidationError: 입력값 검증 실패
- DuplicateError: 동일한 질문 존재 (similarity > 0.95)
- EmbeddingError: 임베딩 생성 실패
```

## 2. context Router

### analyze
```typescript
input: {
  message: string;
  senderId: string;
  senderRole: 'ADVERTISER' | 'STAFF' | 'UNKNOWN';
  roomId: string;
  history?: Array<{
    senderId: string;
    message: string;
    timestamp: number;
  }>;
  hasMention?: boolean;
  mentionTarget?: string;
}

output: {
  shouldRespond: boolean;
  confidence: number; // 0-1
  reason: string;
  target: 'TO_COMPANY' | 'TO_STAFF' | 'TO_ADVERTISER' | 'CHITCHAT' | 'STAFF_QUESTION';
  explanation: string;
  processingTime: number;
}

// 처리 로직
1. Quick filter (캐시 확인)
2. 발화자 역할 확인
3. 담당자면 특별 처리
   - 호칭어 감지
   - 업무 vs 회사 질문 구분
4. 광고주면 일반 처리
5. AI 분석 (복잡도에 따라 Flash/Pro)
6. 확신도 < 0.6이면 개입 안함

// 에러
- InvalidRoleError
- AIServiceError (Fallback to safe mode)
```

### analyzeStaff (담당자 메시지 전용)
```typescript
input: {
  message: string;
  senderId: string;
  roomId: string;
  history: Array<ConversationMessage>;
}

output: {
  messageType: 'TO_ADVERTISER' | 'TO_STAFF' | 'TO_COMPANY' | 'ANNOUNCEMENT';
  shouldBotRespond: boolean;
  confidence: number;
  detectedPatterns: string[]; // ['호칭어', '안내어투', etc]
}

// 패턴 감지
호칭어: '님', '씨', '고객님', '광고주님'
안내어투: '드립니다', '해드립니다', '부탁드립니다'
시스템질문: '시스템', '프로그램', '어디', '어떻게'
```

## 3. identity Router

### identify
```typescript
input: {
  kakaoUserId: string;
  kakaoName: string;
  roomId: string;
  profileImage?: string;
  statusMessage?: string;
  messageHistory?: string[]; // 최근 20개
}

output: {
  role: 'ADVERTISER' | 'COMPANY_STAFF' | 'PARTNER' | 'UNKNOWN';
  confidence: number;
  method: 'WHITELIST' | 'NICKNAME_PATTERN' | 'PROFILE_ANALYSIS' | 'BEHAVIOR_PATTERN' | 'UNKNOWN';
  shouldConfirm: boolean;
  explanation: string;
}

// 우선순위
1. 화이트리스트 (company_staff 테이블) → confidence: 1.0
2. 닉네임 패턴 (직급 키워드) → confidence: 0.85
3. 프로필 분석 → confidence: 0.65
4. 행동 패턴 (AI) → confidence: 0.75
5. 불명 → shouldConfirm: true
```

## 4. prompts Router

### get
```typescript
input: {
  name: string; // 'context_analysis_staff', 'answer_generation', etc
}

output: {
  id: number;
  name: string;
  template: string;
  version: number;
  variables: Array<{name: string; type: string; description: string}>;
  category: string;
  isActive: boolean;
}

// 캐싱: 10초 TTL
```

### update
```typescript
input: {
  name: string;
  template: string;
  reason: string;
  changedBy: string;
}

output: {
  success: boolean;
  newVersion: number;
  message: string;
}

// 부가 효과
1. 이전 버전 prompt_history에 저장
2. version 번호 증가
3. 캐시 무효화
4. Redis Pub/Sub로 다른 워커들에게 알림
```

## 5. config Router

### update
```typescript
input: {
  key: string;
  value: any; // JSON 직렬화 가능한 값
  reason?: string;
}

output: {
  success: boolean;
  message: string;
}

// 부가 효과
1. app_config 테이블 upsert
2. Redis Pub/Sub 'config:update' 채널에 발행
3. 모든 워커가 자동으로 새 설정 적용
4. 재시작 불필요
```

## 6. analytics Router

### daily
```typescript
input: {
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

output: {
  data: Array<{
    date: string;
    totalMessages: number;
    autoResponses: number;
    adminEscalations: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    aiCost: number;
    accuracy: number; // helpfulCount / total
  }>;
}
```

### realtime (WebSocket Subscription)
```typescript
output: Stream<{
  timestamp: number;
  messagesPerSecond: number;
  activeUsers: number;
  avgLatency: number;
  errorRate: number;
  aiCalls: {
    gemini: number;
    claude: number;
  };
}>

// 2초마다 업데이트
```

## Error Handling

### Error Types
```typescript
class AppError extends Error {
  code: string;
  statusCode: number;
  details?: any;
}

// 표준 에러
- ValidationError (400)
- UnauthorizedError (401)
- ForbiddenError (403)
- NotFoundError (404)
- ConflictError (409)
- RateLimitError (429)
- InternalError (500)
- ServiceUnavailableError (503)
```

### Error Response Format
```typescript
{
  error: {
    code: 'VALIDATION_ERROR',
    message: '입력값이 올바르지 않습니다',
    details: {
      field: 'question',
      issue: 'too_short'
    }
  }
}
```

## Rate Limiting
```typescript
// IP 기반
- 인증 없음: 100 req/min
- 인증 있음: 1000 req/min
- 관리자: 무제한

// 응답 헤더
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1234567890
```

## Authentication
```typescript
// JWT
{
  sub: 'user_id',
  role: 'admin' | 'user',
  exp: 1234567890
}

// Header
Authorization: Bearer <token>
```
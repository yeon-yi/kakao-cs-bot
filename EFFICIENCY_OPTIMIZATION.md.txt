# 효율 최적화 가이드

## 1. 개발 효율 (DX)

### Turborepo 설정
```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "type-check": {
      "dependsOn": ["^type-check"]
    }
  }
}
```

### 개발 서버 한 번에 시작
```bash
# scripts/dev/start-all.sh
#!/bin/bash

# Concurrently로 모든 서비스 동시 실행
bunx concurrently \
  --names "API,BOT,ADMIN,EDGE" \
  --prefix-colors "cyan,green,yellow,magenta" \
  "cd apps/api && bun dev" \
  "cd apps/bot && bun dev" \
  "cd apps/admin && bun dev" \
  "cd apps/edge && bun dev"
```

### Hot Reload 최적화
```typescript
// apps/api/src/server.ts
if (process.env.NODE_ENV === 'development') {
  // Bun 네이티브 핫 리로드
  const watcher = Bun.watch({
    paths: ['./src'],
    onEvent: async (event, path) => {
      if (event === 'change' && path.endsWith('.ts')) {
        console.log(`🔄 Reloading: ${path}`);
        // 모듈 캐시 클리어
        delete require.cache[require.resolve(path)];
      }
    },
  });
}
```

### VSCode 설정
```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  
  // 자동 정렬
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  
  // Tailwind 인텔리센스
  "tailwindCSS.experimental.classRegex": [
    ["cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]"],
    ["cn\\(([^)]*)\\)", "\"([^\"]*)\""]
  ],
  
  // 타입 힌트
  "typescript.inlayHints.parameterNames.enabled": "all",
  "typescript.inlayHints.variableTypes.enabled": true,
  
  // 경로 자동완성
  "path-autocomplete.pathMappings": {
    "@": "${folder}/src",
    "@packages": "${folder}/packages"
  }
}
```

### Git Hooks (Husky)
```json
// package.json
{
  "scripts": {
    "prepare": "husky install"
  }
}
```
```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Staged 파일만 린트
bunx lint-staged
```
```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md}": [
      "prettier --write"
    ]
  }
}
```

## 2. AI 효율 최적화

### 프롬프트 캐싱 (Gemini)
```typescript
// packages/ai/src/llm/gemini-cached.ts
import { GoogleGenerativeAI, CachedContent } from '@google/generative-ai';

class GeminiCachedClient {
  private genAI: GoogleGenerativeAI;
  private systemPromptCache: Map<string, CachedContent>;
  
  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.systemPromptCache = new Map();
  }
  
  /**
   * 시스템 프롬프트 캐싱 (비용 90% 절감)
   */
  async getCachedModel(
    systemPrompt: string,
    modelName: string = 'gemini-1.5-flash'
  ) {
    const cacheKey = this.hashPrompt(systemPrompt);
    
    // 캐시 확인
    let cached = this.systemPromptCache.get(cacheKey);
    
    if (!cached || this.isCacheExpired(cached)) {
      // 새 캐시 생성 (1시간 유효)
      cached = await CachedContent.create({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt }],
          },
        ],
        ttlSeconds: 3600,
        displayName: `system-prompt-${cacheKey}`,
      });
      
      this.systemPromptCache.set(cacheKey, cached);
      
      console.log(`✅ Created prompt cache: ${cacheKey}`);
    }
    
    // 캐시된 프롬프트로 모델 생성
    const model = this.genAI.getGenerativeModelFromCachedContent(cached);
    
    return model;
  }
  
  /**
   * 비용 계산
   */
  calculateCost(tokens: number, isCached: boolean): number {
    // Gemini Flash 가격 (2026)
    const PRICE_PER_1M_TOKENS = 0.075; // $0.075/1M
    const CACHED_DISCOUNT = 0.9; // 90% 할인
    
    const baseCost = (tokens / 1_000_000) * PRICE_PER_1M_TOKENS;
    
    if (isCached) {
      return baseCost * (1 - CACHED_DISCOUNT);
    }
    
    return baseCost;
  }
  
  private hashPrompt(prompt: string): string {
    return Bun.hash(prompt).toString(36).slice(0, 8);
  }
  
  private isCacheExpired(cached: CachedContent): boolean {
    const expireTime = new Date(cached.expireTime);
    return expireTime < new Date();
  }
}

// 사용 예시
const client = new GeminiCachedClient(process.env.GEMINI_API_KEY!);

// 시스템 프롬프트는 한 번만 전송 (캐시됨)
const model = await client.getCachedModel(`
당신은 광고 대행사 CS 담당자입니다.
...
(긴 시스템 프롬프트)
`);

// 이후 사용자 메시지만 전송 (90% 저렴)
const result = await model.generateContent('정산은 언제 되나요?');
```

**비용 비교**:
```
시스템 프롬프트: 2000 토큰
사용자 메시지: 100 토큰

캐싱 없음:
- 매번 2100 토큰 전송
- 7,500 호출 = 15,750,000 토큰
- 비용: $1.18/월

캐싱 사용:
- 첫 호출: 2100 토큰 (캐시 생성)
- 이후: 100 토큰만
- 7,500 호출 = 752,100 토큰
- 비용: $0.11/월

절감: 91% ($1.07/월)
```

### 응답 캐싱 (Redis)
```typescript
// packages/ai/src/cache/response-cache.ts
import { Redis } from 'ioredis';
import { createHash } from 'crypto';

class AIResponseCache {
  private redis: Redis;
  private TTL = 86400; // 24시간
  
  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }
  
  /**
   * 질문 정규화 (유사 질문 매칭)
   */
  private normalizeQuestion(question: string): string {
    return question
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[?!.,;]$/g, '');
  }
  
  /**
   * 캐시 키 생성
   */
  private getCacheKey(question: string): string {
    const normalized = this.normalizeQuestion(question);
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    return `ai:response:${hash}`;
  }
  
  /**
   * 캐시 조회
   */
  async get(question: string): Promise<string | null> {
    const key = this.getCacheKey(question);
    const cached = await this.redis.get(key);
    
    if (cached) {
      // 조회수 증가
      await this.redis.incr(`${key}:hits`);
      console.log(`✅ Cache hit: ${question}`);
    }
    
    return cached;
  }
  
  /**
   * 캐시 저장
   */
  async set(question: string, answer: string): Promise<void> {
    const key = this.getCacheKey(question);
    
    await this.redis.setex(key, this.TTL, answer);
    await this.redis.set(`${key}:hits`, 0, 'EX', this.TTL);
    await this.redis.set(`${key}:created`, Date.now(), 'EX', this.TTL);
  }
  
  /**
   * 유사 질문 찾기 (벡터 검색 전)
   */
  async findSimilar(question: string, threshold: number = 0.8): Promise<string | null> {
    // 간단한 패턴 매칭 (빠름)
    const patterns = [
      { pattern: /정산.*언제/, answer: '정산은 매월 10일에 입금됩니다.' },
      { pattern: /계약서.*어디/, answer: '계약서는 나의서비스관리 > 계약관리에서 확인하실 수 있습니다.' },
      { pattern: /영업.*시간/, answer: '영업시간은 평일 오전 9시 50분부터 오후 6시 30분까지입니다.' },
    ];
    
    for (const { pattern, answer } of patterns) {
      if (pattern.test(question)) {
        console.log(`✅ Pattern match: ${question}`);
        return answer;
      }
    }
    
    return null;
  }
  
  /**
   * 캐시 통계
   */
  async getStats(): Promise<CacheStats> {
    const keys = await this.redis.keys('ai:response:*:hits');
    
    let totalHits = 0;
    let totalQueries = keys.length;
    
    for (const key of keys) {
      const hits = await this.redis.get(key);
      totalHits += parseInt(hits || '0');
    }
    
    const hitRate = totalQueries > 0 ? totalHits / totalQueries : 0;
    
    return {
      totalQueries,
      totalHits,
      hitRate: Math.round(hitRate * 100) / 100,
      estimatedSavings: totalHits * 0.0001, // $0.0001 per AI call
    };
  }
}

// 사용
const cache = new AIResponseCache(process.env.REDIS_URL!);

async function getAnswer(question: string): Promise<string> {
  // 1. 패턴 매칭 (0ms, 무료)
  const pattern = await cache.findSimilar(question);
  if (pattern) return pattern;
  
  // 2. 캐시 확인 (1ms, 무료)
  const cached = await cache.get(question);
  if (cached) return cached;
  
  // 3. AI 호출 (500ms, $0.0001)
  const answer = await callAI(question);
  
  // 4. 캐시 저장
  await cache.set(question, answer);
  
  return answer;
}
```

### 배치 처리 (Batch API)
```typescript
// packages/ai/src/batch/batch-processor.ts

class BatchProcessor {
  private queue: BatchItem[] = [];
  private BATCH_SIZE = 10;
  private BATCH_TIMEOUT = 1000; // 1초
  private timer: NodeJS.Timeout | null = null;
  
  /**
   * 배치에 추가
   */
  async add(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ question, resolve, reject });
      
      // 배치 크기 도달하면 즉시 처리
      if (this.queue.length >= this.BATCH_SIZE) {
        this.flush();
      } else {
        // 타이머 설정 (1초 후 자동 처리)
        if (!this.timer) {
          this.timer = setTimeout(() => this.flush(), this.BATCH_TIMEOUT);
        }
      }
    });
  }
  
  /**
   * 배치 처리
   */
  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.BATCH_SIZE);
    
    try {
      // Gemini Batch API (50% 할인)
      const results = await this.callBatchAPI(
        batch.map(item => item.question)
      );
      
      // 결과 반환
      batch.forEach((item, index) => {
        item.resolve(results[index]);
      });
      
    } catch (error) {
      // 에러 시 개별 재시도
      batch.forEach(item => item.reject(error));
    }
  }
  
  private async callBatchAPI(questions: string[]): Promise<string[]> {
    // Gemini Batch API 호출
    // 실제 구현은 Gemini SDK 참고
    return questions.map(() => '답변');
  }
}
```

## 3. 데이터베이스 최적화

### pgvector 인덱스 튜닝
```sql
-- infra/k8s/database/tune-vector.sql

-- HNSW 인덱스 최적화
DROP INDEX IF EXISTS idx_knowledge_embedding;

CREATE INDEX idx_knowledge_embedding 
ON knowledge_base 
USING hnsw (embedding vector_cosine_ops)
WITH (
  m = 16,                -- 연결 수 (높을수록 정확, 느림)
  ef_construction = 64   -- 구축 시간 (높을수록 정확)
);

-- 검색 시 파라미터
SET hnsw.ef_search = 40;  -- 검색 범위 (높을수록 정확, 느림)

-- 통계 업데이트
ANALYZE knowledge_base;
```

### Connection Pooling
```typescript
// packages/database/src/supabase/pool.ts
import { createClient } from '@supabase/supabase-js';

class SupabasePool {
  private pools: Map<string, SupabaseClient>;
  private readonly POOL_SIZE = 10;
  
  constructor() {
    this.pools = new Map();
    
    // 풀 생성
    for (let i = 0; i < this.POOL_SIZE; i++) {
      const client = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_KEY!,
        {
          db: {
            schema: 'public',
          },
          auth: {
            persistSession: false,
          },
        }
      );
      
      this.pools.set(`client-${i}`, client);
    }
  }
  
  /**
   * 라운드 로빈으로 클라이언트 선택
   */
  getClient(): SupabaseClient {
    const index = Math.floor(Math.random() * this.POOL_SIZE);
    return this.pools.get(`client-${index}`)!;
  }
}

export const supabasePool = new SupabasePool();
```

### 쿼리 최적화
```typescript
// 🔴 느림 (N+1 문제)
for (const knowledge of knowledgeList) {
  const usage = await supabase
    .from('knowledge_usage')
    .select('*')
    .eq('knowledge_id', knowledge.id);
}

// 🟢 빠름 (JOIN)
const results = await supabase
  .from('knowledge_base')
  .select(`
    *,
    usage:knowledge_usage(*)
  `)
  .limit(100);
```

## 4. 운영 자동화

### 자동 백업
```bash
# scripts/ops/backup-daily.sh
#!/bin/bash

DATE=$(date +%Y%m%d)
BACKUP_DIR="/backups/${DATE}"

# Supabase 백업 (pg_dump)
pg_dump $DATABASE_URL | gzip > ${BACKUP_DIR}/db-${DATE}.sql.gz

# Redis 백업
redis-cli --rdb ${BACKUP_DIR}/redis-${DATE}.rdb

# 파일 백업 (지식 파일 등)
tar -czf ${BACKUP_DIR}/files-${DATE}.tar.gz /data

# GCS 업로드
gsutil cp -r ${BACKUP_DIR} gs://backups/daily/

# 30일 이상 된 백업 삭제
find /backups -mtime +30 -delete

echo "✅ Backup completed: ${DATE}"
```

### Cron 설정
```yaml
# infra/k8s/jobs/backup-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-backup
  namespace: kakao-cs-bot
spec:
  schedule: "0 2 * * *"  # 매일 02:00
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: backup
            image: backup-tool:latest
            env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: supabase
                  key: url
            command:
            - /bin/bash
            - /scripts/backup-daily.sh
          restartPolicy: OnFailure
```

### 모니터링 알림
```typescript
// packages/monitoring/src/alerts.ts

class AlertManager {
  private slack: WebhookClient;
  
  /**
   * 에러율 알림
   */
  async checkErrorRate(): Promise<void> {
    const errorRate = await this.getErrorRate();
    
    if (errorRate > 5) {
      await this.slack.send({
        text: `🚨 높은 에러율 감지: ${errorRate}%`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*에러율:* ${errorRate}%\n*임계값:* 5%`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '로그 보기' },
                url: 'https://logs.yourcompany.com',
              },
            ],
          },
        ],
      });
    }
  }
  
  /**
   * 비용 알림
   */
  async checkCost(): Promise<void> {
    const dailyCost = await this.getAICost();
    
    if (dailyCost > 10) {
      await this.slack.send({
        text: `💰 AI 비용 초과: $${dailyCost}/일`,
      });
    }
  }
}
```

## 5. 단일 폰 최적화

### 스마트 큐 (우선순위 + 배칭)
```typescript
// apps/bot/src/queue/smart-queue.ts

interface SmartQueueItem {
  id: string;
  priority: number;
  canBatch: boolean;
  question: string;
  context: any;
}

class SmartQueue {
  private queue: PriorityQueue<SmartQueueItem>;
  private batchBuffer: SmartQueueItem[] = [];
  private BATCH_SIZE = 5;
  private BATCH_TIMEOUT = 2000;
  
  /**
   * 배칭 가능 여부 판단
   */
  private canBatch(item: SmartQueueItem): boolean {
    // 간단한 질문만 배칭
    if (item.question.length > 50) return false;
    
    // 담당자 메시지는 배칭 안함
    if (item.context.senderRole === 'STAFF') return false;
    
    // 긴급 메시지는 배칭 안함
    if (item.priority > 80) return false;
    
    return true;
  }
  
  async process(): Promise<void> {
    while (true) {
      const item = this.queue.dequeue();
      
      if (this.canBatch(item)) {
        // 배칭 버퍼에 추가
        this.batchBuffer.push(item);
        
        // 버퍼가 찼거나 타임아웃이면 배치 처리
        if (this.batchBuffer.length >= this.BATCH_SIZE) {
          await this.processBatch();
        }
      } else {
        // 즉시 처리
        await this.processOne(item);
      }
    }
  }
  
  private async processBatch(): Promise<void> {
    const batch = this.batchBuffer.splice(0, this.BATCH_SIZE);
    
    // 배치 API로 한 번에 처리
    const answers = await batchProcessor.process(
      batch.map(item => item.question)
    );
    
    // 응답 전송
    for (let i = 0; i < batch.length; i++) {
      await this.sendResponse(batch[i], answers[i]);
    }
  }
}
```

### 프리페칭 (예측 캐싱)
```typescript
// apps/bot/src/cache/prefetch.ts

class PrefetchCache {
  /**
   * 사용자 행동 패턴 기반 프리페칭
   */
  async prefetchForUser(userId: string): Promise<void> {
    // 사용자의 과거 질문 패턴 분석
    const patterns = await this.analyzeUserPatterns(userId);
    
    // 다음에 물어볼 가능성 높은 질문들 미리 캐싱
    for (const predictedQuestion of patterns.nextQuestions) {
      const cached = await cache.get(predictedQuestion);
      
      if (!cached) {
        // 백그라운드에서 미리 답변 생성
        const answer = await this.generateAnswer(predictedQuestion);
        await cache.set(predictedQuestion, answer);
        
        console.log(`🔮 Prefetched: ${predictedQuestion}`);
      }
    }
  }
  
  /**
   * 시간대별 프리페칭
   */
  async prefetchByTimeOfDay(): Promise<void> {
    const hour = new Date().getHours();
    
    if (hour === 9) {
      // 출근 시간: 일일 통계 캐싱
      await this.cacheFrequentQuestions();
    }
    
    if (hour === 14) {
      // 오후: 정산 관련 질문 증가
      await this.prefetchCategory('정산');
    }
  }
}
```

## 6. 비용 최적화 요약
```typescript
// 월간 비용 시뮬레이션

interface CostBreakdown {
  infrastructure: number;
  ai: number;
  total: number;
}

function calculateMonthlyCost(): CostBreakdown {
  // 인프라 (GKE Autopilot)
  const apiPods = 3 * 50; // $150
  const botPods = 1 * 80; // $80 (단일 폰)
  const loadBalancer = 18;
  const infrastructure = apiPods + botPods + loadBalancer; // $248
  
  // AI (7,500 메시지/월)
  const messages = 7500;
  
  // 캐싱 전략
  const cacheHitRate = 0.4; // 40% 캐시 히트
  const batchRate = 0.3;    // 30% 배칭
  const individualRate = 0.3; // 30% 개별
  
  const cachedCalls = messages * cacheHitRate * 0; // 무료
  const batchedCalls = messages * batchRate * 0.00005; // 50% 할인
  const individualCalls = messages * individualRate * 0.0001;
  
  const ai = cachedCalls + batchedCalls + individualCalls; // $0.34
  
  return {
    infrastructure,
    ai,
    total: infrastructure + ai, // $248.34/월
  };
}
```

**최적화 효과**:
```
최적화 전:
- 캐싱 없음
- 배칭 없음
- 개별 호출: $0.75/월
- 인프라: $248/월
총: $248.75/월

최적화 후:
- 캐시 40%
- 배칭 30%
- AI 비용: $0.34/월 (55% 절감)
- 인프라: $248/월
총: $248.34/월
```
# 환경변수 설정 가이드

## .env.example (전체)
```bash
# ============================================
# 환경
# ============================================
NODE_ENV=production
LOG_LEVEL=info

# ============================================
# API 서버
# ============================================
API_URL=https://api.yourcompany.com
API_PORT=3000
CORS_ORIGIN=https://admin.yourcompany.com

# ============================================
# 데이터베이스
# ============================================

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Redis (Upstash)
REDIS_URL=rediss://default:xxxxx@xxxxx.upstash.io:6379

# ============================================
# AI APIs
# ============================================

# Gemini
GEMINI_API_KEY=AIzaSy...

# Claude (Fallback)
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI (Fallback)
OPENAI_API_KEY=sk-proj-...

# ============================================
# 카카오톡
# ============================================

# 디바이스 정보
KAKAO_DEVICE_ID=your-device-id
KAKAO_DEVICE_MODEL=SM-A536N
KAKAO_OS_VERSION=13

# 인증
KAKAO_OAUTH_TOKEN=xxxxx
KAKAO_REFRESH_TOKEN=xxxxx

# ADB 설정
ADB_HOST=localhost
ADB_PORT=5037

# ============================================
# 네트워크
# ============================================

# 프록시 (선택)
HTTP_PROXY=http://user:pass@proxy:port
HTTPS_PROXY=http://user:pass@proxy:port

# ============================================
# 모니터링
# ============================================

# Datadog
DD_API_KEY=xxxxx
DD_SITE=datadoghq.com
DD_SERVICE=kakao-cs-bot
DD_ENV=production

# Sentry
SENTRY_DSN=https://xxxxx@o123456.ingest.sentry.io/123456
SENTRY_TRACES_SAMPLE_RATE=0.1

# ============================================
# Feature Flags
# ============================================
ENABLE_CONTEXT_ANALYSIS=true
ENABLE_LEARNING=true
ENABLE_DEDUPLICATION=true

# ============================================
# AI 설정
# ============================================
AI_DEFAULT_MODEL=gemini-flash
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=1000
USE_PRO_FOR_STAFF=true

# ============================================
# 행동 설정
# ============================================

# 운영 시간
OPERATION_START_TIME=09:50
OPERATION_END_TIME=18:30
OPERATION_TIMEZONE=Asia/Seoul

# 응답 타이밍 (ms)
MIN_RESPONSE_DELAY=2000
MAX_RESPONSE_DELAY=8000

# ============================================
# 보안
# ============================================
JWT_SECRET=your-secret-key-change-in-production
ENCRYPTION_KEY=32-byte-base64-encoded-key

# ============================================
# 관리자 대시보드
# ============================================
NEXTAUTH_URL=https://admin.yourcompany.com
NEXTAUTH_SECRET=your-nextauth-secret

# ============================================
# 알림
# ============================================
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxx

# 이메일 (선택)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

## 환경별 설정

### Development (.env.development)
```bash
NODE_ENV=development
LOG_LEVEL=debug

API_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001

# Local Supabase
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Local Redis
REDIS_URL=redis://localhost:6379

# 개발용 AI (더 싼 모델)
AI_DEFAULT_MODEL=gemini-flash
AI_TEMPERATURE=0.3

# 빠른 응답 (테스트용)
MIN_RESPONSE_DELAY=100
MAX_RESPONSE_DELAY=500
```

### Staging (.env.staging)
```bash
NODE_ENV=staging
LOG_LEVEL=info

API_URL=https://api-staging.yourcompany.com
CORS_ORIGIN=https://admin-staging.yourcompany.com

# Staging DB
SUPABASE_URL=https://staging-xxxxx.supabase.co
REDIS_URL=rediss://staging-xxxxx.upstash.io:6379

# 제한된 AI 호출
AI_MAX_REQUESTS_PER_HOUR=100
```

### Production (.env.production)
```bash
NODE_ENV=production
LOG_LEVEL=warn

# 프로덕션은 Kubernetes Secrets 사용
# 여기는 백업용
```

## 환경변수 검증
```typescript
// packages/config/src/env.ts
import { z } from 'zod';

const envSchema = z.object({
  // 환경
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  
  // API
  API_URL: z.string().url(),
  API_PORT: z.coerce.number().min(1).max(65535),
  
  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  
  // Redis
  REDIS_URL: z.string().url(),
  
  // AI
  GEMINI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  
  // Kakao
  KAKAO_DEVICE_ID: z.string().min(1),
  KAKAO_OAUTH_TOKEN: z.string().optional(),
  
  // 모니터링
  DD_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  
  // 보안
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(44), // Base64 32바이트
});

export type Env = z.infer<typeof envSchema>;

/**
 * 환경변수 로드 및 검증
 */
export function loadEnv(): Env {
  try {
    const env = envSchema.parse(process.env);
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ 환경변수 검증 실패:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
    }
    process.exit(1);
  }
}

/**
 * 민감 정보 마스킹
 */
export function maskSensitive(env: Env): Record<string, string> {
  const masked: any = { ...env };
  
  const sensitiveKeys = [
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'DD_API_KEY',
  ];
  
  for (const key of sensitiveKeys) {
    if (masked[key]) {
      masked[key] = masked[key].slice(0, 10) + '...';
    }
  }
  
  return masked;
}
```

## Secrets 관리 (Kubernetes)
```bash
#!/bin/bash
# scripts/setup/setup-secrets.sh

# 환경변수 파일에서 Secret 생성
kubectl create secret generic app-secrets \
  --from-env-file=.env.production \
  --namespace=kakao-cs-bot \
  --dry-run=client \
  -o yaml | kubectl apply -f -
```

## Secrets 관리 (로컬)
```bash
# direnv 사용 (추천)
brew install direnv

# .envrc 파일 생성
echo 'dotenv .env.local' > .envrc
direnv allow

# 또는 dotenv-cli
npm install -g dotenv-cli
dotenv -e .env.development -- bun run dev
```
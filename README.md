# kakao-cs-bot

카카오톡 AI 고객상담 자동화 시스템. 안드로이드 NotificationListenerService를 이용하여 카카오톡 메시지를 수신하고, AI가 자동으로 답변을 생성하여 회신합니다.

## 기술 스택

| 계층 | 기술 |
|------|------|
| Backend | Node.js, Hono, tRPC v11, TypeScript |
| Frontend | Next.js 15, React 19, Tailwind CSS, shadcn/ui |
| Database | PostgreSQL + pgvector |
| Cache | Redis |
| AI | OpenAI GPT-4o, Gemini, Anthropic |
| Mobile | Android (Kotlin), NotificationListenerService |
| Infra | Docker, GitHub Actions |

## 디렉토리 구조

```
apps/
  api/          - Hono + tRPC 백엔드 API 서버
  admin/        - Next.js 관리자 대시보드
  bot/          - 에이전트 워커 (Coordinator + MessageAgent)
  cli/          - 운영용 CLI 도구
  kakao-bot-app/- Android 카카오톡 봇 앱

packages/
  ai/           - LLM 멀티 프로바이더 게이트웨이
  config/       - 환경변수 검증 (Zod), 로거, 에러 클래스
  database/     - PostgreSQL 클라이언트, Repository 패턴
```

## 빠른 시작

### 사전 요구사항

- Node.js >= 20
- PostgreSQL (pgvector 확장)
- Redis

### 설치

```bash
# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env
# .env 파일에 실제 값 입력

# 개발 서버 실행 (API + Admin + Bot 동시)
npm run dev
```

### 개별 실행

```bash
npm run dev:api    # API 서버 (포트 3000)
npm run dev:admin  # 관리자 대시보드 (포트 3001)
npm run dev:bot    # 봇 워커
```

### Docker

```bash
docker-compose up -d
```

## 환경변수

`.env.example` 파일을 참고하세요. 주요 필수 항목:

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `REDIS_URL` | Redis 연결 문자열 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `JWT_SECRET` | JWT 서명 키 (32자 이상) |
| `ADMIN_PASSWORD` | 관리자 비밀번호 |
| `WEBHOOK_SECRET` | Webhook 인증 시크릿 |

## 문서

- [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) - 시스템 아키텍처
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) - DB 스키마
- [API_SPECIFICATION.md](API_SPECIFICATION.md) - API 스펙
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - 배포 가이드
- [ENV_CONFIGURATION.md](ENV_CONFIGURATION.md) - 환경변수 설정

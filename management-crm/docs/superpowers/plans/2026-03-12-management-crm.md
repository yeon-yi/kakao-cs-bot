# 관리 CRM Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 결제 시스템에서 업체 데이터를 실시간 크롤링하고, 솔루션 진행 상황을 한 눈에 관리하는 CRM 구축

**Architecture:** Next.js 15 App Router 기반 풀스택 앱. PostgreSQL DB에 업체/솔루션/이력 저장. Playwright 크롤러가 5분마다 기존 사이트를 스캔하여 신규 업체 자동 수입. Docker Compose로 web + db + crawler 3개 컨테이너 운영.

**Tech Stack:** Next.js 15, React, TypeScript, PostgreSQL, Prisma ORM, Playwright (crawler), Docker, nginx, JWT auth, Tailwind CSS

---

## File Structure

```
management-crm/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── prisma/
│   ├── schema.prisma          # DB 스키마 (users, companies, solutions, logs)
│   └── seed.ts                # 초기 admin 계정 생성
├── crawler/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # 크롤러 메인 (스케줄러)
│       ├── scraper.ts         # 페이지 크롤링 로직
│       ├── db.ts              # DB 연결 및 upsert
│       └── logger.ts          # 크롤링 로그
├── src/
│   ├── middleware.ts           # 인증 미들웨어
│   ├── lib/
│   │   ├── prisma.ts          # Prisma 클라이언트 싱글턴
│   │   ├── auth.ts            # JWT sign/verify, requireAuth
│   │   ├── api-client.ts      # 프론트 API 호출 헬퍼
│   │   └── constants.ts       # 솔루션 타입, 역할 등 상수
│   ├── app/
│   │   ├── layout.tsx         # 루트 레이아웃 (html, body)
│   │   ├── login/
│   │   │   └── page.tsx       # 로그인 페이지
│   │   ├── (main)/
│   │   │   ├── layout.tsx     # 사이드바 + 메인 레이아웃
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx   # 대시보드
│   │   │   ├── companies/
│   │   │   │   ├── page.tsx   # 업체 목록 (핵심 화면)
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx # 업체 상세 + 솔루션 세팅/체크
│   │   │   ├── logs/
│   │   │   │   └── page.tsx   # 활동 내역
│   │   │   ├── users/
│   │   │   │   └── page.tsx   # 계정 관리 (admin)
│   │   │   ├── crawler/
│   │   │   │   └── page.tsx   # 크롤링 설정 (admin)
│   │   │   └── settings/
│   │   │       └── page.tsx   # 비밀번호 변경
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── route.ts           # POST login, GET session, DELETE logout
│   │       │   └── password/
│   │       │       └── route.ts       # POST 비밀번호 변경
│   │       ├── companies/
│   │       │   ├── route.ts           # GET 목록 (필터/검색/페이지네이션)
│   │       │   └── [id]/
│   │       │       ├── route.ts       # GET 상세
│   │       │       ├── settings/
│   │       │       │   └── route.ts   # POST/PUT 솔루션 세팅
│   │       │       └── progress/
│   │       │           └── route.ts   # PUT 솔루션 진행 체크
│   │       ├── dashboard/
│   │       │   └── route.ts           # GET 대시보드 통계
│   │       ├── logs/
│   │       │   └── route.ts           # GET 변경 내역
│   │       ├── users/
│   │       │   └── route.ts           # CRUD 사용자
│   │       └── crawler/
│   │           └── route.ts           # GET 상태, POST 수동 실행
```

---

## Chunk 1: 프로젝트 초기화 + DB + 인증

### Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `docker-compose.yml`, `Dockerfile`

- [ ] **Step 1: Next.js 프로젝트 초기화**

```bash
cd C:/Users/user/AI_Chat/management-crm
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

- [ ] **Step 2: 필수 패키지 설치**

```bash
npm install prisma @prisma/client bcryptjs jsonwebtoken cookie
npm install -D @types/bcryptjs @types/jsonwebtoken @types/cookie
```

- [ ] **Step 3: .env.example 작성**

```env
DATABASE_URL=postgresql://crm:crm2026!@db:5432/crm
JWT_SECRET=mgmt-crm-jwt-2026!secret
CRAWLER_LOGIN_ID=admin
CRAWLER_LOGIN_PW=a123123
CRAWLER_TARGET_URL=https://payment.nldb.co.kr
CRAWLER_INTERVAL_MS=300000
```

- [ ] **Step 4: docker-compose.yml 작성**

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: crm-db
    environment:
      POSTGRES_USER: crm
      POSTGRES_PASSWORD: crm2026!
      POSTGRES_DB: crm
    volumes:
      - /backup/crm-data/postgres:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crm"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    build: .
    container_name: crm-web
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - DATABASE_URL=postgresql://crm:crm2026!@db:5432/crm
      - JWT_SECRET=mgmt-crm-jwt-2026!secret
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  crawler:
    build:
      context: ./crawler
    container_name: crm-crawler
    environment:
      - DATABASE_URL=postgresql://crm:crm2026!@db:5432/crm
      - CRAWLER_LOGIN_ID=admin
      - CRAWLER_LOGIN_PW=a123123
      - CRAWLER_TARGET_URL=https://payment.nldb.co.kr
      - CRAWLER_INTERVAL_MS=300000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 5: Dockerfile 작성**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 6: next.config.ts 설정**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
};

export default nextConfig;
```

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js project with Docker setup"
```

---

### Task 2: Prisma 스키마 + DB 마이그레이션

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`

- [ ] **Step 1: Prisma 초기화**

```bash
npx prisma init
```

- [ ] **Step 2: schema.prisma 작성**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  manager_team
  manager
  staff
}

enum VideoType {
  none
  premium
  short
}

model User {
  id           Int       @id @default(autoincrement())
  username     String    @unique
  passwordHash String    @map("password_hash")
  displayName  String    @map("display_name")
  role         Role      @default(staff)
  branch       String?   // 소속 지사 (인천, 수원, 동탄, 용인, 부산, 안산, 본사 등)
  createdAt    DateTime  @default(now()) @map("created_at")

  solutionSettings SolutionSetting[]
  solutionLogs     SolutionLog[]

  @@map("users")
}

model Company {
  id              Int       @id @default(autoincrement())
  sourceId        Int       @unique @map("source_id")    // 원본 No.
  registrant      String                                   // 등록자
  paymentDate     DateTime  @map("payment_date")           // 결제년월일
  companyName     String    @map("company_name")           // 업체명
  representative  String                                   // 대표자 성함
  phone           String                                   // 번호
  staffName       String    @map("staff_name")             // 담당자
  managerName     String    @map("manager_name")           // 담당간부
  branch          String?                                  // 지사 (등록자에서 추출)
  crawledAt       DateTime  @default(now()) @map("crawled_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  setting         SolutionSetting?
  progress        SolutionProgress?
  logs            SolutionLog[]

  @@index([paymentDate])
  @@index([companyName])
  @@index([managerName])
  @@index([staffName])
  @@index([branch])
  @@map("companies")
}

model SolutionSetting {
  id              Int       @id @default(autoincrement())
  companyId       Int       @unique @map("company_id")
  contractStart   DateTime? @map("contract_start")
  contractEnd     DateTime? @map("contract_end")
  isHolding       Boolean   @default(false) @map("is_holding")
  hasReward       Boolean   @default(false) @map("has_reward")
  blogTarget      Int       @default(0) @map("blog_target")
  instaTarget     Int       @default(0) @map("insta_target")
  hasHomepage     Boolean   @default(false) @map("has_homepage")
  videoType       VideoType @default(none) @map("video_type")
  lastDeployDate  DateTime? @map("last_deploy_date")
  setById         Int       @map("set_by_id")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  company         Company   @relation(fields: [companyId], references: [id])
  setBy           User      @relation(fields: [setById], references: [id])

  @@map("solution_settings")
}

model SolutionProgress {
  id              Int       @id @default(autoincrement())
  companyId       Int       @unique @map("company_id")
  rewardDone      Boolean   @default(false) @map("reward_done")
  blogCount       Int       @default(0) @map("blog_count")
  instaCount      Int       @default(0) @map("insta_count")
  homepageDone    Boolean   @default(false) @map("homepage_done")
  videoDone       Boolean   @default(false) @map("video_done")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  company         Company   @relation(fields: [companyId], references: [id])

  @@map("solution_progress")
}

model SolutionLog {
  id              Int       @id @default(autoincrement())
  companyId       Int       @map("company_id")
  userId          Int       @map("user_id")
  fieldName       String    @map("field_name")
  oldValue        String?   @map("old_value")
  newValue        String?   @map("new_value")
  createdAt       DateTime  @default(now()) @map("created_at")

  company         Company   @relation(fields: [companyId], references: [id])
  user            User      @relation(fields: [userId], references: [id])

  @@index([companyId])
  @@index([createdAt])
  @@map("solution_logs")
}

model CrawlLog {
  id              Int       @id @default(autoincrement())
  status          String    // success, error
  newCount        Int       @default(0) @map("new_count")
  updateCount     Int       @default(0) @map("update_count")
  totalScanned    Int       @default(0) @map("total_scanned")
  errorMessage    String?   @map("error_message")
  duration        Int       @default(0) // ms
  createdAt       DateTime  @default(now()) @map("created_at")

  @@map("crawl_logs")
}
```

- [ ] **Step 3: seed.ts 작성 (admin 계정)**

```typescript
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hash = bcrypt.hashSync('admin1616@', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: hash,
      displayName: '관리자',
      role: 'admin',
      branch: null,
    },
  });
  console.log('Seed complete: admin user created');
}

main().catch(console.error).finally(() => prisma.$disconnect());
```

- [ ] **Step 4: package.json에 prisma seed 추가**

```json
{
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"commonjs\"} prisma/seed.ts"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat: add Prisma schema with users, companies, solutions, logs"
```

---

### Task 3: 인증 시스템 (JWT + 미들웨어)

**Files:**
- Create: `src/lib/prisma.ts`, `src/lib/auth.ts`, `src/lib/api-client.ts`, `src/lib/constants.ts`
- Create: `src/middleware.ts`
- Create: `src/app/api/auth/route.ts`, `src/app/api/auth/password/route.ts`
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: src/lib/prisma.ts — Prisma 싱글턴**

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

- [ ] **Step 2: src/lib/auth.ts — JWT 유틸**

```typescript
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const SECRET = process.env.JWT_SECRET || 'mgmt-crm-jwt-2026!secret';

export interface AuthPayload {
  userId: number;
  username: string;
  role: string;
  branch: string | null;
  displayName: string;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, SECRET) as AuthPayload;
}

export function requireAuth(request: Request): AuthPayload {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/token=([^;]+)/);
  if (!match) throw new Error('Unauthorized');
  return verifyToken(match[1]);
}
```

- [ ] **Step 3: src/lib/constants.ts — 상수**

```typescript
export const ROLES = {
  ADMIN: 'admin',
  MANAGER_TEAM: 'manager_team',
  MANAGER: 'manager',
  STAFF: 'staff',
} as const;

export const BRANCHES = [
  '인천', '수원', '동탄', '용인', '부산', '안산', '본사',
] as const;

// 등록자 → 지사 매핑
const BRANCH_MAP: Record<string, string> = {
  '인천마스터': '인천', '인천파링': '인천',
  '수원마스터': '수원', '수원플레이스': '수원',
  '동탄마스터': '동탄', '동탄플레이스': '동탄',
  '용인마스터': '용인', '용인플레이스': '용인',
  '부산마스터': '부산', '부산플레이스': '부산',
  '안산플레이스': '안산', 'place1': '안산', '플레이스팀': '안산',
};

export function extractBranch(registrant: string): string {
  return BRANCH_MAP[registrant] || '본사';
}

export const VIDEO_TYPES = {
  none: '없음',
  premium: '프리미엄 영상',
  short: '일반 숏폼',
} as const;

export const SOLUTION_LABELS = {
  reward: '리워드',
  blog: '블로그리뷰',
  insta: '인스타',
  homepage: '홈페이지',
  video: '영상제작',
} as const;
```

- [ ] **Step 4: src/lib/api-client.ts — 프론트 API 헬퍼**

```typescript
async function request(url: string, options?: RequestInit) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return res.json();
}

export const apiGet = (url: string) => request(url);
export const apiPost = (url: string, body: any) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const apiPut = (url: string, body: any) =>
  request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const apiDelete = (url: string) => request(url, { method: 'DELETE' });
```

- [ ] **Step 5: src/middleware.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/login' || pathname.startsWith('/api/auth') || pathname.startsWith('/_next') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  const token = request.cookies.get('token')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 6: src/app/api/auth/route.ts — 로그인/세션/로그아웃**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { signToken, requireAuth } from '@/lib/auth';
import bcrypt from 'bcryptjs';

// POST: 로그인
export async function POST(request: NextRequest) {
  const { username, password } = await request.json();
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }
  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    branch: user.branch,
    displayName: user.displayName,
  });
  const res = NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, displayName: user.displayName, branch: user.branch } });
  res.cookies.set('token', token, { httpOnly: true, path: '/', maxAge: 7 * 86400, sameSite: 'lax' });
  return res;
}

// GET: 세션 확인
export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request);
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// DELETE: 로그아웃
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('token', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
```

- [ ] **Step 7: src/app/login/page.tsx**

로그인 폼 (username, password, submit). 로그인 성공 시 /dashboard로 이동.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ src/middleware.ts src/app/api/auth/ src/app/login/
git commit -m "feat: add JWT auth system with login/logout/session"
```

---

## Chunk 2: 메인 레이아웃 + 업체 목록 (핵심 화면)

### Task 4: 메인 레이아웃 (사이드바)

**Files:**
- Create: `src/app/(main)/layout.tsx`
- Create: `src/app/layout.tsx` (루트)

- [ ] **Step 1: src/app/layout.tsx — 루트 레이아웃**

html, body, Tailwind 기본 설정. `<html lang="ko">`.

- [ ] **Step 2: src/app/(main)/layout.tsx — 사이드바 레이아웃**

사이드바 메뉴:
- 대시보드 (all)
- 업체 관리 (all)
- 활동 내역 (all)
- 계정 관리 (admin only)
- 크롤링 설정 (admin only)
- 설정 (all — 비밀번호 변경)

하단: 로그인 사용자 정보 + 로그아웃.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx src/app/(main)/layout.tsx
git commit -m "feat: add main layout with sidebar navigation"
```

---

### Task 5: 업체 목록 API

**Files:**
- Create: `src/app/api/companies/route.ts`

- [ ] **Step 1: GET /api/companies — 목록 조회**

쿼리 파라미터:
- `page` (기본 1), `pageSize` (기본 50)
- `search` (업체명, 대표자, 번호 검색)
- `registrant`, `staffName`, `managerName` (필터)
- `branch` (지사 필터)
- `holding` (홀딩 필터: true/false)
- `solutionStatus` (미설정/진행중/완료)
- `startDate`, `endDate` (결제일 기간)

권한별 조회 범위:
```typescript
// admin, manager_team: 전체
// manager: 본인 지사(branch)만
// staff: 본인이 담당자(staffName)인 건만
function buildWhereClause(user: AuthPayload, filters: any) {
  const where: any = {};

  if (user.role === 'manager') {
    where.branch = user.branch;
  } else if (user.role === 'staff') {
    where.staffName = user.displayName;
  }
  // admin, manager_team: 제한 없음

  // ... 추가 필터 적용
  return where;
}
```

응답에 company + setting + progress 조인하여 반환.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/companies/
git commit -m "feat: add companies list API with role-based filtering"
```

---

### Task 6: 업체 목록 페이지 (핵심 UI)

**Files:**
- Create: `src/app/(main)/companies/page.tsx`

- [ ] **Step 1: 업체 목록 테이블 구현**

한 행에 모든 정보가 보이는 구조:

```
결제일 | 업체명 | 대표자 | 담당자 | 간부 | 리워드 | 블로그 | 인스타 | 홈페이지 | 영상 | 홀딩 | 배포일 | 계약
```

각 솔루션 셀 색상:
- 회색 배경: 미해당 (설정 안 됨)
- 빨간 배경: 해당이지만 미완료
- 노란 배경: 진행 중 (건수 표시: "45/100")
- 초록 배경: 완료
- 프로그레스 바: 블로그/인스타 셀에 건수 비율 표시

- [ ] **Step 2: 필터/검색 바**

상단에 필터:
- 검색 (업체명/대표자/번호)
- 등록자 드롭다운
- 지사 드롭다운 (admin/manager_team만)
- 결제일 기간
- 홀딩 필터
- 솔루션 상태 필터 (전체/미설정/진행중/완료)

- [ ] **Step 3: 페이지네이션**

하단 페이지네이션 (50건 단위).

- [ ] **Step 4: 행 클릭 → 상세 페이지 이동**

- [ ] **Step 5: Commit**

```bash
git add src/app/(main)/companies/
git commit -m "feat: add companies list page with solution status overview"
```

---

## Chunk 3: 업체 상세 + 솔루션 관리

### Task 7: 업체 상세 API

**Files:**
- Create: `src/app/api/companies/[id]/route.ts`
- Create: `src/app/api/companies/[id]/settings/route.ts`
- Create: `src/app/api/companies/[id]/progress/route.ts`

- [ ] **Step 1: GET /api/companies/[id] — 상세 조회**

company + setting + progress + 최근 로그 30건 반환.

- [ ] **Step 2: POST /api/companies/[id]/settings — 솔루션 초기 세팅**

간부/관리팀만 가능. 모든 필드 변경 시 solution_logs에 기록.

```typescript
// 변경 이력 자동 기록
async function logChanges(companyId: number, userId: number, oldData: any, newData: any) {
  const fields = ['isHolding', 'hasReward', 'blogTarget', 'instaTarget', 'hasHomepage', 'videoType', 'contractStart', 'contractEnd', 'lastDeployDate'];
  for (const field of fields) {
    if (String(oldData[field]) !== String(newData[field])) {
      await prisma.solutionLog.create({
        data: { companyId, userId, fieldName: field, oldValue: String(oldData[field] ?? ''), newValue: String(newData[field] ?? '') },
      });
    }
  }
}
```

- [ ] **Step 3: PUT /api/companies/[id]/progress — 솔루션 진행 체크**

담당자/간부/관리팀 가능. 변경 시 로그 기록.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/companies/
git commit -m "feat: add company detail, settings, progress APIs with change logging"
```

---

### Task 8: 업체 상세 페이지

**Files:**
- Create: `src/app/(main)/companies/[id]/page.tsx`

- [ ] **Step 1: 상단 — 업체 기본 정보**

크롤링된 원본 정보 표시: 업체명, 대표자, 번호, 등록자, 결제일, 담당자, 간부.

- [ ] **Step 2: 중단 — 솔루션 세팅 폼**

간부/관리팀에게만 편집 가능:
- 계약기간 (시작~종료 date picker)
- 홀딩 토글
- 리워드 토글
- 블로그 목표 건수 (숫자 입력)
- 인스타 목표 건수 (숫자 입력)
- 홈페이지 토글
- 영상제작 (없음/프리미엄/일반숏폼 라디오)
- 마지막 배포일 (date picker)

영업자(staff)는 읽기만 가능.

- [ ] **Step 3: 중단 — 솔루션 진행 체크**

담당자/간부/관리팀 편집 가능:
- 리워드: 체크박스 (완료/미완료)
- 블로그: 숫자 입력 (진행건수) + 프로그레스바 (진행/목표)
- 인스타: 숫자 입력 (진행건수) + 프로그레스바
- 홈페이지: 체크박스
- 영상: 체크박스

- [ ] **Step 4: 하단 — 변경 이력 타임라인**

```
2026-03-12 14:30 | 김간부 | 블로그 목표 0 → 100
2026-03-12 14:31 | 김간부 | 리워드 해당 설정
2026-03-12 15:00 | 박담당 | 블로그 진행 0 → 15
```

- [ ] **Step 5: Commit**

```bash
git add src/app/(main)/companies/
git commit -m "feat: add company detail page with solution settings and progress"
```

---

## Chunk 4: 대시보드 + 계정관리 + 활동내역

### Task 9: 대시보드

**Files:**
- Create: `src/app/api/dashboard/route.ts`
- Create: `src/app/(main)/dashboard/page.tsx`

- [ ] **Step 1: GET /api/dashboard**

```json
{
  "todayNew": 5,
  "totalCompanies": 18130,
  "solutionSummary": {
    "notSet": 120,
    "inProgress": 85,
    "completed": 40
  },
  "holdingCount": 12,
  "expiringCount": 8,
  "recentCompanies": [...]
}
```

- [ ] **Step 2: 대시보드 UI**

카드형 통계:
- 오늘 신규 업체
- 솔루션 미설정/진행중/완료 비율
- 홀딩 업체
- 30일 내 만료 예정

최근 업체 목록 (5건).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/dashboard/ src/app/(main)/dashboard/
git commit -m "feat: add dashboard with stats and summary"
```

---

### Task 10: 계정 관리 (admin)

**Files:**
- Create: `src/app/api/users/route.ts`
- Create: `src/app/(main)/users/page.tsx`

- [ ] **Step 1: API — CRUD**

- GET: 사용자 목록
- POST: 사용자 생성 (username, password, displayName, role, branch)
- PUT: 수정
- DELETE: 삭제

admin role만 접근 가능.

- [ ] **Step 2: UI — 사용자 목록 + 추가/수정 모달**

테이블: 이름, 아이디, 역할, 지사, 생성일.
추가 버튼 → 모달 (이름, 아이디, 비밀번호, 역할 선택, 지사 선택).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/users/ src/app/(main)/users/
git commit -m "feat: add user management for admin"
```

---

### Task 11: 활동 내역

**Files:**
- Create: `src/app/api/logs/route.ts`
- Create: `src/app/(main)/logs/page.tsx`

- [ ] **Step 1: GET /api/logs**

쿼리: page, userId, companyId, startDate, endDate.
응답: 로그 목록 + 사용자명 + 업체명 조인.

- [ ] **Step 2: UI — 로그 테이블**

필터: 사용자, 업체, 날짜.
테이블: 일시, 사용자, 업체명, 변경 필드, 이전값, 새값.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/logs/ src/app/(main)/logs/
git commit -m "feat: add activity logs page"
```

---

### Task 12: 비밀번호 변경

**Files:**
- Create: `src/app/api/auth/password/route.ts`
- Create: `src/app/(main)/settings/page.tsx`

- [ ] **Step 1: POST /api/auth/password**

현재 비밀번호 확인 → 새 비밀번호 해싱 → 업데이트.

- [ ] **Step 2: 설정 페이지 UI**

현재 비밀번호, 새 비밀번호, 확인 입력 폼.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/password/ src/app/(main)/settings/
git commit -m "feat: add password change"
```

---

## Chunk 5: 크롤러

### Task 13: 크롤러 프로젝트 세팅

**Files:**
- Create: `crawler/package.json`, `crawler/tsconfig.json`, `crawler/Dockerfile`

- [ ] **Step 1: crawler/package.json**

```json
{
  "name": "crm-crawler",
  "private": true,
  "scripts": {
    "start": "ts-node src/index.ts",
    "dev": "ts-node-dev src/index.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.0.0",
    "playwright": "^1.50.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node": "^10.0.0",
    "@types/node": "^20.0.0",
    "prisma": "^6.0.0"
  }
}
```

- [ ] **Step 2: crawler/Dockerfile**

```dockerfile
FROM node:20-slim
RUN npx playwright install --with-deps chromium
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
CMD ["npx", "ts-node", "src/index.ts"]
```

- [ ] **Step 3: Commit**

```bash
git add crawler/
git commit -m "chore: scaffold crawler project"
```

---

### Task 14: 크롤러 핵심 로직

**Files:**
- Create: `crawler/src/index.ts`, `crawler/src/scraper.ts`, `crawler/src/db.ts`, `crawler/src/logger.ts`

- [ ] **Step 1: crawler/src/scraper.ts — 페이지 크롤링**

```typescript
import { chromium, Browser, Page } from 'playwright';

export interface CrawledCompany {
  sourceId: number;
  registrant: string;
  paymentDate: string;
  companyName: string;
  representative: string;
  phone: string;
  staffName: string;
  managerName: string;
}

export async function login(page: Page, url: string, id: string, pw: string) {
  await page.goto(`${url}/signin`);
  await page.fill('input[placeholder*="아이디"]', id);
  await page.fill('input[placeholder*="비밀번호"]', pw);
  await page.click('button:has-text("로그인")');
  await page.waitForURL('**/admin/**');
}

export async function scrapePage(page: Page, url: string, pageNum: number): Promise<CrawledCompany[]> {
  await page.goto(`${url}/admin/payment/list?page=${pageNum}&pageSize=20`);
  await page.waitForSelector('table');

  const rows = await page.$$('tbody tr');
  const companies: CrawledCompany[] = [];

  for (const row of rows) {
    const cells = await row.$$('td');
    if (cells.length < 12) continue;

    const sourceId = parseInt(await cells[1].textContent() || '0');
    if (!sourceId) continue;

    companies.push({
      sourceId,
      registrant: (await cells[3].textContent() || '').trim(),
      paymentDate: (await cells[4].textContent() || '').trim(),
      companyName: (await cells[5].textContent() || '').trim(),
      representative: (await cells[6].textContent() || '').trim(),
      phone: (await cells[7].textContent() || '').trim(),
      staffName: (await cells[9].textContent() || '').trim(),
      managerName: (await cells[10].textContent() || '').trim(),
    });
  }

  return companies;
}

export async function getTotalPages(page: Page): Promise<number> {
  const links = await page.$$('.pagination a');
  let max = 1;
  for (const link of links) {
    const text = await link.textContent();
    const num = parseInt(text || '0');
    if (num > max) max = num;
  }
  // "다음" 링크가 있으면 더 많은 페이지가 있음
  const nextLink = await page.$('.pagination a:has-text("다음")');
  if (nextLink) {
    const href = await nextLink.getAttribute('href');
    // href에서 page 값 추출하여 최대값 갱신
    const match = href?.match(/page=(\d+)/);
    if (match) max = Math.max(max, parseInt(match[1]));
  }
  return max;
}
```

- [ ] **Step 2: crawler/src/db.ts — DB upsert**

```typescript
import { PrismaClient } from '@prisma/client';
import { CrawledCompany } from './scraper';
import { extractBranch } from './constants';

const prisma = new PrismaClient();

export async function upsertCompanies(companies: CrawledCompany[]): Promise<{ newCount: number; updateCount: number }> {
  let newCount = 0;
  let updateCount = 0;

  for (const c of companies) {
    const existing = await prisma.company.findUnique({ where: { sourceId: c.sourceId } });
    const branch = extractBranch(c.registrant);

    if (!existing) {
      await prisma.company.create({
        data: {
          sourceId: c.sourceId,
          registrant: c.registrant,
          paymentDate: new Date(c.paymentDate),
          companyName: c.companyName,
          representative: c.representative,
          phone: c.phone,
          staffName: c.staffName,
          managerName: c.managerName,
          branch,
        },
      });
      newCount++;
    } else {
      // 변경사항 있으면 업데이트
      const changed = existing.companyName !== c.companyName ||
        existing.representative !== c.representative ||
        existing.phone !== c.phone ||
        existing.staffName !== c.staffName ||
        existing.managerName !== c.managerName;

      if (changed) {
        await prisma.company.update({
          where: { sourceId: c.sourceId },
          data: {
            companyName: c.companyName,
            representative: c.representative,
            phone: c.phone,
            staffName: c.staffName,
            managerName: c.managerName,
            branch,
            crawledAt: new Date(),
          },
        });
        updateCount++;
      }
    }
  }

  return { newCount, updateCount };
}

export { prisma };
```

- [ ] **Step 3: crawler/src/index.ts — 메인 스케줄러**

```typescript
import { chromium } from 'playwright';
import { login, scrapePage, getTotalPages } from './scraper';
import { upsertCompanies, prisma } from './db';

const TARGET_URL = process.env.CRAWLER_TARGET_URL!;
const LOGIN_ID = process.env.CRAWLER_LOGIN_ID!;
const LOGIN_PW = process.env.CRAWLER_LOGIN_PW!;
const INTERVAL = parseInt(process.env.CRAWLER_INTERVAL_MS || '300000');

async function crawlRecent() {
  const start = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await login(page, TARGET_URL, LOGIN_ID, LOGIN_PW);

    // 최신 2페이지만 크롤링
    let totalNew = 0, totalUpdate = 0, totalScanned = 0;
    for (let p = 1; p <= 2; p++) {
      const companies = await scrapePage(page, TARGET_URL, p);
      totalScanned += companies.length;
      const { newCount, updateCount } = await upsertCompanies(companies);
      totalNew += newCount;
      totalUpdate += updateCount;
    }

    await prisma.crawlLog.create({
      data: { status: 'success', newCount: totalNew, updateCount: totalUpdate, totalScanned, duration: Date.now() - start },
    });
    console.log(`[Crawl] +${totalNew} new, ${totalUpdate} updated, ${totalScanned} scanned (${Date.now() - start}ms)`);
  } catch (e: any) {
    await prisma.crawlLog.create({
      data: { status: 'error', errorMessage: e.message, duration: Date.now() - start },
    });
    console.error(`[Crawl Error]`, e.message);
  } finally {
    await browser.close();
  }
}

async function crawlAll() {
  console.log('[Crawl] Starting full initial crawl...');
  const start = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await login(page, TARGET_URL, LOGIN_ID, LOGIN_PW);
    const totalPages = await getTotalPages(page);
    let totalNew = 0, totalUpdate = 0, totalScanned = 0;

    for (let p = 1; p <= totalPages + 50; p++) {
      const companies = await scrapePage(page, TARGET_URL, p);
      if (companies.length === 0) break;
      totalScanned += companies.length;
      const { newCount, updateCount } = await upsertCompanies(companies);
      totalNew += newCount;
      totalUpdate += updateCount;
      console.log(`[Crawl] Page ${p}: +${newCount} new, ${updateCount} updated`);
    }

    await prisma.crawlLog.create({
      data: { status: 'success', newCount: totalNew, updateCount: totalUpdate, totalScanned, duration: Date.now() - start },
    });
    console.log(`[Crawl] Full crawl complete: +${totalNew} new, ${totalUpdate} updated, ${totalScanned} total (${Date.now() - start}ms)`);
  } catch (e: any) {
    console.error(`[Crawl Error]`, e.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  // 초기 전체 크롤링 (DB 비어있으면)
  const count = await prisma.company.count();
  if (count === 0) {
    await crawlAll();
  }

  // 5분마다 최신 크롤링
  console.log(`[Crawler] Scheduled every ${INTERVAL / 1000}s`);
  setInterval(crawlRecent, INTERVAL);

  // 시작 즉시 1회 실행
  await crawlRecent();
}

main().catch(console.error);
```

- [ ] **Step 4: Commit**

```bash
git add crawler/src/
git commit -m "feat: add crawler with Playwright scraping and scheduled execution"
```

---

### Task 15: 크롤링 관리 페이지 (admin)

**Files:**
- Create: `src/app/api/crawler/route.ts`
- Create: `src/app/(main)/crawler/page.tsx`

- [ ] **Step 1: GET /api/crawler — 크롤링 상태/로그 조회**

최근 crawl_logs 50건 반환.

- [ ] **Step 2: 크롤링 관리 UI**

- 마지막 크롤링 시각, 성공/실패 상태
- 신규/업데이트 건수
- 로그 테이블 (일시, 상태, 신규, 업데이트, 소요시간, 오류)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/crawler/ src/app/(main)/crawler/
git commit -m "feat: add crawler management page for admin"
```

---

## Chunk 6: 서버 배포

### Task 16: 서버 환경 구성 + 배포

- [ ] **Step 1: 프로젝트를 서버에 전송**

```bash
scp -r C:/Users/user/AI_Chat/management-crm root@175.118.124.25:/home/management-crm
```

또는 git push → pull 방식.

- [ ] **Step 2: 서버 Docker 데이터 디렉토리 설정**

```bash
# Docker 데이터를 2TB 디스크에
mkdir -p /backup/crm-data/postgres
mkdir -p /etc/docker
echo '{"data-root":"/backup/docker"}' > /etc/docker/daemon.json
systemctl restart docker
```

- [ ] **Step 3: nginx 리버스 프록시 설정**

```nginx
server {
    listen 80;
    server_name 175.118.124.25;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

- [ ] **Step 4: 빌드 & 실행**

```bash
cd /home/management-crm
docker compose up -d db
# DB 마이그레이션
docker compose run --rm web npx prisma migrate deploy
docker compose run --rm web npx prisma db seed
# 전체 시작
docker compose up -d
```

- [ ] **Step 5: 동작 확인**

- `http://175.118.124.25` 접속 → 로그인 화면
- admin / admin1616@ 로그인
- 크롤러 로그에서 초기 크롤링 진행 확인

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: complete management CRM v1.0"
```

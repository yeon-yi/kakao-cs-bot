# 업셀링팀 전산 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 관리 CRM에 업셀링팀 전용 메뉴를 추가하여, 전지사 결제건 업체를 관리하고 상품(파워링크/리뷰/카카오채널/블로그스킨)을 설정·추적하며, 카카오맵 리뷰 연동까지 가능한 시스템 구축

**Architecture:** 기존 Next.js + Prisma + PostgreSQL 스택 위에 새로운 역할(upselling_director/chief/staff), 업체 분배 시스템, 상품 관리, 카카오맵 API 연동을 추가. 기존 Company 테이블을 공유하되 업셀링 전용 데이터는 별도 테이블로 분리. 사이드바 역할별 분기로 메뉴 격리.

**Tech Stack:** Next.js 16, Prisma 6, PostgreSQL 16, Kakao Local REST API, Playwright (crawler)

---

## 파일 구조 맵

### 수정 파일
- `prisma/schema.prisma` — 역할 enum 확장, 새 모델 5개 추가, Company 필드 추가
- `crawler/prisma/schema.prisma` — Company 필드 동기화
- `crawler/src/scraper.ts` — 카드사/결제금액 컬럼 크롤링 추가
- `crawler/src/db.ts` — 새 필드 upsert 반영
- `src/lib/constants.ts` — 업셀링 역할 상수, 라벨 추가
- `src/lib/auth.ts` — AuthPayload 확장 (createdById 추가 불필요, role만 사용)
- `src/app/(main)/layout.tsx` — 사이드바 역할별 메뉴 분기
- `src/app/api/users/route.ts` — 업셀링 역할 계층 권한 추가
- `src/app/api/auth/route.ts` — payload에 createdById 추가

### 신규 파일 — API
- `src/lib/upsell-auth.ts` — 업셀링 역할 권한 헬퍼
- `src/app/api/upsell/companies/route.ts` — 전지사 업체 목록 (업셀용)
- `src/app/api/upsell/distribution/route.ts` — 업체 분배 CRUD
- `src/app/api/upsell/products/route.ts` — 상품 설정 CRUD
- `src/app/api/upsell/products/[id]/route.ts` — 상품 개별 수정
- `src/app/api/upsell/kakaomap/search/route.ts` — 카카오맵 업체 검색
- `src/app/api/upsell/kakaomap/reviews/route.ts` — 카카오맵 리뷰 크롤링
- `src/app/api/upsell/users/route.ts` — 업셀팀 계정 관리
- `src/app/api/upsell/dashboard/route.ts` — 업셀 대시보드 통계
- `src/app/api/upsell/logs/route.ts` — 업셀 활동 내역

### 신규 파일 — 페이지
- `src/app/(main)/upsell/companies/page.tsx` — 업체 관리 (전지사 결제건)
- `src/app/(main)/upsell/companies/[id]/page.tsx` — 업체 상세 (상품설정, 리뷰)
- `src/app/(main)/upsell/distribution/page.tsx` — 업체 분배 (실장용)
- `src/app/(main)/upsell/users/page.tsx` — 팀원 관리
- `src/app/(main)/upsell/dashboard/page.tsx` — 대시보드
- `src/app/(main)/upsell/logs/page.tsx` — 활동 내역

---

## Phase 1: DB 스키마 확장

### Task 1.1: Prisma 스키마 — 역할 enum + User 확장

**Files:**
- Modify: `prisma/schema.prisma`

역할 enum에 업셀링 3종 추가, User에 createdById FK 추가:

```prisma
enum Role {
  admin
  manager_team
  manager
  staff
  upselling_director    // 실장
  upselling_chief       // 주임
  upselling_staff       // 사원
}

// User model에 추가:
  createdById  Int?      @map("created_by_id")
  createdBy    User?     @relation("UserCreator", fields: [createdById], references: [id])
  createdUsers User[]    @relation("UserCreator")
```

### Task 1.2: Prisma 스키마 — Company 필드 추가

**Files:**
- Modify: `prisma/schema.prisma`

```prisma
// Company model에 추가:
  cardCompany    String?  @map("card_company")    // 카드사
  paymentAmount  Int?     @map("payment_amount")  // 본계약 결제금액

  // Relations 추가
  upsellAssignments UpsellAssignment[]
```

### Task 1.3: Prisma 스키마 — 업셀링 모델 5개

**Files:**
- Modify: `prisma/schema.prisma`

```prisma
model UpsellAssignment {
  id            Int       @id @default(autoincrement())
  companyId     Int       @map("company_id")
  assignedToId  Int       @map("assigned_to_id")
  assignedById  Int       @map("assigned_by_id")
  assignedAt    DateTime  @default(now()) @map("assigned_at")

  company       Company   @relation(fields: [companyId], references: [id])
  assignedTo    User      @relation("AssignedTo", fields: [assignedToId], references: [id])
  assignedBy    User      @relation("AssignedBy", fields: [assignedById], references: [id])
  product       UpsellProduct?

  @@unique([companyId, assignedToId])
  @@index([assignedToId])
  @@index([assignedById])
  @@map("upsell_assignments")
}

enum ReviewType {
  receipt_only
  kakao_only
  both
}

enum ChannelType {
  none
  kakao_channel
  blog_skin
}

model UpsellProduct {
  id                  Int         @id @default(autoincrement())
  assignmentId        Int         @unique @map("assignment_id")
  hasPowerlink        Boolean     @default(false) @map("has_powerlink")
  powerlinkAdId       String?     @map("powerlink_ad_id")
  powerlinkAdPassword String?     @map("powerlink_ad_password")
  reviewType          ReviewType  @default(both) @map("review_type")
  receiptReviewTarget Int         @default(75) @map("receipt_review_target")
  kakaoReviewTarget   Int         @default(75) @map("kakao_review_target")
  totalReviewTarget   Int         @default(150) @map("total_review_target")
  channelType         ChannelType @default(none) @map("channel_type")
  naverAccount        String?     @map("naver_account")
  upsellAmount        Int?        @map("upsell_amount")
  kakaoMapUrl         String?     @map("kakao_map_url")
  kakaoMapPlaceId     String?     @map("kakao_map_place_id")
  kakaoMapName        String?     @map("kakao_map_name")
  initialReviewCount  Int         @default(0) @map("initial_review_count")
  exposureCount       Int         @default(0) @map("exposure_count")
  contractStart       DateTime?   @map("contract_start")
  contractEnd         DateTime?   @map("contract_end")
  createdAt           DateTime    @default(now()) @map("created_at")
  updatedAt           DateTime    @updatedAt @map("updated_at")

  assignment          UpsellAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  reviews             KakaoMapReview[]

  @@map("upsell_products")
}

model KakaoMapReview {
  id            Int       @id @default(autoincrement())
  productId     Int       @map("product_id")
  author        String
  title         String    @default("")
  content       String
  rating        Int       @default(0)
  isOurs        Boolean   @default(false) @map("is_ours")
  isManual      Boolean   @default(false) @map("is_manual")
  confirmedAt   DateTime? @map("confirmed_at")
  confirmedById Int?      @map("confirmed_by_id")
  fetchedAt     DateTime  @default(now()) @map("fetched_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  product       UpsellProduct @relation(fields: [productId], references: [id], onDelete: Cascade)
  confirmedBy   User?         @relation("ReviewConfirmer", fields: [confirmedById], references: [id])

  @@index([productId])
  @@map("kakao_map_reviews")
}

model UpsellLog {
  id        Int      @id @default(autoincrement())
  companyId Int?     @map("company_id")
  userId    Int      @map("user_id")
  action    String
  details   String?
  createdAt DateTime @default(now()) @map("created_at")

  user      User     @relation("UpsellLogger", fields: [userId], references: [id])

  @@index([userId])
  @@index([createdAt])
  @@map("upsell_logs")
}
```

User 모델에 relation 추가:
```prisma
  // User model 기존 relations 아래 추가:
  assignedUpsell     UpsellAssignment[] @relation("AssignedTo")
  distributedUpsell  UpsellAssignment[] @relation("AssignedBy")
  confirmedReviews   KakaoMapReview[]   @relation("ReviewConfirmer")
  upsellLogs         UpsellLog[]        @relation("UpsellLogger")
```

### Task 1.4: 마이그레이션 실행

```bash
cd /c/Users/user/AI_Chat/management-crm
npx prisma migrate dev --name add-upselling-system
```

---

## Phase 2: 권한 시스템 + 상수

### Task 2.1: 상수 확장

**Files:**
- Modify: `src/lib/constants.ts`

```typescript
// 기존 ROLES에 추가
export const ROLES = {
  ADMIN: 'admin',
  MANAGER_TEAM: 'manager_team',
  MANAGER: 'manager',
  STAFF: 'staff',
  UPSELLING_DIRECTOR: 'upselling_director',
  UPSELLING_CHIEF: 'upselling_chief',
  UPSELLING_STAFF: 'upselling_staff',
} as const;

export const UPSELLING_ROLES = [
  ROLES.UPSELLING_DIRECTOR,
  ROLES.UPSELLING_CHIEF,
  ROLES.UPSELLING_STAFF,
] as const;

export const ROLE_LABELS: Record<string, string> = {
  admin: '시스템관리자',
  manager_team: '관리팀',
  manager: '간부',
  staff: '영업자',
  upselling_director: '업셀링 실장',
  upselling_chief: '업셀링 주임',
  upselling_staff: '업셀링 사원',
};
```

### Task 2.2: 업셀링 권한 헬퍼

**Files:**
- Create: `src/lib/upsell-auth.ts`

```typescript
import { AuthPayload } from './auth';
import { ROLES } from './constants';

export function isUpsellRole(role: string): boolean {
  return ['upselling_director', 'upselling_chief', 'upselling_staff'].includes(role);
}

export function requireUpsellAuth(auth: AuthPayload): AuthPayload {
  if (!isUpsellRole(auth.role) && auth.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return auth;
}

// 실장: 주임/사원 관리 가능
// 주임: 사원 관리 가능
export function canManageUpsellUser(managerRole: string, targetRole: string): boolean {
  if (managerRole === 'admin') return true;
  if (managerRole === 'upselling_director') {
    return targetRole === 'upselling_chief' || targetRole === 'upselling_staff';
  }
  if (managerRole === 'upselling_chief') {
    return targetRole === 'upselling_staff';
  }
  return false;
}

// 분배 권한: 실장만
export function canDistribute(role: string): boolean {
  return role === 'admin' || role === 'upselling_director';
}

// 전체 결제건 조회: 실장 + 주임
export function canViewAllPayments(role: string): boolean {
  return role === 'admin' || role === 'upselling_director' || role === 'upselling_chief';
}

// 카드번호 조회: 간부 이상 (실장+주임)
export function canViewCardNumber(role: string): boolean {
  return role === 'admin' || role === 'upselling_director' || role === 'upselling_chief';
}
```

---

## Phase 3: 크롤러 — 카드사/결제금액 추가

### Task 3.1: 크롤러 스크래퍼 확장

**Files:**
- Modify: `crawler/src/scraper.ts` — CrawledCompany에 cardCompany, paymentAmount 추가
- Modify: `crawler/src/db.ts` — upsert에 새 필드 포함
- Modify: `crawler/prisma/schema.prisma` — Company에 cardCompany, paymentAmount 추가

크롤러가 결제 테이블에서 카드사 컬럼(column 8 또는 11)과 결제금액을 추출하도록 수정.

---

## Phase 4: 사이드바 메뉴 분기

### Task 4.1: 레이아웃 역할별 메뉴

**Files:**
- Modify: `src/app/(main)/layout.tsx`

업셀링 역할이면 업셀링 전용 메뉴만 표시:
- 대시보드 → `/upsell/dashboard`
- 업체 관리 → `/upsell/companies`
- 업체 분배 → `/upsell/distribution` (실장만)
- 팀원 관리 → `/upsell/users` (실장+주임)
- 활동 내역 → `/upsell/logs`
- 설정 → `/settings`

기존 영업팀 역할은 기존 메뉴 그대로.

---

## Phase 5: 업셀팀 계정 관리

### Task 5.1: 업셀팀 사용자 API

**Files:**
- Create: `src/app/api/upsell/users/route.ts`

GET: 내 하위 업셀링 유저 목록
POST: 하위 역할 유저 생성 (계층 검증)
PUT: 하위 역할 유저 수정 (계층 검증)
DELETE: 하위 역할 유저 삭제 (계층 검증)

- admin → 실장 생성
- 실장 → 주임/사원 생성/수정/삭제
- 주임 → 사원 생성/수정/삭제

### Task 5.2: 업셀팀 사용자 관리 페이지

**Files:**
- Create: `src/app/(main)/upsell/users/page.tsx`

기존 `/users/page.tsx` 패턴 참고하되 계층별 권한 적용.

---

## Phase 6: 전지사 업체 목록 + 분배

### Task 6.1: 업셀 업체 목록 API

**Files:**
- Create: `src/app/api/upsell/companies/route.ts`

GET: 전지사 Company 목록 (브랜치 필터 없음) + UpsellAssignment join
- 실장/주임: 전체 목록
- 사원: 자기에게 분배된 것만
- 검색, 페이지네이션, 날짜 필터
- 카드사 표시 (카드번호는 canViewCardNumber 체크)

### Task 6.2: 분배 API

**Files:**
- Create: `src/app/api/upsell/distribution/route.ts`

GET: 분배 현황 조회
POST: 업체 일괄 분배 (실장 → 주임/사원에게)
DELETE: 분배 취소

### Task 6.3: 업체 관리 페이지

**Files:**
- Create: `src/app/(main)/upsell/companies/page.tsx`

테이블 헤더:
결제일 | 계약 | 팀 | 업체명 | 대표자 | 담당자 | 간부 | 네이버계정 | 영수증 | 카카오맵 | 카카오채널 | 블로그스킨 | 노출갯수체크

기능:
- 검색 (업체명, 대표자)
- 날짜 필터
- 체크박스 선택 (검색/페이지 이동 시 유지)
- 카드사 뱃지 표시
- 결제금액 표시

### Task 6.4: 분배 페이지 (실장용)

**Files:**
- Create: `src/app/(main)/upsell/distribution/page.tsx`

좌측: 미분배 업체 목록 (체크박스, 검색)
우측: 팀원 목록 (주임/사원)
가운데: 분배 버튼 → 선택 업체를 선택 팀원에게 분배

---

## Phase 7: 업체 상세 + 상품 설정

### Task 7.1: 상품 CRUD API

**Files:**
- Create: `src/app/api/upsell/products/route.ts`
- Create: `src/app/api/upsell/products/[id]/route.ts`

POST: 상품 설정 생성/수정
- 파워링크: adId, adPassword
- 리뷰: reviewType, receiptTarget, kakaoTarget (합계 = totalTarget)
- 채널: channelType (kakao_channel | blog_skin)
- 기타: naverAccount, upsellAmount, contractStart/End

PUT: 개별 필드 수정 (노출갯수 등)

### Task 7.2: 업체 상세 페이지

**Files:**
- Create: `src/app/(main)/upsell/companies/[id]/page.tsx`

탭 구성:
1. **기본정보** — 업체 기본 + 결제 정보
2. **상품 설정** — 파워링크/리뷰/채널 설정 폼
3. **카카오맵 리뷰** — 리뷰 목록, 갱신, 확인 체크
4. **활동 내역** — 변경 로그

리뷰 영역:
- 영수증리뷰/카카오리뷰 개수 조절 슬라이더 (합계 고정, 한쪽 변경 시 나머지 자동 조정)
- 총 개수 수동 조절 가능 (추가)

---

## Phase 8: 카카오맵 연동

### Task 8.1: 카카오맵 검색 API

**Files:**
- Create: `src/app/api/upsell/kakaomap/search/route.ts`

Kakao Local REST API 사용:
```
GET https://dapi.kakao.com/v2/local/search/keyword.json
Authorization: KakaoAK {REST_API_KEY}
query={검색어}
```

응답: place_name, address_name, phone, place_url, id

### Task 8.2: 카카오맵 리뷰 크롤링 API

**Files:**
- Create: `src/app/api/upsell/kakaomap/reviews/route.ts`

카카오맵 place 페이지에서 리뷰 파싱:
- `https://place.map.kakao.com/{placeId}` 에서 리뷰 JSON 추출
- 또는 `https://place.map.kakao.com/main/v/{placeId}` API 활용
- 작성자, 제목(없으면 빈값), 내용, 별점 추출
- 기존 리뷰 대비 신규 리뷰 식별

### Task 8.3: 리뷰 확인 체크 기능

리뷰 목록에서 체크박스 → "확인" 버튼 → isOurs=true + confirmedAt/confirmedById 기록
수동 리뷰 추가: 직접 작성자/내용 입력 → isManual=true

---

## Phase 9: 대시보드 + 활동 내역

### Task 9.1: 대시보드 API + 페이지

**Files:**
- Create: `src/app/api/upsell/dashboard/route.ts`
- Create: `src/app/(main)/upsell/dashboard/page.tsx`

통계 카드:
- 전체 분배 업체 수
- 상품 설정 완료율
- 리뷰 진행률 (총 목표 대비 확인된 리뷰)
- 이번 달 업셀 매출
- 팀원별 분배/진행 현황

### Task 9.2: 활동 내역 API + 페이지

**Files:**
- Create: `src/app/api/upsell/logs/route.ts`
- Create: `src/app/(main)/upsell/logs/page.tsx`

---

## Phase 10: 고도화 기능

### Task 10.1: 계약 만료 알림
- 대시보드에 7일/30일 내 만료 업체 표시

### Task 10.2: 엑셀 내보내기
- 업체 목록 CSV/엑셀 다운로드

### Task 10.3: 업셀 매출 통계
- 월별/팀원별 매출 차트

### Task 10.4: 분배 이력 추적
- 누가 언제 누구에게 분배했는지 로그

---

## 기존 시스템 영향 분석

1. **users API**: validRoles 배열에 업셀링 3종 추가 필요 (admin이 실장 생성 시)
2. **auth API**: role payload에 변경 없음 (기존 구조 호환)
3. **middleware**: 변경 없음 (토큰 존재만 체크)
4. **기존 페이지**: 영향 없음 (업셀 메뉴는 완전 분리)
5. **Company 테이블**: cardCompany, paymentAmount 추가 (nullable, 기존 데이터 영향 없음)

# nplace-checker 설계 문서

> 네이버 플레이스 키워드 랭킹 가능성 분석 도구
> 작성일: 2026-03-02

---

## 1. 프로젝트 개요

### 1.1 목적
네이버 플레이스 고유번호 또는 URL을 입력하면 해당 매장의 업종 카테고리를 확인하고,
특정 키워드로 검색 시 해당 카테고리가 상위 노출 가능한지 판단하는 사내 분석 도구.

### 1.2 핵심 가치
- 키워드 작업 전 가능/불가능 사전 판단으로 시간/비용 절약
- 경쟁 카테고리 분석을 통한 전략 수립 근거 제공
- 전 직원이 통일된 기준으로 분석 가능

---

## 2. 기능 명세

### 2.1 플레이스 조회
- **입력 형태**:
  - 고유번호 (숫자, 예: `1234567890`)
  - 짧은 URL (`naver.me/xxxxx`)
  - 긴 URL (`map.naver.com/...`, `place.naver.com/...`, `m.place.naver.com/...`)
- **출력**:
  - 매장명, 업종 카테고리 (대/중/소), 주소, 영업 상태
  - 카테고리 코드 및 분류 체계
- **URL 정규화**: 모든 입력을 고유번호로 정규화 후 처리

### 2.2 키워드 랭킹 분석
- **입력**: 키워드 (복수 입력 가능, 쉼표/줄바꿈 구분)
- **처리 로직**:
  1. 키워드로 네이버 플레이스 검색
  2. 1페이지 결과에서 CPC 광고 제외
  3. 오가닉 결과 업체들의 카테고리 수집
  4. 내 매장 카테고리와 비교
- **출력**:
  - 판정: 가능(녹색) / 경계(황색) / 불가(적색)
  - 1페이지 카테고리 분포 (원형 차트)
  - 동일 카테고리 업체 수 / 전체 업체 수
  - 1페이지 업체 목록 (이름, 카테고리, 순위)

### 2.3 판정 기준
- **가능**: 1페이지 내 동일 카테고리 업체가 3개 이상
- **경계**: 1페이지 내 동일 카테고리 업체가 1~2개
- **불가**: 1페이지 내 동일 카테고리 업체가 0개
- (임계값은 어드민에서 조정 가능)

### 2.4 캐시 관리 (어드민)
- 캐시 목록 조회: 키워드, 고유번호, 캐시 생성 시간, TTL 잔여
- 검색: 키워드 또는 고유번호로 특정 캐시 검색
- 삭제: 개별 삭제 -> 다음 조회 시 실시간 재수집
- 전체 초기화: 시스템관리자만 가능

---

## 3. 아키텍처

### 3.1 전체 구조

```
[Electron PC앱]  [모바일앱]  [브라우저(관리)]
       |              |            |
       +------+-------+------------+
              |
         HTTPS (nginx)
         - SSL 종단
         - Rate Limiting
         - 요청 라우팅
              |
    +--------------------+
    |   FastAPI 백엔드    |
    |  (Python 3.12+)    |
    +--------------------+
       |        |       |
  [PostgreSQL] [Redis] [네이버 수집 엔진]
       |                    |
  [감사 로그]          [프록시 풀]
```

### 3.2 보안: 서버 IP/URL 은닉

사용자가 서버 주소를 절대 확인할 수 없도록 다중 레이어 보호:

1. **API Gateway 레이어**
   - 클라이언트는 직접 서버 IP에 접근하지 않음
   - Cloudflare Tunnel 또는 자체 도메인 + DNS Proxy 사용
   - 서버 IP가 DNS 조회로도 노출되지 않도록 프록시 처리

2. **클라이언트 코드 보호**
   - API base URL을 소스코드에 평문으로 저장하지 않음
   - 런타임에 환경 설정 서버에서 암호화된 엔드포인트를 받아 복호화
   - Electron: asar 패키징 + 코드 난독화 (javascript-obfuscator)
   - 네트워크 탭에서도 실제 서버 주소가 아닌 프록시 도메인만 노출

3. **Certificate Pinning** (모바일)
   - 서버 인증서 핀 고정으로 MITM 프록시 차단
   - 핀 불일치 시 연결 거부

4. **구현 방식**
   ```
   [앱] -> HTTPS -> [Cloudflare/프록시 도메인] -> [실제 서버 IP]
   ```
   - 앱에는 프록시 도메인만 하드코딩
   - 프록시 도메인도 난독화하여 저장
   - DevTools/네트워크 모니터링 감지 시 앱 동작 제한

### 3.3 기술 스택 상세

| 계층 | 기술 | 버전 | 선정 이유 |
|------|------|------|----------|
| **백엔드** | Python FastAPI | 0.115+ | 비동기 크롤링, 타입 안전, 자동 문서화 |
| **ORM** | SQLAlchemy 2.0 | Async | 마이그레이션 용이, Alembic 연동 |
| **마이그레이션** | Alembic | - | DB 스키마 버전 관리, 서버 이전 시 재현 가능 |
| **프론트엔드** | Next.js 15 | App Router | RSC, 서버 액션, 고성능 UI |
| **UI 라이브러리** | shadcn/ui + Tailwind | v4 | 프로덕션급 컴포넌트, 커스터마이징 자유 |
| **차트** | Recharts | - | React 네이티브 차트, 카테고리 분포 시각화 |
| **PC 앱** | Electron | 33+ | Chromium 기반, Next.js 앱 래핑 |
| **모바일** | Capacitor | - | 웹 코드 재사용, 네이티브 빌드 |
| **DB** | PostgreSQL 16 | pgvector | 구조화 데이터, JSON 지원, 확장성 |
| **캐시** | Redis 7 | - | TTL 기반 캐싱, 요청 큐 관리 |
| **크롤링** | httpx + playwright | async | 비공식 API는 httpx, 폴백은 playwright |
| **태스크 큐** | Celery + Redis | - | 백그라운드 크롤링, 배치 처리 |
| **컨테이너** | Docker Compose | - | 격리 배포, 마이그레이션 용이 |

---

## 4. 데이터 모델

### 4.1 핵심 테이블

```sql
-- 사용자
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
    parent_id INTEGER REFERENCES users(id),  -- 상위 관리자
    display_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 플레이스 정보 캐시
CREATE TABLE places (
    id SERIAL PRIMARY KEY,
    place_id VARCHAR(20) UNIQUE NOT NULL,      -- 네이버 고유번호
    name VARCHAR(200),
    category_full VARCHAR(500),                 -- 전체 카테고리 경로
    category_main VARCHAR(100),                 -- 대분류
    category_sub VARCHAR(100),                  -- 중분류
    category_detail VARCHAR(100),               -- 소분류
    address VARCHAR(500),
    road_address VARCHAR(500),
    business_status VARCHAR(50),
    raw_data JSONB,                             -- 원본 응답 전체
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,                     -- 캐시 만료 시간
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_places_place_id ON places(place_id);
CREATE INDEX idx_places_expires ON places(expires_at);

-- 키워드 검색 결과 캐시
CREATE TABLE keyword_results (
    id SERIAL PRIMARY KEY,
    keyword VARCHAR(200) NOT NULL,
    search_rank INTEGER NOT NULL,               -- 순위 (1~N)
    place_id VARCHAR(20),
    place_name VARCHAR(200),
    category_full VARCHAR(500),
    category_main VARCHAR(100),
    is_ad BOOLEAN DEFAULT FALSE,                -- CPC 광고 여부
    raw_data JSONB,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(keyword, search_rank, fetched_at)
);
CREATE INDEX idx_keyword_results_keyword ON keyword_results(keyword);
CREATE INDEX idx_keyword_results_expires ON keyword_results(expires_at);

-- 분석 이력
CREATE TABLE analysis_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    place_id VARCHAR(20),
    place_name VARCHAR(200),
    keyword VARCHAR(200),
    result VARCHAR(20) CHECK (result IN ('possible', 'borderline', 'impossible')),
    matched_count INTEGER,                      -- 동일 카테고리 업체 수
    total_count INTEGER,                        -- 1페이지 전체 업체 수
    category_distribution JSONB,                -- 카테고리별 분포
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_analysis_user ON analysis_history(user_id);
CREATE INDEX idx_analysis_created ON analysis_history(created_at);

-- 감사 로그
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,                -- 'login', 'search', 'cache_delete', 'user_create', ...
    target_type VARCHAR(50),                    -- 'place', 'keyword', 'user', 'cache'
    target_id VARCHAR(100),
    detail JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- 시스템 설정
CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description VARCHAR(500),
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 Redis 키 설계

```
npc:place:{place_id}          -> 플레이스 정보 JSON (TTL: 7일)
npc:keyword:{keyword_hash}    -> 키워드 검색 결과 JSON (TTL: 24시간)
npc:rate:{user_id}            -> 요청 카운터 (TTL: 60초)
npc:session:{token}           -> 세션 데이터 (TTL: 24시간)
npc:queue:pending             -> 수집 대기 큐 (List)
```

---

## 5. API 설계

### 5.1 인증
```
POST   /api/v1/auth/login          로그인 (JWT 발급)
POST   /api/v1/auth/refresh        토큰 갱신
POST   /api/v1/auth/logout         로그아웃
GET    /api/v1/auth/me             내 정보
```

### 5.2 플레이스
```
POST   /api/v1/place/lookup        플레이스 조회 (ID/URL 입력)
GET    /api/v1/place/{place_id}    플레이스 상세 (캐시된 정보)
```

### 5.3 키워드 분석
```
POST   /api/v1/analysis/check      키워드 랭킹 가능성 분석
GET    /api/v1/analysis/history     내 분석 이력
GET    /api/v1/analysis/{id}        분석 결과 상세
```

### 5.4 어드민 - 사용자 관리
```
GET    /api/v1/admin/users                 사용자 목록 (하위 계정만)
POST   /api/v1/admin/users                 사용자 생성
PATCH  /api/v1/admin/users/{id}            사용자 수정
PATCH  /api/v1/admin/users/{id}/status     활성/정지/비활성화
```

### 5.5 어드민 - 캐시 관리
```
GET    /api/v1/admin/cache                 캐시 목록 (키워드/플레이스)
GET    /api/v1/admin/cache/search          캐시 검색
DELETE /api/v1/admin/cache/{type}/{key}    특정 캐시 삭제
DELETE /api/v1/admin/cache/all             전체 캐시 초기화 (admin only)
```

### 5.6 어드민 - 감사 로그
```
GET    /api/v1/admin/audit-logs            감사 로그 조회 (필터, 페이지네이션)
GET    /api/v1/admin/audit-logs/export     감사 로그 내보내기 (CSV)
```

### 5.7 시스템
```
GET    /api/v1/system/settings             시스템 설정 조회
PATCH  /api/v1/system/settings             시스템 설정 변경 (admin only)
GET    /api/v1/health                      헬스체크
```

---

## 6. 권한 체계

### 6.1 역할별 권한 매트릭스

| 기능 | admin | manager | staff |
|------|-------|---------|-------|
| 플레이스 조회 | O | O | O |
| 키워드 분석 | O | O | O |
| 내 분석 이력 | O | O | O |
| 캐시 검색/삭제 | O | O | X |
| 캐시 전체 초기화 | O | X | X |
| 사용자 생성 | O (전체) | O (staff만) | X |
| 사용자 정지/비활성화 | O (전체) | O (하위만) | X |
| 감사 로그 조회 | O (전체) | O (하위만) | X |
| 시스템 설정 변경 | O | X | X |

### 6.2 계층 구조
```
시스템관리자 (admin)
  ├── 간부 A (manager)
  │     ├── 직원 1 (staff)
  │     └── 직원 2 (staff)
  └── 간부 B (manager)
        └── 직원 3 (staff)
```
- manager는 자신이 생성한 staff만 관리 가능
- admin은 모든 계정 관리 가능
- 퇴직 시 `deactivated` 처리 (데이터 보존, 로그인 불가)

---

## 7. 네이버 데이터 수집 엔진

### 7.1 수집 전략

1. **비공식 API 우선** (httpx async)
   - `map.naver.com` 내부 API 엔드포인트 활용
   - 플레이스 상세: `/v5/api/search/...`
   - 키워드 검색: 플레이스 검색 API
   - 장점: 빠르고 구조화된 JSON 응답

2. **스크래핑 폴백** (playwright async)
   - 비공식 API 실패 시 (구조 변경, 차단 등)
   - headless 브라우저로 실제 페이지 렌더링 후 파싱
   - 느리지만 안정적

### 7.2 차단 방지

- **요청 간격**: 키워드당 1~3초 랜덤 딜레이
- **User-Agent 로테이션**: 실제 브라우저 UA 풀에서 랜덤 선택
- **프록시 풀**: 환경변수로 프록시 목록 설정 가능 (선택)
- **요청 큐**: Celery로 순차 처리, 동시 요청 수 제한
- **재시도 전략**: 지수 백오프 (1s, 2s, 4s, max 3회)

### 7.3 CPC 광고 필터링

네이버 플레이스 검색 결과에서 CPC 광고 식별:
- API 응답의 `isAd`, `adId` 필드 체크
- HTML의 `ad` 클래스/마커 확인
- 광고 업체는 결과에서 제외하고 오가닉 순위만 사용

---

## 8. 프론트엔드 설계

### 8.1 페이지 구성

**일반 사용자 화면**
- `/` - 대시보드 (최근 분석 요약)
- `/analysis` - 분석 페이지 (플레이스 입력 + 키워드 입력 + 결과)
- `/history` - 내 분석 이력

**어드민 화면**
- `/admin/users` - 사용자 관리
- `/admin/cache` - 캐시 관리
- `/admin/audit` - 감사 로그
- `/admin/settings` - 시스템 설정

### 8.2 UI/UX 핵심 원칙

- **다크 모드 기본** + 라이트 모드 지원
- **애니메이션**: Framer Motion으로 부드러운 전환
- **반응형**: PC(1200px+), 태블릿(768px+), 모바일(~767px)
- **로딩 상태**: 스켈레톤 UI + 진행률 표시
- **에러 처리**: 토스트 알림 + 인라인 에러 메시지

---

## 9. 배포 구성

### 9.1 Docker Compose (서버 1.234.83.118)

```yaml
# 새로 추가되는 서비스
npc-api:       # FastAPI 백엔드 (포트 4000)
npc-frontend:  # Next.js 프론트엔드 (포트 4001)
npc-worker:    # Celery 워커 (크롤링 태스크)
npc-postgres:  # PostgreSQL (포트 5434) 또는 기존 인스턴스 DB 추가
npc-redis:     # Redis (포트 6381) 또는 기존 Redis DB 번호 분리
```

### 9.2 nginx 추가 설정
- 프록시 도메인으로 라우팅
- `/npc/api/` -> `127.0.0.1:4000`
- `/npc/` -> `127.0.0.1:4001`
- 또는 별도 서브도메인 사용

### 9.3 마이그레이션 전략
- **DB**: Alembic으로 스키마 버전 관리 -> 새 서버에서 `alembic upgrade head`
- **데이터**: `pg_dump` / `pg_restore`로 데이터 이전
- **환경**: `.env` 파일 하나로 전체 설정 관리
- **컨테이너**: `docker compose up -d`로 원커맨드 배포
- **볼륨**: named volume으로 데이터 영속화, 백업 스크립트 포함

---

## 10. 보안

### 10.1 인증/인가
- JWT 기반 인증 (access token 15분 + refresh token 7일)
- bcrypt 패스워드 해싱 (cost factor 12)
- 로그인 실패 5회 시 15분 잠금

### 10.2 서버 IP 은닉
- Cloudflare Tunnel 또는 자체 리버스 프록시 도메인 사용
- 클라이언트 앱에 도메인을 난독화하여 임베드
- Electron: asar 패키징 + 코드 난독화
- 모바일: Certificate Pinning + ProGuard 난독화
- 네트워크 탭 접근 시 경고 또는 기능 제한
- CORS 화이트리스트로 허용된 오리진만 접근

### 10.3 API 보안
- Rate Limiting: 사용자당 30req/min
- 입력값 검증: Pydantic 모델로 모든 입력 검증
- SQL Injection 방지: SQLAlchemy ORM 사용
- XSS 방지: 응답 데이터 이스케이프
- HTTPS 강제 (HTTP -> 301 리다이렉트)

---

## 11. 모니터링 및 운영

- 헬스체크 엔드포인트 (`/health`)
- 에러 로깅 (파일 + 구조화 로그)
- DB 커넥션 풀 모니터링
- 크롤링 성공/실패율 대시보드 (어드민)
- 디스크/메모리 사용량 알림 (선택)

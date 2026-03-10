# nplace-checker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 네이버 플레이스 키워드 랭킹 가능성 분석 사내 도구 - 프로덕션 레벨 구현

**Architecture:** Python FastAPI 백엔드(크롤링+API) + Next.js 15 프론트엔드(shadcn/ui) + PostgreSQL + Redis. Docker Compose로 기존 서버(1.234.83.118)에 격리 배포. Electron으로 PC앱, Capacitor로 모바일앱 래핑.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, httpx, playwright, Celery | Next.js 15, React 19, shadcn/ui, Tailwind CSS 4, Recharts, Framer Motion | PostgreSQL 16, Redis 7 | Docker Compose

**Working Directory:** `C:\Users\user\n-checker`

**Server:** `1.234.83.118` (ports: 4000 API, 4001 Frontend, 5434 PostgreSQL, 6381 Redis)

**Rate Limiting:** 사용자당 분당 300회 (사실상 제한 없음)

---

## Phase 1: 프로젝트 스캐폴딩

### Task 1.1: 모노레포 초기화

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`

**Step 1: 프로젝트 디렉토리 및 git 초기화**

```bash
cd C:\Users\user\n-checker
git init
```

**Step 2: 루트 package.json 작성**

```json
{
  "name": "nplace-checker",
  "private": true,
  "workspaces": ["frontend"],
  "scripts": {
    "dev:frontend": "cd frontend && npm run dev",
    "build:frontend": "cd frontend && npm run build"
  }
}
```

**Step 3: .gitignore 작성**

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
venv/
*.egg

# Node
node_modules/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
docker-data/

# Build
dist/
build/
release/

# Logs
*.log
logs/
```

**Step 4: .env.example 작성**

```env
# Database
POSTGRES_DB=nplace_checker
POSTGRES_USER=npc_user
POSTGRES_PASSWORD=change_me_in_production
DATABASE_URL=postgresql+asyncpg://npc_user:change_me_in_production@localhost:5434/nplace_checker

# Redis
REDIS_URL=redis://localhost:6381/0

# JWT
JWT_SECRET_KEY=change_me_32_char_random_string_here
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# App
APP_NAME=nplace-checker
APP_ENV=production
APP_DEBUG=false
LOG_LEVEL=INFO

# Naver Scraping
NAVER_REQUEST_DELAY_MIN=1.0
NAVER_REQUEST_DELAY_MAX=3.0
NAVER_MAX_CONCURRENT=2

# Cache TTL (seconds)
CACHE_PLACE_TTL=604800
CACHE_KEYWORD_TTL=86400

# Rate Limiting
RATE_LIMIT_PER_MINUTE=300

# Proxy (optional, comma-separated)
# PROXY_LIST=http://proxy1:8080,http://proxy2:8080

# Admin defaults
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me_admin_password
```

**Step 5: docker-compose.yml 작성 (프로덕션)**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-nplace_checker}
      POSTGRES_USER: ${POSTGRES_USER:-npc_user}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
    ports:
      - "127.0.0.1:5434:5432"
    volumes:
      - pgdata_npc:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-npc_user} -d ${POSTGRES_DB:-nplace_checker}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "127.0.0.1:6381:6379"
    volumes:
      - redis_npc:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  api:
    build:
      context: .
      dockerfile: infra/docker/api.Dockerfile
    ports:
      - "127.0.0.1:4000:4000"
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build:
      context: .
      dockerfile: infra/docker/worker.Dockerfile
    env_file:
      - .env
    depends_on:
      - api
      - redis
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: infra/docker/frontend.Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL:-/api}
    ports:
      - "127.0.0.1:4001:3000"
    environment:
      - API_URL=http://api:4000
      - HOSTNAME=0.0.0.0
    depends_on:
      - api
    restart: unless-stopped

volumes:
  pgdata_npc:
  redis_npc:
```

**Step 6: 디렉토리 구조 생성**

```bash
# Backend
mkdir -p backend/app/{api,core,models,schemas,services,scrapers}
mkdir -p backend/app/api/v1
mkdir -p backend/alembic/versions
mkdir -p backend/tests/{api,services,scrapers}

# Frontend
# (Next.js create-next-app으로 생성 예정)

# Infrastructure
mkdir -p infra/docker
mkdir -p infra/nginx

# Docs
mkdir -p docs/plans
```

**Step 7: 초기 커밋**

```bash
git add -A
git commit -m "chore: initialize nplace-checker project structure"
```

---

### Task 1.2: Python 백엔드 기초 설정

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/database.py`
- Create: `backend/app/core/redis.py`
- Create: `backend/app/core/security.py`
- Create: `infra/docker/api.Dockerfile`

**Step 1: pyproject.toml 작성**

```toml
[project]
name = "nplace-checker-api"
version = "1.0.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi[standard]>=0.115",
    "uvicorn[standard]>=0.32",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.30",
    "alembic>=1.14",
    "redis>=5.2",
    "httpx>=0.28",
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "python-jose[cryptography]>=3.3",
    "passlib[bcrypt]>=1.7",
    "celery[redis]>=5.4",
    "playwright>=1.49",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "pytest-cov>=6.0",
    "httpx",  # for TestClient
    "ruff>=0.8",
]

[tool.ruff]
target-version = "py312"
line-length = 120

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

**Step 2: core/config.py - 환경설정 (Pydantic Settings)**

```python
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # App
    app_name: str = "nplace-checker"
    app_env: str = "production"
    app_debug: bool = False
    log_level: str = "INFO"

    # Database
    database_url: str
    postgres_db: str = "nplace_checker"
    postgres_user: str = "npc_user"
    postgres_password: str = ""

    # Redis
    redis_url: str = "redis://localhost:6381/0"

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7

    # Naver Scraping
    naver_request_delay_min: float = 1.0
    naver_request_delay_max: float = 3.0
    naver_max_concurrent: int = 2

    # Cache TTL (seconds)
    cache_place_ttl: int = 604800       # 7 days
    cache_keyword_ttl: int = 86400      # 24 hours

    # Rate Limiting
    rate_limit_per_minute: int = 300

    # Proxy
    proxy_list: str = ""

    # Admin defaults
    admin_username: str = "admin"
    admin_password: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def proxies(self) -> list[str]:
        if not self.proxy_list:
            return []
        return [p.strip() for p in self.proxy_list.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

**Step 3: core/database.py - 비동기 DB 엔진**

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_async_engine(
    settings.database_url,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    echo=settings.app_debug,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
```

**Step 4: core/redis.py - Redis 클라이언트**

```python
import redis.asyncio as aioredis
from app.core.config import get_settings

settings = get_settings()
redis_client = aioredis.from_url(
    settings.redis_url,
    encoding="utf-8",
    decode_responses=True,
    max_connections=50,
)


async def get_redis() -> aioredis.Redis:
    return redis_client
```

**Step 5: core/security.py - JWT + 비밀번호 해싱**

```python
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from app.core.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    return jwt.encode({**data, "exp": expire, "type": "access"}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(data: dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_token_expire_days)
    return jwt.encode({**data, "exp": expire, "type": "refresh"}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
```

**Step 6: app/main.py - FastAPI 앱 엔트리포인트**

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.core.database import engine, Base
from app.core.redis import redis_client

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # shutdown
    await redis_client.close()
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    docs_url="/docs" if settings.app_debug else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_debug else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "healthy"}
```

**Step 7: Dockerfile 작성**

```dockerfile
# infra/docker/api.Dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" || pip install --no-cache-dir .

# Install playwright browsers
RUN playwright install chromium --with-deps

COPY backend/ ./

EXPOSE 4000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4000", "--workers", "2"]
```

**Step 8: 커밋**

```bash
git add -A
git commit -m "feat: add FastAPI backend foundation with config, DB, Redis, JWT"
```

---

### Task 1.3: 데이터베이스 모델 및 마이그레이션

**Files:**
- Create: `backend/app/models/user.py`
- Create: `backend/app/models/place.py`
- Create: `backend/app/models/keyword_result.py`
- Create: `backend/app/models/analysis.py`
- Create: `backend/app/models/audit_log.py`
- Create: `backend/app/models/system_setting.py`
- Create: `backend/app/models/__init__.py`
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`

**Step 1: 모든 SQLAlchemy 모델 작성**

`backend/app/models/user.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # admin, manager, staff
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, suspended, deactivated
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    parent = relationship("User", remote_side="User.id", lazy="selectin")

    __table_args__ = (
        Index("idx_users_username", "username"),
        Index("idx_users_parent", "parent_id"),
        Index("idx_users_status", "status"),
    )
```

`backend/app/models/place.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class Place(Base):
    __tablename__ = "places"

    id: Mapped[int] = mapped_column(primary_key=True)
    place_id: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(200))
    category_full: Mapped[str | None] = mapped_column(String(500))
    category_main: Mapped[str | None] = mapped_column(String(100))
    category_sub: Mapped[str | None] = mapped_column(String(100))
    category_detail: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(String(500))
    road_address: Mapped[str | None] = mapped_column(String(500))
    business_status: Mapped[str | None] = mapped_column(String(50))
    raw_data: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_places_place_id", "place_id"),
        Index("idx_places_expires", "expires_at"),
    )
```

`backend/app/models/keyword_result.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, DateTime, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class KeywordResult(Base):
    __tablename__ = "keyword_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    keyword: Mapped[str] = mapped_column(String(200), nullable=False)
    search_rank: Mapped[int] = mapped_column(Integer, nullable=False)
    place_id: Mapped[str | None] = mapped_column(String(20))
    place_name: Mapped[str | None] = mapped_column(String(200))
    category_full: Mapped[str | None] = mapped_column(String(500))
    category_main: Mapped[str | None] = mapped_column(String(100))
    is_ad: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_data: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_kr_keyword", "keyword"),
        Index("idx_kr_expires", "expires_at"),
    )
```

`backend/app/models/analysis.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    place_id: Mapped[str | None] = mapped_column(String(20))
    place_name: Mapped[str | None] = mapped_column(String(200))
    keyword: Mapped[str] = mapped_column(String(200), nullable=False)
    result: Mapped[str] = mapped_column(String(20), nullable=False)  # possible, borderline, impossible
    matched_count: Mapped[int] = mapped_column(Integer, default=0)
    total_count: Mapped[int] = mapped_column(Integer, default=0)
    category_distribution: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_ah_user", "user_id"),
        Index("idx_ah_created", "created_at"),
        Index("idx_ah_keyword", "keyword"),
    )
```

`backend/app/models/audit_log.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB, INET
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(50))
    target_id: Mapped[str | None] = mapped_column(String(100))
    detail: Mapped[dict | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_audit_user", "user_id"),
        Index("idx_audit_action", "action"),
        Index("idx_audit_created", "created_at"),
    )
```

`backend/app/models/system_setting.py`:
```python
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

`backend/app/models/__init__.py`:
```python
from app.models.user import User
from app.models.place import Place
from app.models.keyword_result import KeywordResult
from app.models.analysis import AnalysisHistory
from app.models.audit_log import AuditLog
from app.models.system_setting import SystemSetting

__all__ = ["User", "Place", "KeywordResult", "AnalysisHistory", "AuditLog", "SystemSetting"]
```

**Step 2: Alembic 설정**

`backend/alembic.ini`:
```ini
[alembic]
script_location = alembic
sqlalchemy.url = driver://user:pass@localhost/dbname

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

`backend/alembic/env.py`:
```python
import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context
from app.core.config import get_settings
from app.core.database import Base
from app.models import *  # noqa: F401,F403 - ensure all models are registered

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url.replace("+asyncpg", ""))


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    cfg = config.get_section(config.config_ini_section, {})
    cfg["sqlalchemy.url"] = settings.database_url
    connectable = async_engine_from_config(cfg, prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online():
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add database models and Alembic migration setup"
```

---

## Phase 2: 인증 및 사용자 관리 API

### Task 2.1: Pydantic 스키마 정의

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/auth.py`
- Create: `backend/app/schemas/user.py`
- Create: `backend/app/schemas/common.py`

**Step 1: 공통 스키마**

`backend/app/schemas/common.py`:
```python
from pydantic import BaseModel


class MessageResponse(BaseModel):
    message: str


class PaginatedParams(BaseModel):
    page: int = 1
    per_page: int = 20


class PaginatedResponse(BaseModel):
    total: int
    page: int
    per_page: int
    pages: int
```

**Step 2: 인증 스키마**

`backend/app/schemas/auth.py`:
```python
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str
```

**Step 3: 사용자 스키마**

`backend/app/schemas/user.py`:
```python
from datetime import datetime
from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=8, max_length=100)
    display_name: str = Field(min_length=1, max_length=100)
    role: str = Field(pattern="^(manager|staff)$")


class UserUpdate(BaseModel):
    display_name: str | None = None
    password: str | None = Field(None, min_length=8, max_length=100)


class UserStatusUpdate(BaseModel):
    status: str = Field(pattern="^(active|suspended|deactivated)$")


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    status: str
    parent_id: int | None
    last_login_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

**Step 4: 커밋**

```bash
git add -A
git commit -m "feat: add Pydantic request/response schemas"
```

---

### Task 2.2: 인증 미들웨어 및 의존성

**Files:**
- Create: `backend/app/core/deps.py`
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/audit.py`

**Step 1: 인증 의존성 (deps.py)**

```python
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


def require_role(*roles: str):
    async def checker(user: User = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user
    return checker
```

**Step 2: 감사 로그 서비스 (audit.py)**

```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit_log import AuditLog


async def log_audit(
    db: AsyncSession,
    user_id: int | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: dict | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
):
    entry = AuditLog(
        user_id=user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(entry)
    await db.commit()
```

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add auth dependencies and audit logging service"
```

---

### Task 2.3: 인증 API 라우터

**Files:**
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/v1/__init__.py`
- Create: `backend/app/api/v1/auth.py`
- Modify: `backend/app/main.py` (라우터 등록)

**Step 1: auth.py 라우터**

```python
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.schemas.user import UserResponse
from app.schemas.common import MessageResponse
from app.services.audit import log_audit

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_LOCK_THRESHOLD = 5
LOGIN_LOCK_MINUTES = 15


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is not active")

    # 잠금 확인
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Account temporarily locked")

    if not verify_password(body.password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= LOGIN_LOCK_THRESHOLD:
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=LOGIN_LOCK_MINUTES)
        await db.commit()
        await log_audit(db, user.id, "login_failed", ip_address=request.client.host if request.client else None)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # 로그인 성공
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    token_data = {"sub": str(user.id), "role": user.role}
    await log_audit(db, user.id, "login", ip_address=request.client.host if request.client else None)

    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    result = await db.execute(select(User).where(User.id == int(payload["sub"])))
    user = result.scalar_one_or_none()
    if not user or user.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    token_data = {"sub": str(user.id), "role": user.role}
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
    )


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return user


@router.post("/logout", response_model=MessageResponse)
async def logout(user: User = Depends(get_current_user)):
    # JWT는 stateless이므로 서버 측 무효화 없음
    # 클라이언트에서 토큰을 삭제하도록 안내
    return MessageResponse(message="Logged out successfully")
```

**Step 2: main.py에 라우터 등록**

`app/main.py`에 추가:
```python
from app.api.v1.auth import router as auth_router

# lifespan 아래, health 엔드포인트 위에 추가
app.include_router(auth_router, prefix="/api/v1")
```

**Step 3: 초기 admin 계정 시딩 (lifespan에 추가)**

`app/main.py` lifespan 내부 startup에 추가:
```python
from sqlalchemy import select
from app.models.user import User
from app.core.security import hash_password

# startup 부분에 추가
async with async_session() as session:
    result = await session.execute(select(User).where(User.username == settings.admin_username))
    if not result.scalar_one_or_none():
        admin = User(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            role="admin",
            display_name="시스템 관리자",
            status="active",
        )
        session.add(admin)
        await session.commit()
```

**Step 4: 커밋**

```bash
git add -A
git commit -m "feat: add auth API with login, refresh, logout, admin seeding"
```

---

### Task 2.4: 사용자 관리 API (어드민)

**Files:**
- Create: `backend/app/api/v1/users.py`
- Modify: `backend/app/main.py` (라우터 등록)

**Step 1: users.py 라우터**

```python
from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from app.core.database import get_db
from app.core.security import hash_password
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate, UserStatusUpdate, UserResponse
from app.schemas.common import MessageResponse
from app.services.audit import log_audit

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def _can_manage(manager: User, target: User) -> bool:
    """manager가 target을 관리할 수 있는지 확인"""
    if manager.role == "admin":
        return True
    if manager.role == "manager" and target.parent_id == manager.id:
        return True
    return False


def _get_subordinate_filter(user: User):
    """하위 계정 필터 조건 반환"""
    if user.role == "admin":
        return True  # 전체
    return User.parent_id == user.id


@router.get("", response_model=list[UserResponse])
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role not in ("admin", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    query = select(User)
    if user.role == "manager":
        query = query.where(User.parent_id == user.id)
    if status_filter:
        query = query.where(User.status == status_filter)
    if search:
        query = query.where(or_(User.username.ilike(f"%{search}%"), User.display_name.ilike(f"%{search}%")))

    query = query.order_by(User.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=UserResponse)
async def create_user(
    body: UserCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.role == "staff":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
    if user.role == "manager" and body.role != "staff":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managers can only create staff accounts")

    # 중복 확인
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    new_user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        display_name=body.display_name,
        parent_id=user.id,
        status="active",
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    await log_audit(db, user.id, "user_create", "user", str(new_user.id),
                    detail={"username": body.username, "role": body.role},
                    ip_address=request.client.host if request.client else None)

    return new_user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not _can_manage(user, target):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage this user")

    if body.display_name is not None:
        target.display_name = body.display_name
    if body.password is not None:
        target.password_hash = hash_password(body.password)

    await db.commit()
    await db.refresh(target)

    await log_audit(db, user.id, "user_update", "user", str(user_id),
                    ip_address=request.client.host if request.client else None)
    return target


@router.patch("/{user_id}/status", response_model=UserResponse)
async def update_user_status(
    user_id: int,
    body: UserStatusUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not _can_manage(user, target):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage this user")
    if target.id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change own status")

    old_status = target.status
    target.status = body.status
    await db.commit()
    await db.refresh(target)

    await log_audit(db, user.id, "user_status_change", "user", str(user_id),
                    detail={"from": old_status, "to": body.status},
                    ip_address=request.client.host if request.client else None)
    return target
```

**Step 2: main.py에 라우터 등록**

```python
from app.api.v1.users import router as users_router
app.include_router(users_router, prefix="/api/v1")
```

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add user management API with role-based access control"
```

---

## Phase 3: 네이버 데이터 수집 엔진

### Task 3.1: URL 파서 및 플레이스 ID 추출

**Files:**
- Create: `backend/app/scrapers/__init__.py`
- Create: `backend/app/scrapers/url_parser.py`
- Create: `backend/tests/scrapers/__init__.py`
- Create: `backend/tests/scrapers/test_url_parser.py`

**Step 1: 테스트 작성**

```python
# tests/scrapers/test_url_parser.py
import pytest
from app.scrapers.url_parser import extract_place_id


@pytest.mark.parametrize("input_val,expected", [
    ("1234567890", "1234567890"),
    ("https://m.place.naver.com/restaurant/1234567890", "1234567890"),
    ("https://place.naver.com/restaurant/1234567890/home", "1234567890"),
    ("https://map.naver.com/v5/search/맛집/place/1234567890", "1234567890"),
    ("https://map.naver.com/p/search/카페/place/1234567890?c=15.00", "1234567890"),
    ("place.naver.com/hospital/9876543210", "9876543210"),
])
def test_extract_place_id_direct(input_val, expected):
    result = extract_place_id(input_val)
    assert result == expected


def test_extract_place_id_invalid():
    assert extract_place_id("not_a_url_or_id") is None
    assert extract_place_id("") is None
```

**Step 2: URL 파서 구현**

```python
# app/scrapers/url_parser.py
import re
import httpx


# 네이버 플레이스 URL에서 고유번호를 추출하는 패턴들
PLACE_ID_PATTERNS = [
    r"place\.naver\.com/\w+/(\d{7,15})",          # place.naver.com/restaurant/12345
    r"map\.naver\.com/.+/place/(\d{7,15})",        # map.naver.com/v5/search/.../place/12345
    r"naver\.me/\w+",                               # 짧은 URL (리다이렉트 필요)
]

PURE_ID_PATTERN = re.compile(r"^\d{7,15}$")


def extract_place_id(input_val: str) -> str | None:
    """입력값에서 네이버 플레이스 고유번호를 추출한다."""
    input_val = input_val.strip()
    if not input_val:
        return None

    # 순수 숫자 (고유번호 직접 입력)
    if PURE_ID_PATTERN.match(input_val):
        return input_val

    # URL 패턴 매칭
    for pattern in PLACE_ID_PATTERNS:
        match = re.search(pattern, input_val)
        if match and match.group(1) if match.lastindex else None:
            return match.group(1)

    # 숫자 ID가 URL 어딘가에 있는 경우 폴백
    fallback = re.search(r"/(\d{7,15})(?:[/?#]|$)", input_val)
    if fallback:
        return fallback.group(1)

    return None


async def resolve_short_url(short_url: str) -> str | None:
    """naver.me 짧은 URL을 리다이렉트하여 실제 URL을 얻는다."""
    if not short_url.startswith("http"):
        short_url = f"https://{short_url}"

    try:
        async with httpx.AsyncClient(follow_redirects=False) as client:
            resp = await client.head(short_url, timeout=10)
            if resp.status_code in (301, 302):
                location = resp.headers.get("location", "")
                return location
    except httpx.HTTPError:
        pass
    return None


async def parse_input_to_place_id(input_val: str) -> str | None:
    """모든 형태의 입력을 플레이스 ID로 변환한다."""
    # 먼저 직접 추출 시도
    place_id = extract_place_id(input_val)
    if place_id:
        return place_id

    # 짧은 URL이면 리다이렉트 후 재시도
    if "naver.me" in input_val:
        resolved = await resolve_short_url(input_val)
        if resolved:
            return extract_place_id(resolved)

    return None
```

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add URL parser to extract Naver Place IDs from any input format"
```

---

### Task 3.2: 네이버 플레이스 정보 수집기

**Files:**
- Create: `backend/app/scrapers/naver_place.py`
- Create: `backend/app/scrapers/user_agents.py`

**Step 1: User-Agent 풀**

```python
# app/scrapers/user_agents.py
import random

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]


def random_ua() -> str:
    return random.choice(USER_AGENTS)
```

**Step 2: 플레이스 정보 수집기**

```python
# app/scrapers/naver_place.py
import asyncio
import random
import logging
import httpx
from app.scrapers.user_agents import random_ua
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def _delay():
    """요청 간 랜덤 딜레이"""
    await asyncio.sleep(random.uniform(settings.naver_request_delay_min, settings.naver_request_delay_max))


def _get_client_kwargs() -> dict:
    """httpx 클라이언트 옵션"""
    kwargs = {
        "headers": {
            "User-Agent": random_ua(),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Referer": "https://map.naver.com/",
        },
        "timeout": 15.0,
        "follow_redirects": True,
    }
    proxies = settings.proxies
    if proxies:
        kwargs["proxy"] = random.choice(proxies)
    return kwargs


async def fetch_place_info(place_id: str) -> dict | None:
    """네이버 플레이스 상세 정보를 가져온다.

    비공식 API를 먼저 시도하고, 실패 시 대체 엔드포인트를 시도한다.
    """
    endpoints = [
        f"https://map.naver.com/p/api/search/allSearch?query={place_id}&type=all",
        f"https://map.naver.com/p/api/place/summary/{place_id}",
        f"https://pcmap-api.place.naver.com/place/graphql",
    ]

    # 방법 1: place summary API
    try:
        async with httpx.AsyncClient(**_get_client_kwargs()) as client:
            resp = await client.get(
                f"https://pcmap-api.place.naver.com/place/graphql",
                params={
                    "operationName": "getPlaceDetail",
                    "variables": f'{{"input":{{"deviceType":"pcmap","id":"{place_id}","isNx":false}}}}',
                    "extensions": '{"persistedQuery":{"version":1}}',
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return _parse_graphql_response(data, place_id)
    except Exception as e:
        logger.warning(f"GraphQL API failed for {place_id}: {e}")

    await _delay()

    # 방법 2: 구 API 직접 조회
    try:
        async with httpx.AsyncClient(**_get_client_kwargs()) as client:
            resp = await client.get(f"https://map.naver.com/p/api/place/summary/{place_id}")
            if resp.status_code == 200:
                data = resp.json()
                return _parse_summary_response(data, place_id)
    except Exception as e:
        logger.warning(f"Summary API failed for {place_id}: {e}")

    await _delay()

    # 방법 3: 검색으로 폴백
    try:
        async with httpx.AsyncClient(**_get_client_kwargs()) as client:
            resp = await client.get(
                "https://map.naver.com/p/api/search/allSearch",
                params={"query": place_id, "type": "all", "searchCoord": "126.978;37.566", "boundary": ""},
            )
            if resp.status_code == 200:
                data = resp.json()
                return _parse_search_response(data, place_id)
    except Exception as e:
        logger.warning(f"Search API failed for {place_id}: {e}")

    return None


def _parse_graphql_response(data: dict, place_id: str) -> dict | None:
    """GraphQL 응답에서 플레이스 정보 추출"""
    try:
        # 응답 구조는 변경될 수 있으므로 안전하게 탐색
        result = data.get("data", {}).get("placeDetail", {}).get("basicInfo", {})
        if not result:
            # 다른 경로 시도
            for key in data.get("data", {}):
                if isinstance(data["data"][key], dict):
                    result = data["data"][key].get("basicInfo", result)

        if not result:
            return None

        categories = result.get("category", {})
        category_list = categories.get("cateName", "").split(">") if isinstance(categories, dict) else []

        return {
            "place_id": place_id,
            "name": result.get("name", ""),
            "category_full": categories.get("cateName", "") if isinstance(categories, dict) else str(categories),
            "category_main": category_list[0].strip() if len(category_list) > 0 else None,
            "category_sub": category_list[1].strip() if len(category_list) > 1 else None,
            "category_detail": category_list[2].strip() if len(category_list) > 2 else None,
            "address": result.get("address", {}).get("addr", ""),
            "road_address": result.get("address", {}).get("roadAddr", ""),
            "business_status": result.get("businessStatus", {}).get("status", ""),
            "raw_data": data,
        }
    except Exception as e:
        logger.error(f"Failed to parse GraphQL response: {e}")
        return None


def _parse_summary_response(data: dict, place_id: str) -> dict | None:
    """Summary API 응답 파싱"""
    try:
        name = data.get("name", "")
        category = data.get("category", "")
        cats = [c.strip() for c in category.split(">")]

        return {
            "place_id": place_id,
            "name": name,
            "category_full": category,
            "category_main": cats[0] if len(cats) > 0 else None,
            "category_sub": cats[1] if len(cats) > 1 else None,
            "category_detail": cats[2] if len(cats) > 2 else None,
            "address": data.get("address", ""),
            "road_address": data.get("roadAddress", ""),
            "business_status": data.get("businessStatus", ""),
            "raw_data": data,
        }
    except Exception as e:
        logger.error(f"Failed to parse summary response: {e}")
        return None


def _parse_search_response(data: dict, place_id: str) -> dict | None:
    """검색 API 응답에서 해당 place_id의 정보를 찾는다"""
    try:
        results = data.get("result", {}).get("place", {}).get("list", [])
        for item in results:
            if str(item.get("id")) == str(place_id):
                category = item.get("category", "")
                cats = [c.strip() for c in category.split(">")]
                return {
                    "place_id": place_id,
                    "name": item.get("name", ""),
                    "category_full": category,
                    "category_main": cats[0] if len(cats) > 0 else None,
                    "category_sub": cats[1] if len(cats) > 1 else None,
                    "category_detail": cats[2] if len(cats) > 2 else None,
                    "address": item.get("address", ""),
                    "road_address": item.get("roadAddress", ""),
                    "business_status": "",
                    "raw_data": item,
                }
    except Exception as e:
        logger.error(f"Failed to parse search response: {e}")
    return None


async def search_keyword_places(keyword: str, display_count: int = 30) -> list[dict]:
    """키워드로 네이버 플레이스를 검색하여 1페이지 결과를 반환한다.

    CPC 광고는 is_ad=True로 마킹한다.
    """
    results = []

    try:
        async with httpx.AsyncClient(**_get_client_kwargs()) as client:
            resp = await client.get(
                "https://map.naver.com/p/api/search/allSearch",
                params={
                    "query": keyword,
                    "type": "all",
                    "searchCoord": "126.978;37.566",
                    "displayCount": str(display_count),
                    "isPlaceRecommendationReplace": "true",
                    "lang": "ko",
                },
            )
            if resp.status_code != 200:
                logger.warning(f"Keyword search failed for '{keyword}': HTTP {resp.status_code}")
                return results

            data = resp.json()
            place_list = data.get("result", {}).get("place", {}).get("list", [])

            for rank, item in enumerate(place_list, 1):
                is_ad = bool(item.get("isAdPlace")) or bool(item.get("adId"))
                category = item.get("category", "")
                cats = [c.strip() for c in category.split(">")]

                results.append({
                    "search_rank": rank,
                    "place_id": str(item.get("id", "")),
                    "place_name": item.get("name", ""),
                    "category_full": category,
                    "category_main": cats[0] if len(cats) > 0 else None,
                    "is_ad": is_ad,
                    "raw_data": item,
                })

    except Exception as e:
        logger.error(f"Keyword search error for '{keyword}': {e}")

    return results
```

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add Naver Place scraper with multi-endpoint fallback"
```

---

## Phase 4: 핵심 분석 기능 API

### Task 4.1: 플레이스 조회 서비스 + API

**Files:**
- Create: `backend/app/services/place.py`
- Create: `backend/app/api/v1/place.py`
- Create: `backend/app/schemas/place.py`

**Step 1: 플레이스 스키마**

```python
# app/schemas/place.py
from datetime import datetime
from pydantic import BaseModel


class PlaceLookupRequest(BaseModel):
    input: str  # 고유번호, URL 등


class PlaceResponse(BaseModel):
    place_id: str
    name: str | None
    category_full: str | None
    category_main: str | None
    category_sub: str | None
    category_detail: str | None
    address: str | None
    road_address: str | None
    business_status: str | None
    fetched_at: datetime
    from_cache: bool = False

    model_config = {"from_attributes": True}
```

**Step 2: 플레이스 서비스 (캐시 연동)**

```python
# app/services/place.py
import json
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import get_settings
from app.core.redis import redis_client
from app.models.place import Place
from app.scrapers.url_parser import parse_input_to_place_id
from app.scrapers.naver_place import fetch_place_info

logger = logging.getLogger(__name__)
settings = get_settings()

REDIS_PREFIX = "npc:place:"


async def lookup_place(input_val: str, db: AsyncSession) -> dict | None:
    """플레이스 조회: 캐시 확인 -> 없으면 수집 -> 저장"""
    place_id = await parse_input_to_place_id(input_val)
    if not place_id:
        return None

    # 1. Redis 캐시 확인
    cached = await redis_client.get(f"{REDIS_PREFIX}{place_id}")
    if cached:
        data = json.loads(cached)
        data["from_cache"] = True
        return data

    # 2. DB 캐시 확인 (만료되지 않은 것)
    result = await db.execute(
        select(Place).where(Place.place_id == place_id, Place.expires_at > datetime.now(timezone.utc))
    )
    db_place = result.scalar_one_or_none()
    if db_place:
        data = _place_to_dict(db_place)
        data["from_cache"] = True
        # Redis에도 캐싱
        await redis_client.setex(
            f"{REDIS_PREFIX}{place_id}",
            settings.cache_place_ttl,
            json.dumps(data, default=str),
        )
        return data

    # 3. 네이버에서 실시간 수집
    info = await fetch_place_info(place_id)
    if not info:
        return None

    # DB에 저장 (upsert)
    existing = await db.execute(select(Place).where(Place.place_id == place_id))
    place = existing.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=settings.cache_place_ttl)

    if place:
        for key, val in info.items():
            if key != "raw_data" and hasattr(place, key):
                setattr(place, key, val)
        place.raw_data = info.get("raw_data")
        place.fetched_at = now
        place.expires_at = expires
    else:
        place = Place(
            place_id=info["place_id"],
            name=info.get("name"),
            category_full=info.get("category_full"),
            category_main=info.get("category_main"),
            category_sub=info.get("category_sub"),
            category_detail=info.get("category_detail"),
            address=info.get("address"),
            road_address=info.get("road_address"),
            business_status=info.get("business_status"),
            raw_data=info.get("raw_data"),
            fetched_at=now,
            expires_at=expires,
        )
        db.add(place)

    await db.commit()
    await db.refresh(place)

    data = _place_to_dict(place)
    data["from_cache"] = False

    # Redis에 캐싱
    await redis_client.setex(
        f"{REDIS_PREFIX}{place_id}",
        settings.cache_place_ttl,
        json.dumps(data, default=str),
    )

    return data


def _place_to_dict(place: Place) -> dict:
    return {
        "place_id": place.place_id,
        "name": place.name,
        "category_full": place.category_full,
        "category_main": place.category_main,
        "category_sub": place.category_sub,
        "category_detail": place.category_detail,
        "address": place.address,
        "road_address": place.road_address,
        "business_status": place.business_status,
        "fetched_at": place.fetched_at.isoformat() if place.fetched_at else None,
    }
```

**Step 3: 플레이스 API 라우터**

```python
# app/api/v1/place.py
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.place import PlaceLookupRequest, PlaceResponse
from app.services.place import lookup_place
from app.services.audit import log_audit

router = APIRouter(prefix="/place", tags=["place"])


@router.post("/lookup", response_model=PlaceResponse)
async def place_lookup(
    body: PlaceLookupRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await lookup_place(body.input, db)
    if not result:
        raise HTTPException(status_code=404, detail="Place not found or invalid input")

    await log_audit(db, user.id, "place_lookup", "place", result["place_id"],
                    detail={"input": body.input, "from_cache": result.get("from_cache", False)},
                    ip_address=request.client.host if request.client else None)

    return result
```

**Step 4: main.py에 라우터 등록**

```python
from app.api.v1.place import router as place_router
app.include_router(place_router, prefix="/api/v1")
```

**Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add place lookup with Redis/DB caching and Naver scraping"
```

---

### Task 4.2: 키워드 분석 서비스 + API

**Files:**
- Create: `backend/app/services/analysis.py`
- Create: `backend/app/api/v1/analysis.py`
- Create: `backend/app/schemas/analysis.py`

**Step 1: 분석 스키마**

```python
# app/schemas/analysis.py
from datetime import datetime
from pydantic import BaseModel, Field


class AnalysisRequest(BaseModel):
    place_input: str                          # 플레이스 ID 또는 URL
    keywords: list[str] = Field(min_length=1, max_length=20)  # 키워드 목록


class KeywordAnalysisResult(BaseModel):
    keyword: str
    result: str                               # possible, borderline, impossible
    matched_count: int                        # 동일 카테고리 업체 수
    total_count: int                          # 1페이지 전체 업체 수 (광고 제외)
    my_category: str | None                   # 내 업종 카테고리
    top_categories: list[dict]                # [{category, count, percentage}]
    top_places: list[dict]                    # [{rank, name, category, place_id, is_ad}]
    from_cache: bool = False


class AnalysisResponse(BaseModel):
    place: dict                               # PlaceResponse와 동일
    results: list[KeywordAnalysisResult]


class AnalysisHistoryResponse(BaseModel):
    id: int
    place_id: str | None
    place_name: str | None
    keyword: str
    result: str
    matched_count: int
    total_count: int
    category_distribution: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

**Step 2: 분석 서비스**

```python
# app/services/analysis.py
import json
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from collections import Counter
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import get_settings
from app.core.redis import redis_client
from app.models.keyword_result import KeywordResult
from app.models.analysis import AnalysisHistory
from app.scrapers.naver_place import search_keyword_places

logger = logging.getLogger(__name__)
settings = get_settings()

REDIS_PREFIX = "npc:keyword:"


def _keyword_hash(keyword: str) -> str:
    return hashlib.md5(keyword.encode()).hexdigest()


async def analyze_keyword(
    keyword: str,
    my_category_main: str | None,
    db: AsyncSession,
) -> dict:
    """키워드 검색 결과를 분석하여 랭킹 가능성을 판단한다."""
    keyword = keyword.strip()
    cache_key = f"{REDIS_PREFIX}{_keyword_hash(keyword)}"

    # 1. Redis 캐시 확인
    cached = await redis_client.get(cache_key)
    places_data = None
    from_cache = False

    if cached:
        places_data = json.loads(cached)
        from_cache = True
    else:
        # 2. DB 캐시 확인
        result = await db.execute(
            select(KeywordResult).where(
                KeywordResult.keyword == keyword,
                KeywordResult.expires_at > datetime.now(timezone.utc),
            ).order_by(KeywordResult.search_rank)
        )
        db_results = result.scalars().all()

        if db_results:
            places_data = [
                {
                    "search_rank": r.search_rank,
                    "place_id": r.place_id,
                    "place_name": r.place_name,
                    "category_full": r.category_full,
                    "category_main": r.category_main,
                    "is_ad": r.is_ad,
                }
                for r in db_results
            ]
            from_cache = True

    # 3. 실시간 수집
    if not places_data:
        raw_results = await search_keyword_places(keyword)
        if not raw_results:
            return _empty_result(keyword, my_category_main)

        places_data = raw_results
        now = datetime.now(timezone.utc)
        expires = now + timedelta(seconds=settings.cache_keyword_ttl)

        # DB에 저장
        for item in raw_results:
            kr = KeywordResult(
                keyword=keyword,
                search_rank=item["search_rank"],
                place_id=item.get("place_id"),
                place_name=item.get("place_name"),
                category_full=item.get("category_full"),
                category_main=item.get("category_main"),
                is_ad=item.get("is_ad", False),
                raw_data=item.get("raw_data"),
                fetched_at=now,
                expires_at=expires,
            )
            db.add(kr)
        await db.commit()

        # Redis 캐싱
        cache_data = [
            {k: v for k, v in item.items() if k != "raw_data"}
            for item in raw_results
        ]
        await redis_client.setex(cache_key, settings.cache_keyword_ttl, json.dumps(cache_data, default=str))

    # 4. 분석
    organic = [p for p in places_data if not p.get("is_ad", False)]
    total_count = len(organic)

    if total_count == 0:
        return _empty_result(keyword, my_category_main)

    # 카테고리 분포 계산
    cat_counter = Counter()
    for p in organic:
        cat = p.get("category_main") or "기타"
        cat_counter[cat] += 1

    top_categories = [
        {"category": cat, "count": cnt, "percentage": round(cnt / total_count * 100, 1)}
        for cat, cnt in cat_counter.most_common()
    ]

    # 내 카테고리 매칭
    matched_count = cat_counter.get(my_category_main, 0) if my_category_main else 0

    # 판정
    if matched_count >= 3:
        result = "possible"
    elif matched_count >= 1:
        result = "borderline"
    else:
        result = "impossible"

    top_places = [
        {
            "rank": p["search_rank"],
            "name": p.get("place_name", ""),
            "category": p.get("category_full", ""),
            "place_id": p.get("place_id", ""),
            "is_ad": p.get("is_ad", False),
        }
        for p in places_data[:30]
    ]

    return {
        "keyword": keyword,
        "result": result,
        "matched_count": matched_count,
        "total_count": total_count,
        "my_category": my_category_main,
        "top_categories": top_categories,
        "top_places": top_places,
        "from_cache": from_cache,
    }


async def save_analysis_history(
    db: AsyncSession,
    user_id: int,
    place_id: str | None,
    place_name: str | None,
    analysis_result: dict,
):
    """분석 결과를 이력에 저장"""
    history = AnalysisHistory(
        user_id=user_id,
        place_id=place_id,
        place_name=place_name,
        keyword=analysis_result["keyword"],
        result=analysis_result["result"],
        matched_count=analysis_result["matched_count"],
        total_count=analysis_result["total_count"],
        category_distribution={"categories": analysis_result["top_categories"]},
    )
    db.add(history)
    await db.commit()


def _empty_result(keyword: str, my_category: str | None) -> dict:
    return {
        "keyword": keyword,
        "result": "impossible",
        "matched_count": 0,
        "total_count": 0,
        "my_category": my_category,
        "top_categories": [],
        "top_places": [],
        "from_cache": False,
    }
```

**Step 3: 분석 API 라우터**

```python
# app/api/v1/analysis.py
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.analysis import AnalysisHistory
from app.schemas.analysis import AnalysisRequest, AnalysisResponse, KeywordAnalysisResult, AnalysisHistoryResponse
from app.services.place import lookup_place
from app.services.analysis import analyze_keyword, save_analysis_history
from app.services.audit import log_audit
from app.scrapers.naver_place import _delay

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("/check", response_model=AnalysisResponse)
async def check_keywords(
    body: AnalysisRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 1. 플레이스 조회
    place = await lookup_place(body.place_input, db)
    if not place:
        raise HTTPException(status_code=404, detail="Place not found or invalid input")

    my_category_main = place.get("category_main")

    # 2. 키워드별 분석 (순차 처리 - 차단 방지)
    results = []
    for keyword in body.keywords:
        keyword = keyword.strip()
        if not keyword:
            continue
        result = await analyze_keyword(keyword, my_category_main, db)
        results.append(result)

        # 분석 이력 저장
        await save_analysis_history(db, user.id, place.get("place_id"), place.get("name"), result)

        # 키워드 간 딜레이 (캐시 히트가 아닌 경우)
        if not result.get("from_cache"):
            await _delay()

    await log_audit(db, user.id, "analysis_check", "analysis", place.get("place_id"),
                    detail={"keywords": body.keywords, "results_count": len(results)},
                    ip_address=request.client.host if request.client else None)

    return AnalysisResponse(place=place, results=results)


@router.get("/history", response_model=list[AnalysisHistoryResponse])
async def get_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisHistory).where(AnalysisHistory.user_id == user.id)
    if keyword:
        query = query.where(AnalysisHistory.keyword.ilike(f"%{keyword}%"))
    query = query.order_by(AnalysisHistory.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    return result.scalars().all()
```

**Step 4: main.py에 라우터 등록**

```python
from app.api.v1.analysis import router as analysis_router
app.include_router(analysis_router, prefix="/api/v1")
```

**Step 5: 커밋**

```bash
git add -A
git commit -m "feat: add keyword ranking analysis with caching and history tracking"
```

---

## Phase 5: 어드민 기능 (캐시 관리, 감사 로그)

### Task 5.1: 캐시 관리 API

**Files:**
- Create: `backend/app/api/v1/cache.py`
- Create: `backend/app/schemas/cache.py`

**Step 1: 캐시 스키마**

```python
# app/schemas/cache.py
from datetime import datetime
from pydantic import BaseModel


class CacheEntry(BaseModel):
    type: str                 # "place" or "keyword"
    key: str                  # place_id or keyword
    fetched_at: datetime | None
    expires_at: datetime | None
    ttl_remaining: int | None  # 초


class CacheSearchParams(BaseModel):
    search: str | None = None
    type: str | None = None   # "place", "keyword", or None (both)
```

**Step 2: 캐시 관리 라우터**

```python
# app/api/v1/cache.py
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_
from app.core.database import get_db
from app.core.deps import require_role
from app.core.redis import redis_client
from app.models.user import User
from app.models.place import Place
from app.models.keyword_result import KeywordResult
from app.schemas.cache import CacheEntry
from app.schemas.common import MessageResponse
from app.services.audit import log_audit

router = APIRouter(prefix="/admin/cache", tags=["admin-cache"])

PLACE_PREFIX = "npc:place:"
KEYWORD_PREFIX = "npc:keyword:"


@router.get("", response_model=list[CacheEntry])
async def list_cache(
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
    search: str | None = None,
    cache_type: str | None = Query(None, alias="type"),
    user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    entries = []
    now = datetime.now(timezone.utc)

    # 플레이스 캐시
    if not cache_type or cache_type == "place":
        q = select(Place).where(Place.expires_at > now)
        if search:
            q = q.where(or_(Place.place_id.ilike(f"%{search}%"), Place.name.ilike(f"%{search}%")))
        q = q.order_by(Place.fetched_at.desc()).limit(per_page)
        result = await db.execute(q)
        for p in result.scalars():
            ttl = int((p.expires_at - now).total_seconds()) if p.expires_at else None
            entries.append(CacheEntry(type="place", key=p.place_id, fetched_at=p.fetched_at, expires_at=p.expires_at, ttl_remaining=ttl))

    # 키워드 캐시 (고유 키워드만)
    if not cache_type or cache_type == "keyword":
        from sqlalchemy import distinct, func
        q = select(
            KeywordResult.keyword,
            func.min(KeywordResult.fetched_at).label("fetched_at"),
            func.min(KeywordResult.expires_at).label("expires_at"),
        ).where(KeywordResult.expires_at > now).group_by(KeywordResult.keyword)
        if search:
            q = q.where(KeywordResult.keyword.ilike(f"%{search}%"))
        q = q.order_by(func.min(KeywordResult.fetched_at).desc()).limit(per_page)
        result = await db.execute(q)
        for row in result:
            ttl = int((row.expires_at - now).total_seconds()) if row.expires_at else None
            entries.append(CacheEntry(type="keyword", key=row.keyword, fetched_at=row.fetched_at, expires_at=row.expires_at, ttl_remaining=ttl))

    return entries


@router.delete("/{cache_type}/{key}", response_model=MessageResponse)
async def delete_cache(
    cache_type: str,
    key: str,
    request: Request,
    user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    if cache_type == "place":
        await db.execute(delete(Place).where(Place.place_id == key))
        await redis_client.delete(f"{PLACE_PREFIX}{key}")
    elif cache_type == "keyword":
        await db.execute(delete(KeywordResult).where(KeywordResult.keyword == key))
        import hashlib
        kh = hashlib.md5(key.encode()).hexdigest()
        await redis_client.delete(f"{KEYWORD_PREFIX}{kh}")
    else:
        raise HTTPException(status_code=400, detail="Invalid cache type")

    await db.commit()
    await log_audit(db, user.id, "cache_delete", cache_type, key,
                    ip_address=request.client.host if request.client else None)

    return MessageResponse(message=f"Cache deleted: {cache_type}/{key}")


@router.delete("/all", response_model=MessageResponse)
async def clear_all_cache(
    request: Request,
    user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    # DB 캐시 삭제
    await db.execute(delete(Place))
    await db.execute(delete(KeywordResult))
    await db.commit()

    # Redis 캐시 삭제
    async for key in redis_client.scan_iter(f"{PLACE_PREFIX}*"):
        await redis_client.delete(key)
    async for key in redis_client.scan_iter(f"{KEYWORD_PREFIX}*"):
        await redis_client.delete(key)

    await log_audit(db, user.id, "cache_clear_all", ip_address=request.client.host if request.client else None)

    return MessageResponse(message="All cache cleared")
```

**Step 3: main.py에 라우터 등록**

```python
from app.api.v1.cache import router as cache_router
app.include_router(cache_router, prefix="/api/v1")
```

**Step 4: 커밋**

```bash
git add -A
git commit -m "feat: add admin cache management with search and delete"
```

---

### Task 5.2: 감사 로그 조회 API

**Files:**
- Create: `backend/app/api/v1/audit.py`
- Create: `backend/app/schemas/audit.py`

**Step 1: 감사 로그 스키마 + 라우터**

```python
# app/schemas/audit.py
from datetime import datetime
from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None
    action: str
    target_type: str | None
    target_id: str | None
    detail: dict | None
    ip_address: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
```

```python
# app/api/v1/audit.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.database import get_db
from app.core.deps import require_role
from app.models.user import User
from app.models.audit_log import AuditLog
from app.schemas.audit import AuditLogResponse

router = APIRouter(prefix="/admin/audit-logs", tags=["admin-audit"])


@router.get("", response_model=list[AuditLogResponse])
async def list_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    action: str | None = None,
    user_id_filter: int | None = Query(None, alias="userId"),
    user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    query = select(AuditLog)

    # manager는 하위 직원 로그만 조회 가능
    if user.role == "manager":
        from app.models.user import User as UserModel
        sub_query = select(UserModel.id).where(UserModel.parent_id == user.id)
        sub_result = await db.execute(sub_query)
        sub_ids = [r for r in sub_result.scalars()] + [user.id]
        query = query.where(AuditLog.user_id.in_(sub_ids))

    if action:
        query = query.where(AuditLog.action == action)
    if user_id_filter:
        query = query.where(AuditLog.user_id == user_id_filter)

    query = query.order_by(AuditLog.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    return result.scalars().all()
```

**Step 2: main.py에 라우터 등록**

```python
from app.api.v1.audit import router as audit_router
app.include_router(audit_router, prefix="/api/v1")
```

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add audit log viewer API with role-based filtering"
```

---

## Phase 6: Next.js 프론트엔드

### Task 6.1: Next.js 프로젝트 초기화

**Step 1: create-next-app 실행**

```bash
cd C:\Users\user\n-checker
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

**Step 2: 필수 패키지 설치**

```bash
cd frontend
npm install @tanstack/react-query axios recharts framer-motion lucide-react
npm install class-variance-authority clsx tailwind-merge
npx shadcn@latest init -y
npx shadcn@latest add button input card table badge dialog toast tabs avatar dropdown-menu separator skeleton sheet alert
```

**Step 3: 공통 유틸 및 API 클라이언트 설정**

`frontend/src/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

`frontend/src/lib/api.ts`:
```typescript
import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "/api",
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Request interceptor: JWT 토큰 자동 추가
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Response interceptor: 401 시 토큰 갱신 시도
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const { data } = await axios.post(
            `${process.env.NEXT_PUBLIC_API_URL || "/api"}/v1/auth/refresh`,
            { refresh_token: refreshToken }
          );
          localStorage.setItem("access_token", data.access_token);
          localStorage.setItem("refresh_token", data.refresh_token);
          error.config.headers.Authorization = `Bearer ${data.access_token}`;
          return api(error.config);
        } catch {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

**Step 4: 커밋**

```bash
cd C:\Users\user\n-checker
git add -A
git commit -m "feat: initialize Next.js frontend with shadcn/ui and API client"
```

---

### Task 6.2: 인증 페이지 (로그인)

**Files:**
- Create: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/app/(authenticated)/layout.tsx`
- Create: `frontend/src/hooks/use-auth.ts`
- Create: `frontend/src/app/layout.tsx` (수정)
- Create: `frontend/src/app/providers.tsx`

**Step 1: Auth 훅**

```typescript
// frontend/src/hooks/use-auth.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

interface User {
  id: number;
  username: string;
  role: string;
  display_name: string;
  status: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchUser = useCallback(async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setLoading(false);
        return;
      }
      const { data } = await api.get("/v1/auth/me");
      setUser(data);
    } catch {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password: string) => {
    const { data } = await api.post("/v1/auth/login", { username, password });
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("refresh_token", data.refresh_token);
    await fetchUser();
    router.push("/");
  };

  const logout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setUser(null);
    router.push("/login");
  };

  return { user, loading, login, logout, isAdmin: user?.role === "admin", isManager: user?.role === "manager" };
}
```

**Step 2: 로그인 페이지, 인증 레이아웃, 프로바이더 구현**

이후 모든 프론트엔드 페이지를 구현:
- `/login` - 로그인 (다크 테마, 미니멀 디자인)
- `/` - 대시보드 (최근 분석 요약)
- `/analysis` - 메인 분석 페이지 (플레이스 입력 + 키워드 입력 + 결과 시각화)
- `/history` - 분석 이력
- `/admin/users` - 사용자 관리
- `/admin/cache` - 캐시 관리
- `/admin/audit` - 감사 로그

각 페이지는 shadcn/ui 컴포넌트, Framer Motion 애니메이션, Recharts 차트를 사용하여 프로덕션급 UI로 구현.

**Step 3: 커밋**

```bash
git add -A
git commit -m "feat: add authentication pages and protected layout"
```

---

### Task 6.3: 메인 분석 페이지

**Files:**
- Create: `frontend/src/app/(authenticated)/analysis/page.tsx`
- Create: `frontend/src/components/place-input.tsx`
- Create: `frontend/src/components/keyword-input.tsx`
- Create: `frontend/src/components/analysis-result.tsx`
- Create: `frontend/src/components/category-chart.tsx`

**핵심 UI 구조:**

```
+--------------------------------------------------+
|  [플레이스 입력]                           [조회]  |
|  고유번호 또는 URL 입력                            |
+--------------------------------------------------+
|  매장명: OO카페 | 카테고리: 음식점>카페>디저트카페  |
+--------------------------------------------------+
|  [키워드 입력]                        [분석 시작]  |
|  강남카페, 디저트맛집, 브런치카페 (쉼표/엔터 구분)  |
+--------------------------------------------------+
|                                                    |
|  키워드: "강남카페"          판정: [가능]           |
|  +---------+  +---------------------------+        |
|  | 원형차트 |  | 1. OO카페 - 카페           |       |
|  | 카테고리 |  | 2. XX카페 - 카페           |       |
|  | 분포     |  | 3. YY레스토랑 - 음식점     |       |
|  +---------+  +---------------------------+        |
|                                                    |
|  키워드: "브런치카페"        판정: [경계]           |
|  ...                                               |
+--------------------------------------------------+
```

판정 배지 색상:
- 가능(possible): 녹색
- 경계(borderline): 황색/주황
- 불가(impossible): 적색

**Step 1: 분석 페이지 및 컴포넌트 구현**

각 컴포넌트를 React Query + shadcn/ui + Framer Motion으로 구현.
차트는 Recharts PieChart로 카테고리 분포를 시각화.

**Step 2: 커밋**

```bash
git add -A
git commit -m "feat: add main analysis page with category chart and result visualization"
```

---

### Task 6.4: 어드민 페이지들

**Files:**
- Create: `frontend/src/app/(authenticated)/admin/users/page.tsx`
- Create: `frontend/src/app/(authenticated)/admin/cache/page.tsx`
- Create: `frontend/src/app/(authenticated)/admin/audit/page.tsx`
- Create: `frontend/src/app/(authenticated)/admin/layout.tsx`

각 페이지:
- **사용자 관리**: 테이블 + 생성 다이얼로그 + 상태 변경 + 비밀번호 초기화
- **캐시 관리**: 검색 + 목록 + 개별 삭제 + 전체 초기화 (admin만)
- **감사 로그**: 필터링 + 페이지네이션 + 액션별 배지 색상

**커밋:**

```bash
git add -A
git commit -m "feat: add admin pages for users, cache, and audit logs"
```

---

### Task 6.5: Frontend Dockerfile

**Files:**
- Create: `infra/docker/frontend.Dockerfile`

```dockerfile
FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --production=false

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

**커밋:**

```bash
git add -A
git commit -m "feat: add frontend Dockerfile with multi-stage build"
```

---

## Phase 7: 배포 및 인프라

### Task 7.1: Celery 워커 설정

**Files:**
- Create: `backend/app/worker.py`
- Create: `infra/docker/worker.Dockerfile`

```python
# backend/app/worker.py
from celery import Celery
from app.core.config import get_settings

settings = get_settings()
celery_app = Celery(
    "npc_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Seoul",
    task_soft_time_limit=60,
    task_time_limit=120,
    worker_max_tasks_per_child=100,
    worker_concurrency=2,
)
```

```dockerfile
# infra/docker/worker.Dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir .

COPY backend/ ./

CMD ["celery", "-A", "app.worker:celery_app", "worker", "--loglevel=info", "--concurrency=2"]
```

**커밋:**

```bash
git add -A
git commit -m "feat: add Celery worker for background scraping tasks"
```

---

### Task 7.2: nginx 설정

**Files:**
- Create: `infra/nginx/nplace-checker.conf`

```nginx
# /etc/nginx/sites-enabled/nplace-checker.conf (서버에 배포)

# nplace-checker upstream
upstream npc_api {
    server 127.0.0.1:4000;
}

upstream npc_frontend {
    server 127.0.0.1:4001;
}

# nplace-checker는 기존 nginx server 블록에 location으로 추가하거나
# 별도 서브도메인으로 분리 가능. 여기서는 경로 기반으로 기존에 추가.
# 기존 server 블록(443)에 다음 location 추가:

# API
location /npc/api/ {
    proxy_pass http://npc_api/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}

# Health
location /npc/health {
    proxy_pass http://npc_api/health;
    access_log off;
}

# Frontend
location /npc/ {
    proxy_pass http://npc_frontend/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Next.js 정적 파일
location /npc/_next/static/ {
    proxy_pass http://npc_frontend/_next/static/;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

**커밋:**

```bash
git add -A
git commit -m "feat: add nginx reverse proxy configuration"
```

---

### Task 7.3: 서버 배포 스크립트

**Files:**
- Create: `deploy.sh`

```bash
#!/bin/bash
set -euo pipefail

SERVER="root@1.234.83.118"
REMOTE_DIR="/home/nplace-checker"

echo "=== nplace-checker 배포 시작 ==="

# 1. 소스 동기화
echo "[1/4] 소스 코드 동기화..."
rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '__pycache__' \
    --exclude '.venv' --exclude 'docker-data' --exclude '.git' \
    ./ ${SERVER}:${REMOTE_DIR}/

# 2. .env 확인
echo "[2/4] 환경 설정 확인..."
ssh ${SERVER} "test -f ${REMOTE_DIR}/.env || (echo '.env 파일이 없습니다!' && exit 1)"

# 3. Docker 빌드 & 실행
echo "[3/4] Docker 빌드 및 시작..."
ssh ${SERVER} "cd ${REMOTE_DIR} && docker compose build && docker compose up -d"

# 4. 헬스체크
echo "[4/4] 헬스체크..."
sleep 5
ssh ${SERVER} "curl -sf http://127.0.0.1:4000/health && echo ' API OK' || echo ' API FAIL'"

echo "=== 배포 완료 ==="
```

**커밋:**

```bash
git add -A
git commit -m "feat: add deployment script with rsync and docker compose"
```

---

## Phase 8: Electron PC 앱 (후속)

### Task 8.1: Electron 래퍼 설정

프론트엔드 완성 후 진행. Next.js 앱을 Electron BrowserWindow에 로드하는 구조.
서버 URL을 난독화하여 임베드하고, DevTools 접근을 차단.

**Files:**
- Create: `desktop/main.js`
- Create: `desktop/package.json`
- Create: `desktop/preload.js`

---

## Phase 9: 모바일 앱 (후속)

### Task 9.1: Capacitor 설정

프론트엔드 완성 후 진행. Next.js 앱을 Capacitor로 빌드하여 Android/iOS 앱 생성.
Certificate Pinning + 코드 난독화 적용.

---

## 실행 순서 요약

1. **Phase 1** (Task 1.1~1.3): 스캐폴딩 + DB 모델 -> 기본 골격
2. **Phase 2** (Task 2.1~2.4): 인증 + 사용자 관리 -> 보안 기반
3. **Phase 3** (Task 3.1~3.2): 네이버 수집 엔진 -> 핵심 데이터
4. **Phase 4** (Task 4.1~4.2): 플레이스 조회 + 키워드 분석 -> 핵심 기능
5. **Phase 5** (Task 5.1~5.2): 캐시 관리 + 감사 로그 -> 어드민
6. **Phase 6** (Task 6.1~6.5): 프론트엔드 전체 -> UI
7. **Phase 7** (Task 7.1~7.3): 배포 + nginx -> 서비스 오픈
8. **Phase 8~9**: Electron + 모바일 -> 확장

각 Phase 완료 후 중간 리뷰 체크포인트.

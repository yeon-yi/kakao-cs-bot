-- 업체 상태 라이프사이클 필드 추가
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS "companies_status_idx" ON "companies" ("status");

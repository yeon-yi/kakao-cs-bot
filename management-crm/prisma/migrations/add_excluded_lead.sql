-- 제외가망 필드 추가
ALTER TABLE "upsell_assignments" ADD COLUMN IF NOT EXISTS "is_excluded" BOOLEAN NOT NULL DEFAULT false;

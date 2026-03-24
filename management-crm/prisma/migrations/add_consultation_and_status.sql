-- 업체 상태 라이프사이클
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS "companies_status_idx" ON "companies" ("status");

-- 상담이력 테이블
CREATE TABLE IF NOT EXISTS "consultations" (
  "id" SERIAL PRIMARY KEY,
  "company_id" INTEGER NOT NULL REFERENCES "companies"("id"),
  "user_id" INTEGER NOT NULL REFERENCES "users"("id"),
  "contact_date" TIMESTAMP(3) NOT NULL,
  "contact_type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "next_contact_date" TIMESTAMP(3),
  "next_action" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "consultations_company_id_idx" ON "consultations" ("company_id");
CREATE INDEX IF NOT EXISTS "consultations_user_id_idx" ON "consultations" ("user_id");
CREATE INDEX IF NOT EXISTS "consultations_next_contact_date_idx" ON "consultations" ("next_contact_date");

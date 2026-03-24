-- 결제종류, 할부개월 필드 추가 + 기존 card_company를 실제 카드사로 용도 변경
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "payment_type" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "installment_months" TEXT;

-- 기존 card_company 컬럼에 결제종류 데이터가 들어있으므로 payment_type으로 이관
UPDATE "companies" SET "payment_type" = "card_company" WHERE "card_company" IS NOT NULL;
-- card_company는 크롤러가 다음 실행 시 실제 카드사 데이터로 덮어씀
UPDATE "companies" SET "card_company" = NULL;
